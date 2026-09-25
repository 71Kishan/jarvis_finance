import { ActionNotification, BotState, BotThoughtLog, BotVitality, Candle, EquityCurvePoint, MarketDataSource, PaperOrderRequest, PaperTradingSettings, ProfitWithdrawalRecord, StrategyConfig, Trade, TradingEngineRuntimeState } from "../types/trading";
import { soundFx } from "../utils/soundEffects";
import { systemNotificationService } from "../utils/systemNotifications";
import { cryptoSecurityService } from "../utils/cryptoSecurity";
import { strategyVaultInstance } from "./strategyVault";
import { DEFAULT_RISK_POLICY, evaluateRisk, RiskPolicyConfig } from "./riskPolicy";
import { evaluateSignal, SignalResult } from "./signalEngine";
import { paperExecutionAdapter } from "../execution/paperExecutionAdapter";
import { LearningPerformanceJournal } from "../learn/performanceJournal";
import { buildDecisionFeatureSnapshot, DecisionFeatureSnapshot } from "../learn/features";

export const DEFAULT_STRATEGY: StrategyConfig = {
  id: "jarvis-base-v1", name: "Jarvis Base Confluence V1", version: 1, asset: "BTC/USD",
  description: "Deterministic multi-factor research baseline. No performance guarantee.",
  rsiOversold: 34, rsiOverbought: 68, stopLossPercent: 1, takeProfitPercent: 2.2, trailingStop: true, trailingStopPercent: 0.6,
  minConfidence: 70, maxRiskPerTrade: 0.5,
  indicatorWeights: { trendEMA: 0.3, rsiReversal: 0.2, bollingerMeanReversion: 0.15, macdMomentum: 0.25, volumeConfirmation: 0.1 },
  rules: ["Require sufficient history.", "Trade only when the composite score clears threshold.", "Size from risk and notional caps.", "Never increase risk after losses.", "Resolve ambiguous OHLC exits conservatively."]
};

export class TradingEngine {
  private vitality: BotVitality;
  private botState: BotState = "HUNTING";
  private strategy: StrategyConfig;
  private activeTrade: Trade | null = null;
  private tradeHistory: Trade[] = [];
  private thoughts: BotThoughtLog[] = [];
  private notifications: ActionNotification[] = [];
  private equityCurve: EquityCurvePoint[] = [];
  private profitWithdrawals: ProfitWithdrawalRecord[] = [];
  private onStateChange?: () => void;
  private readonly riskPolicy: RiskPolicyConfig;
  private readonly learningJournal = new LearningPerformanceJournal();
  private lastProcessedCandleTimestamp = 0;
  private lastSignal: SignalResult | null = null;
  private lastDecisionFeatures: DecisionFeatureSnapshot | null = null;
  private pendingEntry: { direction: "LONG" | "SHORT"; signalScore: number; rationale: string; signalCandle: Candle; features: DecisionFeatureSnapshot } | null = null;
  private lastSpreadBps: number | undefined;
  private lastMarketDataTimestamp = 0;
  private lastMarketDataSource: MarketDataSource | undefined;
  private lastMarketOpen: boolean | undefined;
  private lastDailyKey = "";
  private paperSettings: PaperTradingSettings = { slippageBps: 2, feeTierPercent: 0.04, leverage: 1, soundAlerts: true };
  private static readonly STORAGE_VAULT_KEY = "jarvis_paper_reserve_v2";
  private static readonly STORAGE_WITHDRAWALS_KEY = "jarvis_paper_reserve_ledger_v2";

