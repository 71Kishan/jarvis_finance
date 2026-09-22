    this.notify();
  }

  private utcDayKey(timestampMs: number) {
    return new Date(timestampMs).toISOString().slice(0, 10);
  }

  private rollDailyBoundary(timestampMs: number) {
    const key = this.utcDayKey(timestampMs);
    if (!this.lastDailyKey) {
      this.lastDailyKey = key;
      this.vitality.dailyStartEquity = this.vitality.currentEquity;
      this.vitality.dailyDrawdownPercent = 0;
      return;
    }
    if (key !== this.lastDailyKey) {
      this.lastDailyKey = key;
      this.vitality.dailyStartEquity = this.vitality.currentEquity;
      this.vitality.dailyDrawdownPercent = 0;
      this.logThought("STUDY", "New UTC risk day", "Daily loss budget reset from the current paper equity. Loss streak is intentionally preserved across days.");
    }
  }

  private updateEquityAndHealth(currentPrice: number) {
    const openPnl = this.activeTrade ? grossPnL(this.activeTrade.type, this.activeTrade.entryPrice, currentPrice, this.activeTrade.amount) : 0;
    const margin = this.activeTrade?.marginUsd || 0;
    this.vitality.currentEquity = Number((this.vitality.cash + margin + openPnl).toFixed(2));
    this.vitality.peakEquity = Math.max(this.vitality.peakEquity, this.vitality.currentEquity);
    this.vitality.currentDrawdownPercent = this.vitality.peakEquity > 0 ? Number(((this.vitality.peakEquity - this.vitality.currentEquity) / this.vitality.peakEquity * 100).toFixed(2)) : 0;
    this.vitality.dailyDrawdownPercent = this.vitality.dailyStartEquity > 0 ? Number(((this.vitality.dailyStartEquity - this.vitality.currentEquity) / this.vitality.dailyStartEquity * 100).toFixed(2)) : 0;
    this.vitality.maxDrawdownPercent = Math.max(this.vitality.maxDrawdownPercent, this.vitality.currentDrawdownPercent);
    const limit = Math.max(0.5, this.vitality.circuitBreakerThresholdPercent);
    this.vitality.health = Math.round(Math.max(0, Math.min(100, 100 * (1 - this.vitality.currentDrawdownPercent / limit))));
    if ((this.vitality.currentDrawdownPercent >= limit || this.vitality.dailyDrawdownPercent >= this.riskPolicy.maxDailyLossPercent) && this.botState !== "HALTED_DEAD") {
      this.triggerCircuitBreaker({ timestamp: Date.now(), open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice, volume: 0 }, "Drawdown risk limit breached");
      return;
    }
    if (this.vitality.health <= 40) this.botState = "DEFENSIVE"; else if (this.activeTrade) this.botState = "IN_POSITION"; else this.botState = "HUNTING";
  }

  private manageActiveTrade(candle: Candle) {
    const trade = this.activeTrade; if (!trade) return;
    if (trade.type === "LONG") { trade.highestPrice = Math.max(trade.highestPrice || trade.entryPrice, candle.high); if (this.strategy.trailingStop) trade.stopLoss = Number(Math.max(trade.stopLoss, trade.highestPrice * (1 - this.strategy.trailingStopPercent / 100)).toFixed(4)); }
    else { trade.lowestPrice = Math.min(trade.lowestPrice || trade.entryPrice, candle.low); if (this.strategy.trailingStop) trade.stopLoss = Number(Math.min(trade.stopLoss, trade.lowestPrice * (1 + this.strategy.trailingStopPercent / 100)).toFixed(4)); }
    const result = resolveStopTarget(trade.type, candle, trade.stopLoss, trade.takeProfit);
    if (result.kind === "NONE") { trade.pnl = Number(grossPnL(trade.type, trade.entryPrice, candle.close, trade.amount).toFixed(2)); trade.pnlPercent = Number((trade.pnl / Math.max(1, trade.sizeUsd) * 100).toFixed(2)); return; }
    const status = result.kind === "TARGET" ? "CLOSED_TAKE_PROFIT" : "CLOSED_STOP_LOSS";
    const reason = result.ambiguous ? "OHLC bar hit stop and target; conservative stop-first resolution applied." : result.kind === "TARGET" ? "Target reached." : "Protective stop reached.";
    this.closeTrade(result.price, status, reason);
  }

  private evaluateEntry(candle: Candle, recentCandles: Candle[]) {
    const signal = evaluateSignal(candle, recentCandles, this.strategy); this.lastSignal = signal;
    if (!signal.eligible) { this.logThought("STUDY", "No eligible setup", signal.reasons.join(" ") || "Composite score below threshold.", signal.score); return; }
    this.executeEntry(signal.direction as "LONG" | "SHORT", candle.close, signal.score, signal.reasons.join(" | "), candle);
  }

  private executeEntry(type: "LONG" | "SHORT", expectedPrice: number, signalScore: number, rationale: string, signalCandle?: Candle) {
    const stopDistance = Math.max(0.001, this.strategy.stopLossPercent / 100);
    const configuredRiskBudget = this.vitality.currentEquity * Math.min(Math.max(0, Number(this.strategy.maxRiskPerTrade) || 0), 1) / 100;
    const intendedRiskNotional = Math.min(
      this.vitality.currentEquity * this.riskPolicy.maxPositionNotionalPercent / 100,
      configuredRiskBudget / stopDistance,
      this.vitality.cash
    );
    if (
      this.lastMarketDataTimestamp > 0 &&
      Date.now() - this.lastMarketDataTimestamp > 30_000
    ) {
      this.logThought("DEFENSE", "Signal rejected: stale market data", "No new trusted market snapshot has arrived within 30 seconds.", signalScore);
      return false;
    }
    const risk = evaluateRisk(this.riskPolicy, { equity: this.vitality.currentEquity, peakEquity: this.vitality.peakEquity, dailyStartEquity: this.vitality.dailyStartEquity, openPositions: 0, requestedNotional: intendedRiskNotional, leverage: 1, spreadBps: this.lastSpreadBps, marketOpen: this.lastMarketOpen, candle: signalCandle, stopLossPercent: this.strategy.stopLossPercent, recentLossCount: this.vitality.consecutiveLosses, lastLossAtMs: this.vitality.lastLossAt }, this.strategy);
    if (!risk.allowed) { this.logThought("DEFENSE", "Signal rejected by risk policy", risk.reasons.join(" "), signalScore); return false; }
    const riskSize = risk.maxLossBudgetUsd / stopDistance;
    const maxNotional = this.vitality.currentEquity * this.riskPolicy.maxPositionNotionalPercent / 100;
    const notional = Math.min(riskSize, maxNotional, this.vitality.cash);
    if (notional < 10) { this.logThought("DEFENSE", "Signal rejected: position too small", "Risk budget cannot support a meaningful paper order.", signalScore); return false; }
    const fill = modelEntryFill(expectedPrice, type, notional, this.paperSettings);
    this.openPaperPosition(type, fill.fillPrice, notional, this.strategy.stopLossPercent, this.strategy.takeProfitPercent, this.strategy.trailingStop, rationale, signalScore, fill.feeUsd, fill.slippageUsd);
    return Boolean(this.activeTrade);
  }

  private openPaperPosition(type: "LONG" | "SHORT", expectedPrice: number, notional: number, stopLossPercent: number, takeProfitPercent: number, trailingStop: boolean, rationale?: string, signalScore = 0, feeOverride?: number, slippageOverride?: number) {
    const fill = feeOverride === undefined ? modelEntryFill(expectedPrice, type, notional, this.paperSettings) : { expectedPrice, fillPrice: expectedPrice, feeUsd: feeOverride, slippageUsd: slippageOverride || 0 };
    if (notional + fill.feeUsd > this.vitality.cash) return;
    const amount = notional / fill.fillPrice;
    this.vitality.cash = Number((this.vitality.cash - notional - fill.feeUsd).toFixed(2));
    const stopLoss = type === "LONG" ? fill.fillPrice * (1 - stopLossPercent / 100) : fill.fillPrice * (1 + stopLossPercent / 100);
    const takeProfit = type === "LONG" ? fill.fillPrice * (1 + takeProfitPercent / 100) : fill.fillPrice * (1 - takeProfitPercent / 100);
    const trade: Trade = { id: "PTRD-" + Date.now().toString(36).toUpperCase(), asset: this.strategy.asset, type, entryPrice: Number(fill.fillPrice.toFixed(4)), amount: Number(amount.toFixed(8)), sizeUsd: Number(notional.toFixed(2)), marginUsd: Number(notional.toFixed(2)), entryTime: Date.now(), stopLoss: Number(stopLoss.toFixed(4)), takeProfit: Number(takeProfit.toFixed(4)), highestPrice: fill.fillPrice, lowestPrice: fill.fillPrice, pnl: 0, pnlPercent: 0, feesUsd: Number(fill.feeUsd.toFixed(2)), slippageUsd: Number(fill.slippageUsd.toFixed(2)), status: "OPEN", signalScore, confidence: signalScore, rationale: rationale || "User-authorized paper order.", botSurvivalNote: "Paper execution only. Signal score is not a probability." };
    this.vitality.totalFees = Number((this.vitality.totalFees + fill.feeUsd).toFixed(2));
    this.activeTrade = trade; this.botState = "IN_POSITION";
    this.addNotification({ type: "TRADE_OPENED", title: "Paper " + type + " " + trade.asset + " opened", message: "Fill $" + trade.entryPrice.toLocaleString() + " | Notional $" + trade.sizeUsd.toFixed(2) + " | Signal Score " + (signalScore || "manual"), badgeText: "PAPER", details: { asset: trade.asset, price: trade.entryPrice, size: trade.sizeUsd } });
    this.logThought("EXECUTION", "Paper position opened", "Entry fee $" + fill.feeUsd.toFixed(2) + "; modeled slippage $" + fill.slippageUsd.toFixed(2) + ".", signalScore);
    if (this.paperSettings.soundAlerts) soundFx.playOrderFilled(); this.recordEquitySnapshot(trade.entryPrice, "Paper position opened");
  }

  public closeTrade(requestedExitPrice: number, status: "CLOSED_TAKE_PROFIT" | "CLOSED_STOP_LOSS" | "CLOSED_MANUAL" | "EMERGENCY_LIQUIDATED", reason: string) {
    const trade = this.activeTrade; if (!trade) return;
    const exitEstimate = Math.abs(trade.amount * requestedExitPrice);
    const fill = modelExitFill(requestedExitPrice, trade.type, exitEstimate, this.paperSettings);
    trade.exitPrice = Number(fill.fillPrice.toFixed(4)); trade.exitTime = Date.now(); trade.status = status;
    const entryFee = trade.feesUsd || 0;
    const gross = grossPnL(trade.type, trade.entryPrice, fill.fillPrice, trade.amount);
    const totalTradeFees = entryFee + fill.feeUsd;
    const economicNet = gross - totalTradeFees;
    trade.feesUsd = Number(totalTradeFees.toFixed(2));
    trade.slippageUsd = Number(((trade.slippageUsd || 0) + fill.slippageUsd).toFixed(2));
    trade.pnl = Number(economicNet.toFixed(2));
    trade.pnlPercent = Number((economicNet / Math.max(1, trade.sizeUsd) * 100).toFixed(2));
    // Entry fee was already removed from cash when the position opened; add back only margin + gross PnL - exit fee.
    this.vitality.cash = Number((this.vitality.cash + (trade.marginUsd || trade.sizeUsd) + gross - fill.feeUsd).toFixed(2));
    this.vitality.totalFees = Number((this.vitality.totalFees + fill.feeUsd).toFixed(2)); this.vitality.totalTrades++; this.vitality.totalPnl = Number((this.vitality.totalPnl + economicNet).toFixed(2));
    if (economicNet > 0) { this.vitality.winningTrades++; this.vitality.survivalStreak++; this.vitality.consecutiveLosses = 0; delete this.vitality.lastLossAt; }
    else if (economicNet < 0) { this.vitality.losingTrades++; this.vitality.survivalStreak = 0; this.vitality.consecutiveLosses++; this.vitality.lastLossAt = Date.now(); }
    this.vitality.winRate = this.vitality.totalTrades ? Number((this.vitality.winningTrades / this.vitality.totalTrades * 100).toFixed(1)) : 0;
    const gp = this.tradeHistory.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) + (economicNet > 0 ? economicNet : 0); const gl = this.tradeHistory.filter(t => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0) + (economicNet < 0 ? Math.abs(economicNet) : 0); this.vitality.profitFactor = gl > 0 ? Number((gp / gl).toFixed(2)) : 0;
    this.tradeHistory.unshift({ ...trade }); strategyVaultInstance.recordTradeOutcome(this.strategy, trade);
    try { void cryptoSecurityService.appendTradeToAuditLedger({ id: trade.id, asset: trade.asset, type: trade.type, entryPrice: trade.entryPrice, exitPrice: trade.exitPrice || requestedExitPrice, pnl: trade.pnl, timestamp: trade.exitTime || Date.now() }); } catch {}
    this.activeTrade = null; this.updateEquityAndHealth(trade.exitPrice || requestedExitPrice); this.recordEquitySnapshot(trade.exitPrice || requestedExitPrice, "Close: " + (economicNet >= 0 ? "+" : "") + "$" + economicNet.toFixed(2), economicNet);
    this.addNotification({ type: economicNet > 0 ? "TAKE_PROFIT" : economicNet < 0 ? "STOP_LOSS" : "MANUAL_CLOSE", title: "Paper trade realized " + (economicNet >= 0 ? "+" : "") + "$" + economicNet.toFixed(2), message: trade.type + " " + trade.asset + " closed. " + reason, badgeText: economicNet > 0 ? "WIN" : economicNet < 0 ? "LOSS" : "FLAT", details: { asset: trade.asset, pnl: economicNet, pnlPercent: trade.pnlPercent, price: trade.exitPrice } });
    if (status === "CLOSED_TAKE_PROFIT") soundFx.playTakeProfit(); else if (status === "CLOSED_STOP_LOSS") soundFx.playStopLoss(); else if (status === "EMERGENCY_LIQUIDATED") soundFx.playCircuitBreaker();
    this.notify();
  }

  public triggerCircuitBreaker(candle: Candle, triggerReason: string) {
    if (this.botState === "HALTED_DEAD") return;
    if (this.activeTrade) this.closeTrade(candle.close, "EMERGENCY_LIQUIDATED", triggerReason);
    this.botState = "HALTED_DEAD"; this.vitality.health = 0;
    this.addNotification({ type: "CIRCUIT_BREAKER", title: "Paper trading halted by risk controls", message: "Risk stop triggered. No new paper entries until a new run is started.", badgeText: "HALT" });
    this.logThought("PERISH_ALERT", "Circuit breaker activated", "Paper protection cannot guarantee real-market fills or capital preservation. Trigger: " + triggerReason, 0, -100);
    this.notify();
  }
  public manualKillSwitch(lastCandle: Candle) { this.triggerCircuitBreaker(lastCandle, "User activated the paper kill switch."); }
  public getProfitWithdrawals() { return [...this.profitWithdrawals]; }
  public setAutoWithdrawProfitEnabled(enabled: boolean) { this.vitality.autoWithdrawProfitEnabled = Boolean(enabled); this.notify(); }
  public setWithdrawPercentage(percentage: number) { this.vitality.withdrawPercentage = Math.max(10, Math.min(100, Number(percentage) || 10)); this.notify(); }
  public setMinProfitThresholdUsd(minUsd: number) { this.vitality.minProfitThresholdUsd = Math.max(1, Number(minUsd) || 1); this.notify(); }

  public async executeProfitWithdrawal(trade: Trade | { id: string; asset: string; pnl: number }, amountToWithdraw: number, grossProfit: number, policy: "AUTO_SWEEP_WIN" | "MANUAL_SWEEP" | "MILESTONE_SWEEP", memo: string): Promise<ProfitWithdrawalRecord | null> {
    const amount = Number(amountToWithdraw.toFixed(2)); if (amount <= 0 || amount > this.vitality.cash) return null;
    this.vitality.cash = Number((this.vitality.cash - amount).toFixed(2)); this.vitality.securedProfitVault = Number(((this.vitality.securedProfitVault || 0) + amount).toFixed(2)); this.vitality.totalProfitWithdrawn = Number(((this.vitality.totalProfitWithdrawn || 0) + amount).toFixed(2));
    const id = "RES-" + Date.now().toString(36).toUpperCase(); const timestamp = Date.now();
    let proof = ""; try { proof = await cryptoSecurityService.sha256("jarvis-paper-reserve-v2|" + id + "|" + trade.id + "|" + trade.asset + "|" + amount + "|" + this.vitality.securedProfitVault + "|" + timestamp); } catch { return null; }
    const record: ProfitWithdrawalRecord = { id, timestamp, tradeId: trade.id, asset: trade.asset, grossProfit: grossProfit || amount, withdrawnAmount: amount, retainedCapital: Number(((grossProfit || amount) - amount).toFixed(2)), vaultBalanceAfter: this.vitality.securedProfitVault, sha256Proof: proof, documentationMemo: memo, status: "SECURED", policy, proofVerified: true };
    this.profitWithdrawals = [record, ...this.profitWithdrawals].slice(0, 150); this.saveProfitWithdrawalData();
    this.addNotification({ type: "PROFIT_WITHDRAWAL", title: "Paper reserve updated", message: "Virtual reserve balance: $" + this.vitality.securedProfitVault.toFixed(2) + ". No external cash transfer occurred.", badgeText: "PAPER" }); this.notify(); return record;
  }
  public manualSweepToVault(amount: number, memo?: string) { return this.executeProfitWithdrawal({ id: "MANUAL-" + Date.now(), asset: this.strategy.asset, pnl: amount }, amount, amount, "MANUAL_SWEEP", memo || "Paper-only transfer to virtual reserve."); }
  public transferVaultToTrading(amount: number) { const n = Number(amount.toFixed(2)); if (n <= 0 || n > (this.vitality.securedProfitVault || 0)) return false; this.vitality.securedProfitVault -= n; this.vitality.cash += n; this.saveProfitWithdrawalData(); this.notify(); return true; }
  private saveProfitWithdrawalData() { if (typeof window === "undefined") return; try { localStorage.setItem(TradingEngine.STORAGE_VAULT_KEY, String(this.vitality.securedProfitVault)); localStorage.setItem(TradingEngine.STORAGE_WITHDRAWALS_KEY, JSON.stringify(this.profitWithdrawals.slice(0, 100))); } catch {} }
  private logThought(type: BotThoughtLog["type"], headline: string, message: string, confidence?: number, vitalityDelta?: number) { this.thoughts = [{ id: "THG-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), timestamp: Date.now(), type, headline, message, confidence, vitalityDelta }, ...this.thoughts].slice(0, 100); }
  private reject(message: string) { this.logThought("DEFENSE", "Order rejected", message, 0); this.notify(); return false; }