  constructor(initialCapital = 10000, circuitBreakerThresholdPercent = 6, strategy: StrategyConfig = DEFAULT_STRATEGY, onStateChange?: () => void, riskPolicy: RiskPolicyConfig = DEFAULT_RISK_POLICY) {
    const capital = Number.isFinite(initialCapital) && initialCapital > 0 ? initialCapital : 10000;
    this.strategy = { ...strategy, indicatorWeights: { ...strategy.indicatorWeights } };
    this.onStateChange = onStateChange;
    this.riskPolicy = { ...riskPolicy, maxPeakDrawdownPercent: Math.min(riskPolicy.maxPeakDrawdownPercent, Math.max(0.5, circuitBreakerThresholdPercent)) };
    let savedVault = 0; let saved: ProfitWithdrawalRecord[] = [];
    if (typeof window !== "undefined") { try { savedVault = Number(localStorage.getItem(TradingEngine.STORAGE_VAULT_KEY) || 0) || 0; const raw = localStorage.getItem(TradingEngine.STORAGE_WITHDRAWALS_KEY); if (raw) saved = JSON.parse(raw); } catch {} }
    this.profitWithdrawals = Array.isArray(saved) ? saved : [];
    this.vitality = this.createInitialVitality(capital, this.riskPolicy.maxPeakDrawdownPercent);
    this.lastDailyKey = this.utcDayKey(Date.now());
    this.vitality.securedProfitVault = Math.max(0, savedVault);
    this.vitality.totalProfitWithdrawn = this.profitWithdrawals.reduce((s, r) => s + (Number(r.withdrawnAmount) || 0), 0);
    const now = Date.now();
    this.equityCurve = [{ timestamp: now, timeLabel: new Date(now).toLocaleTimeString(), equity: capital, cash: capital, drawdownPercent: 0, pnlDelta: 0, cumulativePnl: 0, tradeEvent: "Paper run initialized" }];
    this.addNotification({ type: "STRATEGY_LEARNED", title: "Jarvis Finance paper engine ready", message: "Paper account initialized. Real-money execution is not connected.", badgeText: "PAPER" });
  }

  private createInitialVitality(capital: number, drawdownLimit: number): BotVitality {
    return { health: 100, startingCapital: capital, currentEquity: capital, cash: capital, peakEquity: capital, dailyStartEquity: capital, currentDrawdownPercent: 0, maxDrawdownPercent: 0, dailyDrawdownPercent: 0, circuitBreakerThresholdPercent: drawdownLimit, totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, profitFactor: 0, totalPnl: 0, totalFees: 0, survivalStreak: 0, consecutiveLosses: 0, generationsLearned: 0, securedProfitVault: 0, totalProfitWithdrawn: 0, autoWithdrawProfitEnabled: false, withdrawPercentage: 50, minProfitThresholdUsd: 5 };
  }

  public setOnStateChange(cb?: () => void) { this.onStateChange = cb; }
  public getVitality() { return this.vitality; }
  public getBotState() { return this.botState; }
  public getStrategy() { return this.strategy; }
  public getActiveTrade() { return this.activeTrade; }
  public getTradeHistory() { return [...this.tradeHistory]; }
  public getThoughts() { return [...this.thoughts]; }
  public getNotifications() { return [...this.notifications]; }
  public getEquityCurve() { return [...this.equityCurve]; }
  public getLastSignal() { return this.lastSignal; }
  public getLastDecisionFeatures() { return this.lastDecisionFeatures ? { ...this.lastDecisionFeatures } : null; }
  public getLastProcessedCandleTimestamp() { return this.lastProcessedCandleTimestamp; }
  public getLearningRecords(limit = 200) { return this.learningJournal.list(limit); }

  public exportRuntimeState(): TradingEngineRuntimeState {
    return {
      version: 1,
      savedAt: Date.now(),
      vitality: JSON.parse(JSON.stringify(this.vitality)),
      botState: this.botState,
      strategy: JSON.parse(JSON.stringify(this.strategy)),
      activeTrade: this.activeTrade ? JSON.parse(JSON.stringify(this.activeTrade)) : null,
      tradeHistory: JSON.parse(JSON.stringify(this.tradeHistory.slice(0, 1000))),
      thoughts: JSON.parse(JSON.stringify(this.thoughts.slice(0, 200))),
      notifications: JSON.parse(JSON.stringify(this.notifications.slice(0, 100))),
      equityCurve: JSON.parse(JSON.stringify(this.equityCurve.slice(-2000))),
      profitWithdrawals: JSON.parse(JSON.stringify(this.profitWithdrawals.slice(0, 200))),
      learningRecords: JSON.parse(JSON.stringify(this.learningJournal.exportState())),
      lastProcessedCandleTimestamp: this.lastProcessedCandleTimestamp,
    };
  }

  public hydrateRuntimeState(state: TradingEngineRuntimeState): boolean {
    if (!state || state.version !== 1) return false;
    if (!state.vitality || !state.strategy || !Number.isFinite(state.lastProcessedCandleTimestamp)) return false;

    this.vitality = JSON.parse(JSON.stringify(state.vitality));
    this.strategy = {
      ...JSON.parse(JSON.stringify(state.strategy)),
      indicatorWeights: { ...state.strategy.indicatorWeights },
    };
    this.activeTrade = state.activeTrade ? JSON.parse(JSON.stringify(state.activeTrade)) : null;
    this.tradeHistory = Array.isArray(state.tradeHistory) ? JSON.parse(JSON.stringify(state.tradeHistory.slice(0, 1000))) : [];
    this.thoughts = Array.isArray(state.thoughts) ? JSON.parse(JSON.stringify(state.thoughts.slice(0, 200))) : [];
    this.notifications = Array.isArray(state.notifications) ? JSON.parse(JSON.stringify(state.notifications.slice(0, 100))) : [];
    this.equityCurve = Array.isArray(state.equityCurve) ? JSON.parse(JSON.stringify(state.equityCurve.slice(-2000))) : [];
    this.profitWithdrawals = Array.isArray(state.profitWithdrawals) ? JSON.parse(JSON.stringify(state.profitWithdrawals.slice(0, 200))) : [];
    this.learningJournal.hydrate(Array.isArray(state.learningRecords) ? state.learningRecords : []);
    this.lastProcessedCandleTimestamp = Math.max(0, Number(state.lastProcessedCandleTimestamp) || 0);

    // A queued signal is intentionally not persisted across restarts. Requiring a
    // fresh completed-bar signal is safer than replaying an order after an outage.
    this.pendingEntry = null;
    this.lastSignal = null;
    this.lastDecisionFeatures = null;
    this.lastSpreadBps = undefined;
    this.lastMarketDataTimestamp = 0;
    this.lastMarketDataSource = undefined;
    this.lastMarketOpen = undefined;

    if (this.botState === "HALTED_DEAD") {
      this.vitality.health = 0;
    } else if (this.activeTrade) {
      this.botState = "IN_POSITION";
    } else if (this.vitality.health <= 40) {
      this.botState = "DEFENSIVE";
    } else {
      this.botState = "HUNTING";
    }

    return true;
  }

  public markAllNotificationsRead() { this.notifications = this.notifications.map(n => ({ ...n, read: true })); this.notify(); }
  public clearNotifications() { this.notifications = []; this.notify(); }

  public addNotification(notif: Omit<ActionNotification, "id" | "timestamp">) {
    const full: ActionNotification = { id: "NOTIF-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), timestamp: Date.now(), read: false, ...notif };
    this.notifications = [full, ...this.notifications].slice(0, 50);
    try { systemNotificationService.notify(notif.title, { body: notif.message, tag: "jarvis-" + notif.type + "-" + Date.now(), data: notif.details }); } catch {}
  }

  public recordEquitySnapshot(currentPrice?: number, tradeEvent?: string, pnlDelta = 0) {
    const mark = currentPrice || this.activeTrade?.entryPrice || 0;
    const openPnl = this.activeTrade ? paperExecutionAdapter.grossPnL(this.activeTrade.type, this.activeTrade.entryPrice, mark, this.activeTrade.amount) : 0;
    const equity = this.activeTrade ? this.vitality.cash + (this.activeTrade.marginUsd || 0) + openPnl : this.vitality.cash;
    this.equityCurve.push({ timestamp: Date.now(), timeLabel: new Date().toLocaleTimeString(), equity: Number(equity.toFixed(2)), cash: Number(this.vitality.cash.toFixed(2)), drawdownPercent: Number(this.vitality.currentDrawdownPercent.toFixed(2)), pnlDelta: Number(pnlDelta.toFixed(2)), cumulativePnl: Number(this.vitality.totalPnl.toFixed(2)), tradeEvent });
    if (this.equityCurve.length > 500) this.equityCurve.shift();
  }

  public setCircuitBreakerThreshold(percent: number) {
    // This control can tighten the configured ceiling, never widen it.
    const requested = Math.max(0.5, Number(percent) || 0.5);
    const next = Math.min(this.riskPolicy.maxPeakDrawdownPercent, requested);
    this.vitality.circuitBreakerThresholdPercent = next;
    if (this.vitality.currentDrawdownPercent >= next && this.botState !== "HALTED_DEAD") {
      this.triggerCircuitBreaker(
        { timestamp: Date.now(), open: 1, high: 1, low: 1, close: 1, volume: 0 },
        "Configured drawdown threshold was tightened below the current drawdown."
      );
    }
    this.notify();
  }

  public setMarketQuality(input: { spreadBps?: number; dataTimestamp?: number; marketDataSource?: MarketDataSource; marketOpen?: boolean }) {
    this.lastSpreadBps = Number.isFinite(input.spreadBps) ? Math.max(0, Number(input.spreadBps)) : undefined;
    this.lastMarketDataTimestamp = Number.isFinite(input.dataTimestamp) ? Number(input.dataTimestamp) : Date.now();
    this.lastMarketDataSource = input.marketDataSource;
    this.lastMarketOpen = input.marketOpen;
  }
  public getPaperSettings() { return { ...this.paperSettings }; }
  public updatePaperSettings(settings: Partial<PaperTradingSettings>) { const n = { ...this.paperSettings, ...settings }; this.paperSettings = { slippageBps: Math.max(0, Number(n.slippageBps) || 0), feeTierPercent: Math.max(0, Number(n.feeTierPercent) || 0), leverage: 1, soundAlerts: n.soundAlerts ?? true }; soundFx.setEnabled(this.paperSettings.soundAlerts); this.notify(); }

  public updateStrategy(newStrategy: StrategyConfig) {
    if (this.activeTrade) return this.reject("Strategy changes are blocked while a paper position is open.");
    this.strategy = { ...newStrategy, maxRiskPerTrade: Math.min(1, Math.max(0.05, Number(newStrategy.maxRiskPerTrade) || 0.5)), minConfidence: Math.max(50, Math.min(100, Number(newStrategy.minConfidence) || 50)), indicatorWeights: { ...newStrategy.indicatorWeights } };
    this.logThought("OPTIMIZATION", "Strategy configuration updated", "The configuration remains unvalidated until walk-forward and forward-paper evidence exists.", this.strategy.minConfidence);
    this.notify();
  }

  public reviveBot(recapitalAmount?: number) {
    if (this.botState !== "HALTED_DEAD") return;
    const capital = Number(recapitalAmount);
    if (!Number.isFinite(capital) || capital <= 0) return this.reject("Start a new paper run with an explicit balance.");
    this.fullResetAccount(capital);
  }

  public fullResetAccount(initialCapital = 10000) {
    const limit = this.vitality.circuitBreakerThresholdPercent;
    const capital = Number.isFinite(initialCapital) && initialCapital > 0 ? initialCapital : 10000;
    this.vitality = this.createInitialVitality(capital, limit); this.activeTrade = null; this.tradeHistory = []; this.lastDecisionFeatures = null; this.learningJournal.clear(); this.thoughts = []; this.lastSignal = null; this.lastProcessedCandleTimestamp = 0; this.lastSpreadBps = undefined; this.lastMarketDataTimestamp = 0; this.lastMarketDataSource = undefined; this.lastMarketOpen = undefined; this.lastDailyKey = this.utcDayKey(Date.now()); this.botState = "HUNTING";
    this.equityCurve = [{ timestamp: Date.now(), timeLabel: new Date().toLocaleTimeString(), equity: capital, cash: capital, drawdownPercent: 0, pnlDelta: 0, cumulativePnl: 0, tradeEvent: "Paper run reset" }];
    this.addNotification({ type: "RISK_ALERT", title: "Paper account reset", message: "New isolated paper run started. Previous run statistics were cleared.", badgeText: "RESET" });
    this.notify();
  }

  public executePaperTrade(request: PaperOrderRequest, currentPrice: number): boolean {
    if (this.botState === "HALTED_DEAD") return this.reject("Order rejected: circuit breaker is active.");
    if (this.activeTrade) return this.reject("Order rejected: an open position is already active.");
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return this.reject("Order rejected: invalid market price.");
    if (request.leverage !== 1) return this.reject("Order rejected: leverage is disabled.");
    if (request.amountUsd <= 0 || request.stopLossPercent <= 0 || request.takeProfitPercent <= 0) return this.reject("Order rejected: amount, stop, and target must be positive.");
    if (request.amountUsd > this.vitality.cash) return this.reject("Order rejected: requested notional exceeds available paper cash.");
    const notional = request.amountUsd;
    const risk = evaluateRisk(this.riskPolicy, { equity: this.vitality.currentEquity, peakEquity: this.vitality.peakEquity, dailyStartEquity: this.vitality.dailyStartEquity, openPositions: 0, requestedNotional: notional, leverage: 1, marketOpen: this.lastMarketOpen, stopLossPercent: request.stopLossPercent, recentLossCount: this.vitality.consecutiveLosses, lastLossAtMs: this.vitality.lastLossAt }, this.strategy);
    if (!risk.allowed) return this.reject("Order rejected: " + risk.reasons.join(" "));
    this.openPaperPosition(request.type, currentPrice, notional, request.stopLossPercent, request.takeProfitPercent, request.trailingStop, request.manualNote, 0);
    return Boolean(this.activeTrade);
  }

  public runImmediateVerifiedTrade(_currentPrice: number, _preferredType?: "LONG" | "SHORT"): Trade | null {
    this.reject("Direct or instant execution is disabled. Jarvis requires a fresh eligible signal.");
    return null;
  }

  public forceScanSignal(currentCandle: Candle, recentCandles: Candle[]) {
    if (this.botState === "HALTED_DEAD") return { entered: false, confidence: 0, reason: "Circuit breaker active." };
    if (this.activeTrade) return { entered: false, confidence: 0, reason: "An open position is already active." };
    const signal = evaluateSignal(currentCandle, recentCandles, this.strategy); this.lastSignal = signal;
    if (!signal.eligible) { const reason = signal.reasons.join(" ") || "Composite score below threshold."; this.logThought("DEFENSE", "No eligible setup", reason, signal.score); this.notify(); return { entered: false, confidence: signal.score, reason }; }
    const features = buildDecisionFeatureSnapshot(currentCandle, signal, this.strategy, {
      spreadBps: this.lastSpreadBps,
      marketOpen: this.lastMarketOpen,
      marketDataTimestamp: this.lastMarketDataTimestamp || undefined,
      marketDataSource: this.lastMarketDataSource,
    });
    const entered = this.executeEntry(signal.direction as "LONG" | "SHORT", currentCandle.close, signal.score, signal.reasons.join(" | "), currentCandle, features);
    return { entered, confidence: signal.score, reason: entered ? "Eligible paper signal executed." : "Signal passed, but risk controls rejected execution." };
  }

  public simulateEmergencyDrawdownTest(currentPrice: number) {
    if (this.activeTrade) return;
    const synthetic = Math.max(0.01, currentPrice * (1 - (this.vitality.circuitBreakerThresholdPercent + 0.5) / 100));
    this.vitality.currentEquity = synthetic; this.vitality.cash = synthetic;
    this.vitality.currentDrawdownPercent = Number((((this.vitality.peakEquity - synthetic) / Math.max(1, this.vitality.peakEquity)) * 100).toFixed(2));
    this.triggerCircuitBreaker({ timestamp: Date.now(), open: synthetic, high: synthetic, low: synthetic, close: synthetic, volume: 0 }, "Paper-only circuit-breaker test");
  }

  public onTick(currentCandle: Candle, recentCandles: Candle[]) {
    if (!currentCandle || currentCandle.timestamp <= 0) return;
    this.rollDailyBoundary(currentCandle.timestamp);
    this.updateEquityAndHealth(currentCandle.close);

    if (this.activeTrade) this.manageActiveTrade(currentCandle);

    if (currentCandle.timestamp !== this.lastProcessedCandleTimestamp) {
      this.lastProcessedCandleTimestamp = currentCandle.timestamp;

      // A strategy signal becomes an order on the NEXT completed bar's open.
      // This keeps unattended paper execution aligned with the backtester and
      // prevents using the signal bar's closing price as an execution fill.
      if (this.pendingEntry && !this.activeTrade && this.botState !== "HALTED_DEAD") {
        const pending = this.pendingEntry;
        this.pendingEntry = null;
        this.executeEntry(
          pending.direction,
          currentCandle.open,
          pending.signalScore,
          pending.rationale,
          pending.signalCandle,
          pending.features
        );
      } else if (this.pendingEntry && (this.activeTrade || this.botState === "HALTED_DEAD")) {
        this.pendingEntry = null;
      }

      if (!this.activeTrade && this.botState !== "HALTED_DEAD" && !this.pendingEntry) {
        this.evaluateEntry(currentCandle, recentCandles);
      }
    }

    this.recordEquitySnapshot(currentCandle.close);
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
      this.logThought("STUDY", "New UTC risk day", "Daily loss budget reset. The loss streak is intentionally preserved across days.");
    }
  }

  private updateEquityAndHealth(currentPrice: number) {
    const openPnl = this.activeTrade ? paperExecutionAdapter.grossPnL(this.activeTrade.type, this.activeTrade.entryPrice, currentPrice, this.activeTrade.amount) : 0;
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

    // Resolve the current completed bar using the stop/target state that existed
    // before this bar began. Updating a trailing stop from the same bar's high/low
    // before resolving that bar would introduce intrabar look-ahead bias.
    const priorStop = trade.stopLoss;
    const result = paperExecutionAdapter.resolveStopTarget(trade.type, candle, priorStop, trade.takeProfit);

    if (result.kind !== "NONE") {
      const status = result.kind === "TARGET" ? "CLOSED_TAKE_PROFIT" : "CLOSED_STOP_LOSS";
      const reason = result.ambiguous
        ? "OHLC bar hit stop and target; conservative stop-first resolution applied."
        : result.kind === "TARGET"
        ? "Target reached."
        : "Protective stop reached.";
      this.closeTrade(result.price, status, reason);
      return;
    }

    // The bar closed without an exit. Its favorable excursion can now update the
    // trailing stop for the NEXT bar only.
    if (trade.type === "LONG") {
      trade.highestPrice = Math.max(trade.highestPrice || trade.entryPrice, candle.high);
      if (this.strategy.trailingStop) {
        trade.stopLoss = Number(
          Math.max(trade.stopLoss, trade.highestPrice * (1 - this.strategy.trailingStopPercent / 100)).toFixed(4)
        );
      }
    } else {
      trade.lowestPrice = Math.min(trade.lowestPrice || trade.entryPrice, candle.low);
      if (this.strategy.trailingStop) {
        trade.stopLoss = Number(
          Math.min(trade.stopLoss, trade.lowestPrice * (1 + this.strategy.trailingStopPercent / 100)).toFixed(4)
        );
      }
    }

    trade.pnl = Number(paperExecutionAdapter.grossPnL(trade.type, trade.entryPrice, candle.close, trade.amount).toFixed(2));
    trade.pnlPercent = Number((trade.pnl / Math.max(1, trade.sizeUsd) * 100).toFixed(2));
  }

  private evaluateEntry(candle: Candle, recentCandles: Candle[]) {
    const signal = evaluateSignal(candle, recentCandles, this.strategy);
    this.lastSignal = signal;
    this.lastDecisionFeatures = null;

    if (!signal.eligible) {
      this.logThought("STUDY", "No eligible setup", signal.reasons.join(" ") || "Composite score below threshold.", signal.score);
      return;
    }

    const features = buildDecisionFeatureSnapshot(candle, signal, this.strategy, {
      recordedAt: Date.now(),
      spreadBps: this.lastSpreadBps,
      marketOpen: this.lastMarketOpen,
      marketDataTimestamp: this.lastMarketDataTimestamp || undefined,
      marketDataSource: this.lastMarketDataSource,
    });
    this.pendingEntry = {
      direction: signal.direction as "LONG" | "SHORT",
      signalScore: signal.score,
      rationale: signal.reasons.join(" | "),
      signalCandle: candle,
      features,
    };
    this.logThought(
      "SIGNAL",
      "Eligible setup queued for next bar",
      `Signal score ${signal.score}; ${signal.direction} will only be filled at the next completed bar open after risk re-check.`,
      signal.score
    );
  }

  private executeEntry(type: "LONG" | "SHORT", expectedPrice: number, signalScore: number, rationale: string, signalCandle?: Candle, features?: DecisionFeatureSnapshot) {
    const stopDistance = Math.max(0.001, this.strategy.stopLossPercent / 100);
    const configuredRiskBudget = this.vitality.currentEquity * Math.min(Math.max(0, Number(this.strategy.maxRiskPerTrade) || 0), 1) / 100;
    const intendedRiskNotional = Math.min(
      this.vitality.currentEquity * this.riskPolicy.maxPositionNotionalPercent / 100,
      configuredRiskBudget / stopDistance,
      this.vitality.cash
    );
    if (this.lastMarketDataTimestamp > 0 && Date.now() - this.lastMarketDataTimestamp > 30_000) {
      this.logThought("DEFENSE", "Signal rejected: stale market data", "No new trusted market snapshot has arrived within 30 seconds.", signalScore);
      return false;
    }
    const risk = evaluateRisk(this.riskPolicy, {
      equity: this.vitality.currentEquity,
      peakEquity: this.vitality.peakEquity,
      dailyStartEquity: this.vitality.dailyStartEquity,
      openPositions: 0,
      requestedNotional: intendedRiskNotional,
      leverage: 1,
      spreadBps: this.lastSpreadBps,
      marketOpen: this.lastMarketOpen,
      candle: signalCandle,
      stopLossPercent: this.strategy.stopLossPercent,
      recentLossCount: this.vitality.consecutiveLosses,
      lastLossAtMs: this.vitality.lastLossAt
    }, this.strategy);
    if (!risk.allowed) { this.logThought("DEFENSE", "Signal rejected by risk policy", risk.reasons.join(" "), signalScore); return false; }
    const riskSize = risk.maxLossBudgetUsd / stopDistance;
    const maxNotional = this.vitality.currentEquity * this.riskPolicy.maxPositionNotionalPercent / 100;
    const notional = Math.min(riskSize, maxNotional, this.vitality.cash);
    if (notional < 10) { this.logThought("DEFENSE", "Signal rejected: position too small", "Risk budget cannot support a meaningful paper order.", signalScore); return false; }
    const fill = paperExecutionAdapter.entryFill({ expectedPrice, side: type, notionalUsd: notional, settings: this.paperSettings });
    this.openPaperPosition(type, fill.fillPrice, notional, this.strategy.stopLossPercent, this.strategy.takeProfitPercent, this.strategy.trailingStop, rationale, signalScore, fill.feeUsd, fill.slippageUsd, features);
    return Boolean(this.activeTrade);
  }
  private openPaperPosition(type: "LONG" | "SHORT", expectedPrice: number, notional: number, stopLossPercent: number, takeProfitPercent: number, trailingStop: boolean, rationale?: string, signalScore = 0, feeOverride?: number, slippageOverride?: number, learningFeatures?: DecisionFeatureSnapshot) {
    const fill = feeOverride === undefined
      ? paperExecutionAdapter.entryFill({ expectedPrice, side: type, notionalUsd: notional, settings: this.paperSettings })
      : { expectedPrice, fillPrice: expectedPrice, feeUsd: feeOverride, slippageUsd: slippageOverride || 0 };
    if (notional + fill.feeUsd > this.vitality.cash) return;
    const amount = notional / fill.fillPrice;
    this.vitality.cash = Number((this.vitality.cash - notional - fill.feeUsd).toFixed(2));
    const stopLoss = type === "LONG" ? fill.fillPrice * (1 - stopLossPercent / 100) : fill.fillPrice * (1 + stopLossPercent / 100);
    const takeProfit = type === "LONG" ? fill.fillPrice * (1 + takeProfitPercent / 100) : fill.fillPrice * (1 - takeProfitPercent / 100);
    const trade: Trade = { id: "PTRD-" + Date.now().toString(36).toUpperCase(), asset: this.strategy.asset, type, entryPrice: Number(fill.fillPrice.toFixed(4)), amount: Number(amount.toFixed(8)), sizeUsd: Number(notional.toFixed(2)), marginUsd: Number(notional.toFixed(2)), entryTime: Date.now(), stopLoss: Number(stopLoss.toFixed(4)), takeProfit: Number(takeProfit.toFixed(4)), highestPrice: fill.fillPrice, lowestPrice: fill.fillPrice, pnl: 0, pnlPercent: 0, feesUsd: Number(fill.feeUsd.toFixed(2)), slippageUsd: Number(fill.slippageUsd.toFixed(2)), status: "OPEN", signalScore, confidence: signalScore, rationale: rationale || "User-authorized paper order.", learningFeatures, botSurvivalNote: "Paper execution only. Signal score is not a probability." };
    this.vitality.totalFees = Number((this.vitality.totalFees + fill.feeUsd).toFixed(2));
    this.activeTrade = trade; this.botState = "IN_POSITION";
    this.addNotification({ type: "TRADE_OPENED", title: "Paper " + type + " " + trade.asset + " opened", message: "Fill $" + trade.entryPrice.toLocaleString() + " | Notional $" + trade.sizeUsd.toFixed(2) + " | Signal Score " + (signalScore || "manual"), badgeText: "PAPER", details: { asset: trade.asset, price: trade.entryPrice, size: trade.sizeUsd } });
    this.logThought("EXECUTION", "Paper position opened", "Entry fee $" + fill.feeUsd.toFixed(2) + "; modeled slippage $" + fill.slippageUsd.toFixed(2) + ".", signalScore);
    if (this.paperSettings.soundAlerts) soundFx.playOrderFilled(); this.recordEquitySnapshot(trade.entryPrice, "Paper position opened");
  }

  public closeTrade(requestedExitPrice: number, status: "CLOSED_TAKE_PROFIT" | "CLOSED_STOP_LOSS" | "CLOSED_MANUAL" | "EMERGENCY_LIQUIDATED", reason: string) {
    const trade = this.activeTrade; if (!trade) return;
    const exitEstimate = Math.abs(trade.amount * requestedExitPrice);
    const fill = paperExecutionAdapter.exitFill({ expectedPrice: requestedExitPrice, side: trade.type, notionalUsd: exitEstimate, settings: this.paperSettings });
    trade.exitPrice = Number(fill.fillPrice.toFixed(4)); trade.exitTime = Date.now(); trade.status = status;
    const entryFee = trade.feesUsd || 0;
    const gross = paperExecutionAdapter.grossPnL(trade.type, trade.entryPrice, fill.fillPrice, trade.amount);
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
    this.tradeHistory.unshift({ ...trade });
    this.learningJournal.recordTrade(trade, this.strategy, trade.exitTime || Date.now());
    strategyVaultInstance.recordTradeOutcome(this.strategy, trade);
    if (typeof window !== "undefined") {
      try {
        void cryptoSecurityService.appendTradeToAuditLedger({
          id: trade.id,
          asset: trade.asset,
          type: trade.type,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice || requestedExitPrice,
          pnl: trade.pnl,
          timestamp: trade.exitTime || Date.now(),
        }).catch(() => {});
      } catch {}
    }
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
  private notify() { this.onStateChange?.(); }
}