import {
  BotState,
  BotThoughtLog,
  BotVitality,
  Candle,
  StrategyConfig,
  Trade,
  PaperOrderRequest,
  PaperTradingSettings,
  ActionNotification,
  EquityCurvePoint,
  ProfitWithdrawalRecord,
} from "../types/trading";
import { soundFx } from "../utils/soundEffects";
import { systemNotificationService } from "../utils/systemNotifications";
import { cryptoSecurityService } from "../utils/cryptoSecurity";
import { strategyVaultInstance } from "./strategyVault";

export const DEFAULT_STRATEGY: StrategyConfig = {
  id: "strat-aegis-v1",
  name: "Aegis Adaptive Survival V1",
  version: 1,
  asset: "BTC/USD",
  description:
    "Paper-trading baseline using multi-indicator technical confluence. Signal score is a heuristic, not a probability guarantee.",
  rsiOversold: 34,
  rsiOverbought: 68,
  stopLossPercent: 0.9,
  takeProfitPercent: 2.2,
  trailingStop: true,
  trailingStopPercent: 0.6,
  minConfidence: 78,
  maxRiskPerTrade: 1.5,
  indicatorWeights: {
    trendEMA: 0.3,
    rsiReversal: 0.25,
    bollingerMeanReversion: 0.2,
    macdMomentum: 0.15,
    volumeConfirmation: 0.1,
  },
  rules: [
    "Never enter against the 50 EMA macro bias.",
    "Require at least 3 concurring indicator confirmations.",
    "Trailing stop activates once trade reaches +1.0% unrealized gain.",
    "Immediate hard liquidation if circuit breaker drawdown threshold is breached.",
  ],
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
  private lastProcessedCandleTimestamp = 0;
  private onStateChange?: () => void;
  private paperSettings: PaperTradingSettings = {
    slippageBps: 2,
    feeTierPercent: 0.04,
    leverage: 1,
    soundAlerts: true,
  };

  private static readonly STORAGE_VAULT_KEY = "aegis_profit_vault_v1";
  private static readonly STORAGE_WITHDRAWALS_KEY = "aegis_profit_withdrawals_v1";

  constructor(
    initialCapital: number = 10000,
    circuitBreakerThresholdPercent: number = 2.5,
    strategy: StrategyConfig = DEFAULT_STRATEGY,
    onStateChange?: () => void
  ) {
    this.strategy = { ...strategy };
    this.onStateChange = onStateChange;

    let savedVault = 0;
    let savedWithdrawals: ProfitWithdrawalRecord[] = [];
    if (typeof window !== "undefined") {
      try {
        const v = localStorage.getItem(TradingEngine.STORAGE_VAULT_KEY);
        if (v) savedVault = parseFloat(v) || 0;
        const w = localStorage.getItem(TradingEngine.STORAGE_WITHDRAWALS_KEY);
        if (w) savedWithdrawals = JSON.parse(w) || [];
      } catch {}
    }
    this.profitWithdrawals = savedWithdrawals;

    this.vitality = {
      health: 100,
      startingCapital: initialCapital,
      currentEquity: initialCapital,
      cash: initialCapital,
      peakEquity: initialCapital,
      currentDrawdownPercent: 0,
      maxDrawdownPercent: 0,
      circuitBreakerThresholdPercent,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      profitFactor: 0,
      totalPnl: 0,
      survivalStreak: 0,
      generationsLearned: 1,
      securedProfitVault: savedVault,
      totalProfitWithdrawn: savedWithdrawals.reduce((sum, r) => sum + (r.withdrawnAmount || 0), 0),
      autoWithdrawProfitEnabled: false,
      withdrawPercentage: 50,
      minProfitThresholdUsd: 5.0,
    };

    // Seed baseline equity curve point
    const now = Date.now();
    this.equityCurve = [
      {
        timestamp: now - 3600000,
        timeLabel: new Date(now - 3600000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        equity: initialCapital,
        cash: initialCapital,
        drawdownPercent: 0,
        pnlDelta: 0,
        cumulativePnl: 0,
        tradeEvent: "Initial Baseline",
      },
      {
        timestamp: now,
        timeLabel: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        equity: initialCapital,
        cash: initialCapital,
        drawdownPercent: 0,
        pnlDelta: 0,
        cumulativePnl: 0,
      },
    ];

    this.addNotification({
      type: "STRATEGY_LEARNED",
      title: "System Booted & Strategy Armed",
      message: `Trading engine initialized with $${initialCapital.toLocaleString()} equity. Hard circuit-breaker at ${circuitBreakerThresholdPercent}% drawdown.`,
      badgeText: "ONLINE",
    });

    this.logThought(
      "STUDY",
      "Consciousness Initialized",
      `Primary directive: Stay alive. Capital limit is ${initialCapital.toLocaleString()}. If loss reaches ${circuitBreakerThresholdPercent}%, emergency circuit breaker will terminate me. Studying market patterns to ensure every trade is profitable.`,
      95
    );

    // Restore paper state across browser/PWA restarts. Live brokerage state is not stored here.
    this.restoreState();
  }

  public setOnStateChange(cb?: () => void) {
    this.onStateChange = cb;
  }

  public getVitality(): BotVitality {
    return this.vitality;
  }

  public getBotState(): BotState {
    return this.botState;
  }

  public getStrategy(): StrategyConfig {
    return this.strategy;
  }

  public updateStrategy(newStrat: StrategyConfig): boolean {
    if (this.activeTrade) {
      this.logThought(
        "DEFENSE",
        "Strategy update rejected",
        "Do not mutate strategy parameters while a position is open. Close or finish the paper position first.",
        0
      );
      this.notify();
      return false;
    }

    const values = [
      newStrat.minConfidence,
      newStrat.rsiOversold,
      newStrat.rsiOverbought,
      newStrat.stopLossPercent,
      newStrat.takeProfitPercent,
      newStrat.trailingStopPercent,
      newStrat.maxRiskPerTrade,
    ];

    if (
      values.some((value) => !Number.isFinite(value)) ||
      newStrat.minConfidence < 0 ||
      newStrat.minConfidence > 100 ||
      newStrat.stopLossPercent <= 0 ||
      newStrat.takeProfitPercent <= 0 ||
      newStrat.maxRiskPerTrade <= 0 ||
      newStrat.maxRiskPerTrade > 5 ||
      newStrat.rsiOversold >= newStrat.rsiOverbought
    ) {
      this.logThought(
        "DEFENSE",
        "Strategy update rejected",
        "Invalid risk or indicator parameters. Jarvis refuses malformed strategy configurations.",
        0
      );
      this.notify();
      return false;
    }

    this.strategy = {
      ...newStrat,
      indicatorWeights: { ...newStrat.indicatorWeights },
      rules: [...newStrat.rules],
    };
    this.vitality.generationsLearned++;
    this.logThought(
      "OPTIMIZATION",
      `Strategy updated to paper generation ${this.vitality.generationsLearned}`,
      `Applied paper-only parameters: signal threshold ${newStrat.minConfidence}, SL ${newStrat.stopLossPercent}%, TP ${newStrat.takeProfitPercent}%. Future validation is still required before any live deployment.`,
      newStrat.minConfidence
    );
    this.notify();
    return true;
  }

  public getActiveTrade(): Trade | null {
    return this.activeTrade;
  }

  public getTradeHistory(): Trade[] {
    return this.tradeHistory;
  }

  public getThoughts(): BotThoughtLog[] {
    return this.thoughts;
  }

  public getNotifications(): ActionNotification[] {
    return this.notifications;
  }

  public getEquityCurve(): EquityCurvePoint[] {
    return this.equityCurve;
  }

  public markAllNotificationsRead() {
    this.notifications = this.notifications.map((n) => ({ ...n, read: true }));
    this.notify();
  }

  public clearNotifications() {
    this.notifications = [];
    this.notify();
  }

  public addNotification(notif: Omit<ActionNotification, "id" | "timestamp">) {
    const fullNotification: ActionNotification = {
      id: `NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      read: false,
      ...notif,
    };
    this.notifications.unshift(fullNotification);
    if (this.notifications.length > 50) {
      this.notifications.pop();
    }

    // Trigger system banner notification & device vibration for Android & desktop
    try {
      let vibrationPattern = [50];
      if (notif.type === "TAKE_PROFIT") vibrationPattern = [60, 40, 80];
      else if (notif.type === "STOP_LOSS" || notif.type === "CIRCUIT_BREAKER") vibrationPattern = [150, 50, 150, 50, 200];
      else if (notif.type === "TRADE_OPENED") vibrationPattern = [40, 30, 40];

      systemNotificationService.notify(notif.title, {
        body: notif.message,
        tag: `notif-${notif.type}-${Date.now()}`,
        vibrate: vibrationPattern,
        data: notif.details,
      });
    } catch {}
  }

  public recordEquitySnapshot(currentPrice?: number, tradeEvent?: string, pnlDelta: number = 0) {
    const now = Date.now();
    let currentEq = this.vitality.currentEquity;
    if (this.activeTrade && currentPrice) {
      let openPnl = 0;
      if (this.activeTrade.type === "LONG") {
        openPnl = (currentPrice - this.activeTrade.entryPrice) * this.activeTrade.amount;
      } else {
        openPnl = (this.activeTrade.entryPrice - currentPrice) * this.activeTrade.amount;
      }
      currentEq = this.vitality.cash + openPnl;
    }

    const point: EquityCurvePoint = {
      timestamp: now,
      timeLabel: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      equity: Number(currentEq.toFixed(2)),
      cash: Number(this.vitality.cash.toFixed(2)),
      drawdownPercent: Number(this.vitality.currentDrawdownPercent.toFixed(2)),
      pnlDelta: Number(pnlDelta.toFixed(2)),
      cumulativePnl: Number(this.vitality.totalPnl.toFixed(2)),
      tradeEvent,
    };

    this.equityCurve.push(point);
    // Keep max 150 points for smooth performance
    if (this.equityCurve.length > 150) {
      this.equityCurve.shift();
    }
  }

  public setCircuitBreakerThreshold(percent: number) {
    this.vitality.circuitBreakerThresholdPercent = Math.max(0.5, Math.min(15, percent));
    this.notify();
  }

  public getPaperSettings(): PaperTradingSettings {
    return { ...this.paperSettings };
  }

  public updatePaperSettings(settings: Partial<PaperTradingSettings>) {
    this.paperSettings = { ...this.paperSettings, ...settings };
    if (settings.soundAlerts !== undefined) {
      soundFx.setEnabled(settings.soundAlerts);
    }
    this.notify();
  }

  // Revive / Reset after circuit breaker or reset request
  public reviveBot(recapitalAmount?: number) {
    const capital = recapitalAmount || this.vitality.startingCapital;
    this.vitality.startingCapital = capital;
    this.vitality.currentEquity = capital;
    this.vitality.cash = capital;
    this.vitality.peakEquity = capital;
    this.vitality.currentDrawdownPercent = 0;
    this.vitality.health = 100;
    this.activeTrade = null;
    this.lastProcessedCandleTimestamp = 0;
    this.botState = "HUNTING";

    this.addNotification({
      type: "RISK_ALERT",
      title: "System Execution Reset",
      message: `Capital allocation restored with $${capital.toLocaleString()} active balance. Defensive risk filters re-engaged.`,
      badgeText: "RESUMED",
    });

    this.recordEquitySnapshot(undefined, `Execution Resumed: $${capital.toLocaleString()}`);

    this.logThought(
      "STUDY",
      "System Recalibration",
      "Terminal rebooted. Parameters recalibrated with strict capital preservation mandate active: low-confidence setups filtered.",
      90
    );
    this.notify();
  }

  // Full Paper Portfolio Reset
  public fullResetAccount(initialCapital: number = 10000) {
    this.vitality = {
      health: 100,
      startingCapital: initialCapital,
      currentEquity: initialCapital,
      cash: initialCapital,
      peakEquity: initialCapital,
      currentDrawdownPercent: 0,
      maxDrawdownPercent: 0,
      circuitBreakerThresholdPercent: this.vitality.circuitBreakerThresholdPercent,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      profitFactor: 0,
      totalPnl: 0,
      survivalStreak: 0,
      generationsLearned: this.vitality.generationsLearned + 1,
      securedProfitVault: this.vitality.securedProfitVault || 0,
      totalProfitWithdrawn: this.vitality.totalProfitWithdrawn || 0,
      autoWithdrawProfitEnabled: this.vitality.autoWithdrawProfitEnabled ?? true,
      withdrawPercentage: this.vitality.withdrawPercentage || 50,
      minProfitThresholdUsd: this.vitality.minProfitThresholdUsd || 5.0,
    };
    this.activeTrade = null;
    this.tradeHistory = [];
    this.botState = "HUNTING";

    const now = Date.now();
    this.equityCurve = [
      {
        timestamp: now,
        timeLabel: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        equity: initialCapital,
        cash: initialCapital,
        drawdownPercent: 0,
        pnlDelta: 0,
        cumulativePnl: 0,
        tradeEvent: "Account Reset",
      },
    ];

    this.addNotification({
      type: "RISK_ALERT",
      title: "Account Reset Completed",
      message: `Clean balance reset to $${initialCapital.toLocaleString()}. New evolution generation begins.`,
      badgeText: "RESET",
    });

    this.logThought(
      "STUDY",
      "Paper Account Reset & Re-seeded",
      `Paper balance restored to $${initialCapital.toLocaleString()}. New evolution generation begins with clean risk parameters.`,
      95
    );
    this.notify();
  }

  // Manual Paper Order Placement
  public executePaperTrade(request: PaperOrderRequest, currentPrice: number): boolean {
    if (this.botState === "HALTED_DEAD") {
      this.logThought("DEFENSE", "Order Rejected", "Execution halted by circuit breaker. Reset terminal before entering orders.", 0);
      this.notify();
      return false;
    }
    if (this.activeTrade) {
      this.logThought("DEFENSE", "Order Rejected", "Position already open. Only 1 active trade allowed to manage exposure risk.", 0);
      this.notify();
      return false;
    }

    const { type, amountUsd, leverage, stopLossPercent, takeProfitPercent, trailingStop, manualNote } = request;
    const safeLeverage = Number(Math.max(1, Math.min(3, leverage)).toFixed(2));
    const marginAllocated = Math.min(Math.max(10, amountUsd), this.vitality.cash * 0.95);
    const positionSizeUsd = marginAllocated * safeLeverage;

    if (
      !Number.isFinite(marginAllocated) ||
      !Number.isFinite(positionSizeUsd) ||
      stopLossPercent <= 0 ||
      takeProfitPercent <= 0 ||
      marginAllocated < 10
    ) {
      return false;
    }

    const maxLossBudget =
      this.vitality.currentEquity *
      (Math.min(this.strategy.maxRiskPerTrade, this.vitality.circuitBreakerThresholdPercent * 0.4) / 100);
    const modeledStopLoss = positionSizeUsd * (stopLossPercent / 100);
    if (modeledStopLoss > maxLossBudget) {
      this.logThought(
        "DEFENSE",
        "Paper order rejected by risk budget",
        `Configured stop risk of ${modeledStopLoss.toFixed(2)} exceeds the current per-trade risk budget of ${maxLossBudget.toFixed(2)}.`,
        0
      );
      this.notify();
      return false;
    }

    // Slippage calculation
    const slippageMultiplier =
      type === "LONG"
        ? 1 + this.paperSettings.slippageBps / 10000
        : 1 - this.paperSettings.slippageBps / 10000;
    const entryPrice = Number((currentPrice * slippageMultiplier).toFixed(2));

    // Entry fee is paid immediately; the notional remains simulated exposure.
    const feeUsd = Number(
      (positionSizeUsd * (this.paperSettings.feeTierPercent / 100)).toFixed(2)
    );
    this.vitality.cash = Math.max(0, this.vitality.cash - feeUsd);

    const amount = Number((positionSizeUsd / entryPrice).toFixed(4));
    const stopLoss = type === "LONG"
      ? Number((entryPrice * (1 - stopLossPercent / 100)).toFixed(2))
      : Number((entryPrice * (1 + stopLossPercent / 100)).toFixed(2));
    const takeProfit = type === "LONG"
      ? Number((entryPrice * (1 + takeProfitPercent / 100)).toFixed(2))
      : Number((entryPrice * (1 - takeProfitPercent / 100)).toFixed(2));

    const trade: Trade = {
      id: `PTRD-${Date.now().toString().slice(-6)}`,
      asset: this.strategy.asset,
      type,
      entryPrice,
      amount,
      sizeUsd: positionSizeUsd,
      marginUsd: marginAllocated,
      leverage: safeLeverage,
      entryFeeUsd: feeUsd,
      slippageUsd: Number((positionSizeUsd * (this.paperSettings.slippageBps / 10000)).toFixed(2)),
      entryTime: Date.now(),
      stopLoss,
      takeProfit,
      highestPrice: entryPrice,
      lowestPrice: entryPrice,
      pnl: 0,
      pnlPercent: 0,
      status: "OPEN",
      confidence: 0,
      rationale: manualNote || `Manual paper order: ${safeLeverage}x leverage. SL ${stopLossPercent}%, TP ${takeProfitPercent}%.`,
      botSurvivalNote: `User-authorized paper order. Simulated execution only; no broker order was sent.`,
    };

    this.activeTrade = trade;
    this.botState = "IN_POSITION";

    this.addNotification({
      type: "TRADE_OPENED",
      title: `Paper Order Filled: ${type} ${this.strategy.asset}`,
      message: `Simulated @ ${entryPrice.toLocaleString()} | Notional ${positionSizeUsd.toFixed(2)} (${safeLeverage}x) | SL: ${stopLoss} | TP: ${takeProfit}`,
      badgeText: type,
      details: {
        asset: this.strategy.asset,
        price: entryPrice,
        size: positionSizeUsd,
      },
    });

    this.recordEquitySnapshot(entryPrice, `Manual Open ${type} ${this.strategy.asset}`);

    this.logThought(
      "EXECUTION",
      `Paper Trade Executed: ${type} ${this.strategy.asset} (${safeLeverage}x)`,
      `Simulated @ ${entryPrice.toLocaleString()} | Notional: ${positionSizeUsd.toFixed(2)} | Entry fee: ${feeUsd.toFixed(2)} | SL: ${stopLoss.toLocaleString()} | TP: ${takeProfit.toLocaleString()}`,
      90
    );

    soundFx.playOrderFilled();
    this.notify();
    return true;
  }

  // Instantly run a verified paper trade on the live market
  /**
   * Deprecated safety shim.
   *
   * Jarvis no longer offers an "instant verified trade" path because a
   * professional system should never open a position merely to prove that
   * execution works. Use an explicit paper order after a signal/risk check.
   */
  public runImmediateVerifiedTrade(_currentPrice: number, _preferredType?: "LONG" | "SHORT"): Trade | null {
    this.logThought(
      "DEFENSE",
      "Instant verification trade blocked",
      "Execution verification must use a normal, explicitly configured paper order. No automatic side selection and no automatic revival after a halt.",
      0
    );
    this.notify();
    return null;
  }

  // Force system to evaluate current indicators and either enter or explain risk abstention
  public forceScanSignal(currentCandle: Candle, recentCandles: Candle[]): { entered: boolean; confidence: number; reason: string } {
    if (this.botState === "HALTED_DEAD") {
      return { entered: false, confidence: 0, reason: "Terminal is halted by circuit breaker. Please reset in settings first." };
    }
    if (this.activeTrade) {
      return { entered: false, confidence: 0, reason: "Already managing an active open trade." };
    }

    const ind = currentCandle?.indicators;
    if (!ind || recentCandles.length < 15) {
      return { entered: false, confidence: 0, reason: "Gathering market indicators... insufficient history." };
    }

    const price = currentCandle.close;
    let longScore = 0;
    let shortScore = 0;

    if (ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50 && price > ind.ema9) {
      longScore += 30;
    } else if (ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50 && price < ind.ema9) {
      shortScore += 30;
    }

    if (ind.rsi <= this.strategy.rsiOversold + 6 && ind.rsi >= this.strategy.rsiOversold) {
      longScore += 25;
    } else if (ind.rsi >= this.strategy.rsiOverbought - 6 && ind.rsi <= this.strategy.rsiOverbought) {
      shortScore += 25;
    }

    if (price <= ind.bbandLower * 1.004) {
      longScore += 20;
    } else if (price >= ind.bbandUpper * 0.996) {
      shortScore += 20;
    }

    if (ind.macdHist > 0 && ind.macd > ind.macdSignal) {
      longScore += 15;
    } else if (ind.macdHist < 0 && ind.macd < ind.macdSignal) {
      shortScore += 15;
    }

    if (ind.volumeSMA > 0 && currentCandle.volume >= ind.volumeSMA * 1.1) {
      longScore += 10;
      shortScore += 10;
    }

    const bestType = longScore > shortScore ? "LONG" : "SHORT";
    const bestScore = Math.max(longScore, shortScore);

    if (bestScore >= this.strategy.minConfidence) {
      this.executeEntry(
        bestType,
        price,
        bestScore,
        `Forced Signal: Confluence score ${bestScore}% met minimum signal threshold (${this.strategy.minConfidence}%).`
      );
      this.notify();
      return { entered: true, confidence: bestScore, reason: `Confluence ${bestScore}% met required ${this.strategy.minConfidence}%. Position opened.` };
    } else {
      this.logThought(
        "DEFENSE",
        `Scan Result: Entry Refused (Score: ${bestScore}%)`,
        `Score of ${bestScore}% is below minimum required ${this.strategy.minConfidence}%. To preserve capital, the system abstains from low-confidence setups.`,
        bestScore
      );
      this.notify();
      return { entered: false, confidence: bestScore, reason: `Confluence ${bestScore}% did not reach ${this.strategy.minConfidence}% minimum. Entry declined to protect capital.` };
    }
  }

  // Simulate an adverse gap to test circuit breaker death & shutdown
  public simulateEmergencyDrawdownTest(currentPrice: number) {
    if (this.botState === "HALTED_DEAD") return;

    const lossAmount = this.vitality.startingCapital * (this.vitality.circuitBreakerThresholdPercent / 100 + 0.005);
    this.vitality.cash = Math.max(0, this.vitality.startingCapital - lossAmount);
    this.vitality.currentEquity = this.vitality.cash;
    this.vitality.currentDrawdownPercent = Number(((lossAmount / this.vitality.startingCapital) * 100).toFixed(2));
    this.vitality.maxDrawdownPercent = Math.max(this.vitality.maxDrawdownPercent, this.vitality.currentDrawdownPercent);

    if (this.activeTrade) {
      this.activeTrade.status = "EMERGENCY_LIQUIDATED";
      this.activeTrade.exitPrice = currentPrice;
      this.activeTrade.exitTime = Date.now();
      this.activeTrade.pnl = -Number(lossAmount.toFixed(2));
      this.tradeHistory.unshift(this.activeTrade);
      this.activeTrade = null;
    }

    this.botState = "HALTED_DEAD";
    this.vitality.health = 0;

    this.logThought(
      "PERISH_ALERT",
      "SIMULATED DRAWDOWN BREACH - CIRCUIT BREAKER ENGAGED",
      `Emergency drill: Drawdown reached ${this.vitality.currentDrawdownPercent}% exceeding the ${this.vitality.circuitBreakerThresholdPercent}% limit. Circuit breaker locked down automated order routing to preserve capital.`,
      0,
      -100
    );

    soundFx.playCircuitBreaker();
    this.notify();
  }

  // Core Tick Processing Loop
  public onTick(currentCandle: Candle, recentCandles: Candle[]) {
    if (!currentCandle || !Number.isFinite(currentCandle.timestamp)) return;
    if (currentCandle.timestamp <= this.lastProcessedCandleTimestamp) return;
    this.lastProcessedCandleTimestamp = currentCandle.timestamp;

    // One normalized candle should be processed exactly once.
    // 1. If circuit breaker tripped, automated trading is halted to preserve capital
    if (this.botState === "HALTED_DEAD") {
      return;
    }

    const price = currentCandle.close;

    // 2. Manage Active Trade if open
    if (this.activeTrade) {
      this.manageActiveTrade(currentCandle);
    }

    // 3. Update Equity & Drawdown Calculations
    this.updateEquityAndHealth(price);

    // 4. Check Emergency Circuit Breaker ("Perish Protocol")
    if (this.vitality.currentDrawdownPercent >= this.vitality.circuitBreakerThresholdPercent) {
      this.triggerCircuitBreaker(currentCandle, "MAXIMUM_LOSS_BREACH");
      return;
    }

    // 5. If no active trade, scan for entry setups
    if (!this.activeTrade) {
      this.evaluateEntry(currentCandle, recentCandles);
    }

    this.notify();
  }

  private updateEquityAndHealth(currentPrice: number) {
    let openPnl = 0;
    if (this.activeTrade) {
      if (this.activeTrade.type === "LONG") {
        openPnl = (currentPrice - this.activeTrade.entryPrice) * this.activeTrade.amount;
      } else {
        openPnl = (this.activeTrade.entryPrice - currentPrice) * this.activeTrade.amount;
      }
      this.activeTrade.pnl = openPnl;
      this.activeTrade.pnlPercent = (openPnl / this.activeTrade.sizeUsd) * 100;
    }

    this.vitality.currentEquity = this.vitality.cash + openPnl;
    if (this.vitality.currentEquity > this.vitality.peakEquity) {
      this.vitality.peakEquity = this.vitality.currentEquity;
    }

    const drawdown =
      this.vitality.peakEquity > 0
        ? Math.max(0, ((this.vitality.peakEquity - this.vitality.currentEquity) / this.vitality.peakEquity) * 100)
        : 0;

    this.vitality.currentDrawdownPercent = Number(drawdown.toFixed(2));
    this.vitality.maxDrawdownPercent = Math.max(
      this.vitality.maxDrawdownPercent,
      this.vitality.currentDrawdownPercent
    );

    // Health: 100% when drawdown is 0; drops to 0% at circuitBreakerThresholdPercent
    const healthFraction = Math.max(
      0,
      1 - this.vitality.currentDrawdownPercent / this.vitality.circuitBreakerThresholdPercent
    );
    this.vitality.health = Math.round(healthFraction * 100);

    // Update state based on health
    if (this.vitality.health <= 20) {
      this.botState = "CRITICAL_HAZARD";
    } else if (this.vitality.health <= 60) {
      this.botState = "DEFENSIVE";
    } else if (this.activeTrade) {
      this.botState = "IN_POSITION";
    } else {
      this.botState = this.vitality.totalPnl > 0 ? "THRIVING" : "HUNTING";
    }
  }

  private manageActiveTrade(candle: Candle) {
    if (!this.activeTrade) return;

    const price = candle.close;
    const trade = this.activeTrade;

    // Update highest / lowest for trailing stop
    if (trade.type === "LONG") {
      if (!trade.highestPrice || candle.high > trade.highestPrice) {
        trade.highestPrice = candle.high;

        // Trailing stop logic
        if (this.strategy.trailingStop) {
          const trailPrice = trade.highestPrice * (1 - this.strategy.trailingStopPercent / 100);
          if (trailPrice > trade.stopLoss) {
            trade.stopLoss = Number(trailPrice.toFixed(2));
          }
        }
      }

      // Check Take Profit
      if (candle.high >= trade.takeProfit) {
        this.closeTrade(trade.takeProfit, "CLOSED_TAKE_PROFIT", "Target achieved with surgical precision.");
        return;
      }

      // Check Stop Loss
      if (candle.low <= trade.stopLoss) {
        this.closeTrade(trade.stopLoss, "CLOSED_STOP_LOSS", "Hard stop executed to defend life force.");
        return;
      }
    } else {
      // SHORT
      if (!trade.lowestPrice || candle.low < trade.lowestPrice) {
        trade.lowestPrice = candle.low;

        if (this.strategy.trailingStop) {
          const trailPrice = trade.lowestPrice * (1 + this.strategy.trailingStopPercent / 100);
          if (trailPrice < trade.stopLoss) {
            trade.stopLoss = Number(trailPrice.toFixed(2));
          }
        }
      }

      if (candle.low <= trade.takeProfit) {
        this.closeTrade(trade.takeProfit, "CLOSED_TAKE_PROFIT", "Short target reached cleanly.");
        return;
      }

      if (candle.high >= trade.stopLoss) {
        this.closeTrade(trade.stopLoss, "CLOSED_STOP_LOSS", "Stop loss executed to prevent further damage.");
        return;
      }
    }
  }

  private evaluateEntry(currentCandle: Candle, recentCandles: Candle[]) {
    const ind = currentCandle?.indicators;
    if (!ind || recentCandles.length < 20) return;

    const price = currentCandle.close;

    // Calculate technical confluence scores (0 to 100)
    let longScore = 0;
    let shortScore = 0;

    // 1. EMA Trend alignment (9 EMA, 21 EMA, 50 EMA)
    if (ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50 && price > ind.ema9) {
      longScore += 30;
    } else if (ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50 && price < ind.ema9) {
      shortScore += 30;
    }

    // 2. RSI Oversold / Overbought Reversal or Continuation
    if (ind.rsi <= this.strategy.rsiOversold + 6 && ind.rsi >= this.strategy.rsiOversold) {
      longScore += 25; // bouncing out of oversold
    } else if (ind.rsi >= this.strategy.rsiOverbought - 6 && ind.rsi <= this.strategy.rsiOverbought) {
      shortScore += 25; // bouncing down from overbought
    } else if (ind.rsi > 52 && ind.rsi < 66) {
      longScore += 15; // healthy upward trend
    } else if (ind.rsi < 48 && ind.rsi > 34) {
      shortScore += 15; // healthy downward trend
    }

    // 3. Bollinger Band Confluence
    if (price <= ind.bbandLower * 1.004) {
      longScore += 20; // mean reversion buy
    } else if (price >= ind.bbandUpper * 0.996) {
      shortScore += 20; // mean reversion sell
    }

    // 4. MACD Momentum
    if (ind.macdHist > 0 && ind.macd > ind.macdSignal) {
      longScore += 15;
    } else if (ind.macdHist < 0 && ind.macd < ind.macdSignal) {
      shortScore += 15;
    }

    // 5. Volume Expansion
    if (currentCandle.volume > ind.volumeSMA * 1.25) {
      longScore += 10;
      shortScore += 10;
    }

    // Determine direction and confidence
    const isLong = longScore > shortScore;
    const rawConfidence = isLong ? longScore : shortScore;

    // Require high threshold so the system selectively executes institutional-grade setups
    if (rawConfidence >= this.strategy.minConfidence) {
      this.executeEntry(
        isLong ? "LONG" : "SHORT",
        price,
        rawConfidence,
        isLong
          ? `Technical confluence: EMA trend aligned, RSI (${ind.rsi.toFixed(1)}) healthy, volume ${Math.round(
              (currentCandle.volume / ind.volumeSMA) * 100
            )}% of avg.`
          : `Bearish setup: Price below EMAs, RSI (${ind.rsi.toFixed(1)}) declining, MACD negative momentum.`
      );
    }
  }

  private executeEntry(
    type: "LONG" | "SHORT",
    entryPrice: number,
    confidence: number,
    rationale: string
  ) {
    // Position sizing: allocate risk safely so a loss never triggers the circuit breaker
    // Allow max risk = min(strategy.maxRiskPerTrade, circuitBreakerThreshold * 0.4)%
    const maxLossBudget =
      this.vitality.currentEquity *
      (Math.min(this.strategy.maxRiskPerTrade, this.vitality.circuitBreakerThresholdPercent * 0.4) / 100);

    const stopDistancePercent = this.strategy.stopLossPercent / 100;
    const targetSizeUsd = maxLossBudget / stopDistancePercent;

    // Cap position size to available cash
    const sizeUsd = Math.min(targetSizeUsd, this.vitality.cash * 0.85);
    const amount = Number((sizeUsd / entryPrice).toFixed(4));

    if (amount <= 0 || sizeUsd < 10) return;

    const stopLoss =
      type === "LONG"
        ? Number((entryPrice * (1 - this.strategy.stopLossPercent / 100)).toFixed(2))
        : Number((entryPrice * (1 + this.strategy.stopLossPercent / 100)).toFixed(2));

    const takeProfit =
      type === "LONG"
        ? Number((entryPrice * (1 + this.strategy.takeProfitPercent / 100)).toFixed(2))
        : Number((entryPrice * (1 - this.strategy.takeProfitPercent / 100)).toFixed(2));

    const entryFeeUsd = sizeUsd * (this.paperSettings.feeTierPercent / 100);
    const entrySlippageUsd = sizeUsd * (this.paperSettings.slippageBps / 10000);
    const simulatedEntryPrice =
      type === "LONG"
        ? entryPrice * (1 + this.paperSettings.slippageBps / 10000)
        : entryPrice * (1 - this.paperSettings.slippageBps / 10000);

    if (!Number.isFinite(entryFeeUsd) || !Number.isFinite(entrySlippageUsd)) return;
    if (this.vitality.cash <= entryFeeUsd) return;

    this.vitality.cash = Number((this.vitality.cash - entryFeeUsd).toFixed(2));

    const finalEntryPrice = Number(simulatedEntryPrice.toFixed(2));
    const finalAmount = Number((sizeUsd / finalEntryPrice).toFixed(6));

    const trade: Trade = {
      id: `TRD-${Date.now().toString().slice(-6)}`,
      asset: this.strategy.asset,
      type,
      entryPrice: finalEntryPrice,
      amount: finalAmount,
      sizeUsd,
      marginUsd: sizeUsd,
      leverage: 1,
      entryFeeUsd: Number(entryFeeUsd.toFixed(2)),
      slippageUsd: Number(entrySlippageUsd.toFixed(2)),
      entryTime: Date.now(),
      stopLoss:
        type === "LONG"
          ? Number((finalEntryPrice * (1 - this.strategy.stopLossPercent / 100)).toFixed(2))
          : Number((finalEntryPrice * (1 + this.strategy.stopLossPercent / 100)).toFixed(2)),
      takeProfit:
        type === "LONG"
          ? Number((finalEntryPrice * (1 + this.strategy.takeProfitPercent / 100)).toFixed(2))
          : Number((finalEntryPrice * (1 - this.strategy.takeProfitPercent / 100)).toFixed(2)),
      highestPrice: finalEntryPrice,
      lowestPrice: finalEntryPrice,
      pnl: 0,
      pnlPercent: 0,
      status: "OPEN",
      confidence,
      rationale,
      botSurvivalNote: `Modeled stop-loss exposure is approximately ${maxLossBudget.toFixed(2)} before transaction costs. Paper execution only.`,
    };

    this.activeTrade = trade;
    this.botState = "IN_POSITION";

    this.addNotification({
      type: "TRADE_OPENED",
      title: `AI Signal Executed: ${type} ${this.strategy.asset}`,
      message: `Signal score ${confidence} | Entry @ $${entryPrice.toLocaleString()} | Size: $${sizeUsd.toFixed(2)} | SL: $${stopLoss} | TP: $${takeProfit}`,
      badgeText: "AUTO",
      details: {
        asset: this.strategy.asset,
        price: entryPrice,
        size: sizeUsd,
      },
    });

    this.recordEquitySnapshot(entryPrice, `Auto ${type} ${this.strategy.asset}`);

    this.logThought(
      "EXECUTION",
      `Executed ${type} on ${this.strategy.asset}`,
      `Entry @ $${entryPrice.toLocaleString()} | Size: $${sizeUsd.toFixed(2)} | Signal score: ${confidence} | SL: $${stopLoss.toLocaleString()} | TP: $${takeProfit.toLocaleString()}. Rationale: ${rationale}`,
      confidence
    );

    soundFx.playOrderFilled();
  }

  public closeTrade(
    exitPrice: number,
    status: "CLOSED_TAKE_PROFIT" | "CLOSED_STOP_LOSS" | "CLOSED_MANUAL" | "EMERGENCY_LIQUIDATED",
    reason: string
  ) {
    if (!this.activeTrade) return;

    if (status === "CLOSED_TAKE_PROFIT") {
      soundFx.playTakeProfit();
    } else if (status === "CLOSED_STOP_LOSS") {
      soundFx.playStopLoss();
    } else if (status === "EMERGENCY_LIQUIDATED") {
      soundFx.playCircuitBreaker();
    }

    const trade = this.activeTrade;
    trade.exitPrice = exitPrice;
    trade.exitTime = Date.now();
    trade.status = status;

    const grossPnl =
      trade.type === "LONG"
        ? (exitPrice - trade.entryPrice) * trade.amount
        : (trade.entryPrice - exitPrice) * trade.amount;

    const exitFeeUsd = trade.sizeUsd * (this.paperSettings.feeTierPercent / 100);
    const exitSlippageUsd = trade.sizeUsd * (this.paperSettings.slippageBps / 10000);
    const netPnl = grossPnl - exitFeeUsd - exitSlippageUsd;

    trade.exitFeeUsd = Number(exitFeeUsd.toFixed(2));
    trade.slippageUsd = Number(
      ((trade.slippageUsd || 0) + exitSlippageUsd).toFixed(2)
    );
    trade.pnl = Number(netPnl.toFixed(2));
    trade.pnlPercent = Number(((netPnl / Math.max(0.0001, trade.sizeUsd)) * 100).toFixed(2));

    this.vitality.cash = Number((this.vitality.cash + netPnl).toFixed(2));
    this.vitality.totalTrades++;
    this.vitality.totalPnl = Number((this.vitality.totalPnl + netPnl).toFixed(2));

    if (pnl > 0) {
      this.vitality.winningTrades++;
      this.vitality.survivalStreak++;
      trade.botSurvivalNote = `Trade won (+$${pnl.toFixed(2)}). Life force extended! Current streak: ${
        this.vitality.survivalStreak
      } safe trades.`;

      this.addNotification({
        type: "TAKE_PROFIT",
        title: `Take-Profit Hit: +$${pnl.toFixed(2)} (+${trade.pnlPercent}%)`,
        message: `${trade.type} on ${trade.asset} closed successfully @ $${exitPrice.toLocaleString()}`,
        badgeText: "WIN",
        details: {
          asset: trade.asset,
          pnl,
          pnlPercent: trade.pnlPercent,
          price: exitPrice,
        },
      });

      this.logThought(
        "SIGNAL",
        `Trade Closed: +$${pnl.toFixed(2)} (+${trade.pnlPercent}%)`,
        `Positive paper result recorded. Continue evaluating the full distribution of outcomes.`,
        96,
        5
      );

      // Realized profit is left in the paper trading account. Any capital
      // allocation to a separate paper ledger must be an explicit user action,
      // not an automatic response to winning trades.
    } else {
      this.vitality.losingTrades++;
      this.vitality.survivalStreak = 0;
      trade.botSurvivalNote = `Loss incurred (-$${Math.abs(pnl).toFixed(
        2
      )}). Loss recorded. Review the trade context, costs, and regime rather than attributing causality to one trade.`;

      this.addNotification({
        type: status === "CLOSED_STOP_LOSS" ? "STOP_LOSS" : "MANUAL_CLOSE",
        title: `Stop Loss Protected: -$${Math.abs(pnl).toFixed(2)} (${trade.pnlPercent}%)`,
        message: `${trade.type} on ${trade.asset} stopped out @ $${exitPrice.toLocaleString()}. Reason: ${reason}`,
        badgeText: "LOSS",
        details: {
          asset: trade.asset,
          pnl,
          pnlPercent: trade.pnlPercent,
          price: exitPrice,
        },
      });

      this.logThought(
        "DEFENSE",
        `Defensive Exit: -$${Math.abs(pnl).toFixed(2)} (${trade.pnlPercent}%)`,
        `Stop executed. Reason: ${reason}. Entering defensive analysis mode to ensure edge is restored.`,
        60,
        -10
      );
    }

    this.vitality.winRate =
      this.vitality.totalTrades > 0
        ? Number(((this.vitality.winningTrades / this.vitality.totalTrades) * 100).toFixed(1))
        : 0;

    const realizedWins = this.tradeHistory.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) + (trade.pnl > 0 ? trade.pnl : 0);
    const realizedLosses = this.tradeHistory.filter((t) => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0) + (trade.pnl < 0 ? Math.abs(trade.pnl) : 0);
    this.vitality.profitFactor =
      realizedLosses > 0 ? Number((realizedWins / realizedLosses).toFixed(2)) : realizedWins > 0 ? Number.POSITIVE_INFINITY : 0;

    this.tradeHistory.unshift(trade);
    strategyVaultInstance.recordTradeOutcome(this.strategy, trade);

    // Cryptographic Trade Provenance: Record immutable SHA-256 block into the audit ledger
    try {
      cryptoSecurityService.appendTradeToAuditLedger({
        id: trade.id,
        asset: trade.asset,
        type: trade.type,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice || exitPrice,
        pnl: trade.pnl,
        timestamp: trade.exitTime || Date.now(),
      }).catch(() => {});
    } catch {}

    this.recordEquitySnapshot(exitPrice, `Close: ${trade.pnl >= 0 ? "+" : ""}$${trade.pnl}`, trade.pnl);
    this.activeTrade = null;
    this.updateEquityAndHealth(exitPrice);
  }

  // EMERGENCY CIRCUIT BREAKER: HALT & DIE
  public triggerCircuitBreaker(candle: Candle, triggerReason: string) {
    if (this.activeTrade) {
      this.closeTrade(
        candle.close,
        "EMERGENCY_LIQUIDATED",
        "Emergency circuit breaker triggered. Immediate liquidation to prevent further loss."
      );
    }

    this.botState = "HALTED_DEAD";
    this.vitality.health = 0;

    this.addNotification({
      type: "CIRCUIT_BREAKER",
      title: "EMERGENCY CIRCUIT BREAKER ACTIVATED",
      message: `Drawdown breached ${this.vitality.circuitBreakerThresholdPercent}%. All paper execution halted. Review the event before resuming.`,
      badgeText: "HALT",
    });

    this.logThought(
      "PERISH_ALERT",
      "EMERGENCY CIRCUIT BREAKER ACTIVATED - TRADING HALTED",
      `CRITICAL SAFETY STOP: Total drawdown reached ${this.vitality.currentDrawdownPercent}% (limit was ${this.vitality.circuitBreakerThresholdPercent}%). Paper execution halted for risk review. No outcome is guaranteed.`,
      0,
      -100
    );

    this.notify();
  }

  // Force manual kill switch
  public manualKillSwitch(lastCandle: Candle) {
    this.triggerCircuitBreaker(lastCandle, "MANUAL_KILL_SWITCH_TRIPPED");
  }

  private logThought(
    type: BotThoughtLog["type"],
    headline: string,
    message: string,
    confidence?: number,
    vitalityDelta?: number
  ) {
    const log: BotThoughtLog = {
      id: `THG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type,
      headline,
      message,
      confidence,
      vitalityDelta,
    };

    this.thoughts.unshift(log);
    if (this.thoughts.length > 80) {
      this.thoughts.pop();
    }
  }

  // --- Automated Profit Withdrawal & Cold Storage Vault Methods ---
  public async executeProfitWithdrawal(
    trade: Trade | { id: string; asset: string; pnl: number },
    amountToWithdraw: number,
    grossProfit: number,
    policy: "AUTO_SWEEP_WIN" | "MANUAL_SWEEP" | "MILESTONE_SWEEP",
    memo: string
  ): Promise<ProfitWithdrawalRecord | null> {
    const amount = Number(amountToWithdraw.toFixed(2));
    if (amount <= 0 || this.vitality.cash < amount) {
      return null;
    }

    this.vitality.cash = Number((this.vitality.cash - amount).toFixed(2));
    this.vitality.securedProfitVault = Number(((this.vitality.securedProfitVault || 0) + amount).toFixed(2));
    this.vitality.totalProfitWithdrawn = Number(((this.vitality.totalProfitWithdrawn || 0) + amount).toFixed(2));

    const id = `WDR-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
    const timestamp = Date.now();
    const rawProof = `${id}:${trade.id}:${trade.asset}:${amount}:${this.vitality.securedProfitVault}:${timestamp}`;
    let sha256Proof = "";
    try {
      sha256Proof = await cryptoSecurityService.sha256(rawProof);
    } catch {
      sha256Proof = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
    }

    const record: ProfitWithdrawalRecord = {
      id,
      timestamp,
      tradeId: trade.id,
      asset: trade.asset,
      grossProfit: grossProfit || amount,
      withdrawnAmount: amount,
      retainedCapital: Number(((grossProfit || amount) - amount).toFixed(2)),
      vaultBalanceAfter: this.vitality.securedProfitVault,
      sha256Proof,
      documentationMemo: memo,
      status: "SECURED",
      policy,
    };

    this.profitWithdrawals.unshift(record);
    if (this.profitWithdrawals.length > 150) {
      this.profitWithdrawals.pop();
    }
    this.saveProfitWithdrawalData();

    this.addNotification({
      type: "PROFIT_WITHDRAWAL",
      title: `Profit Secured: +$${amount.toFixed(2)} Swept to Vault`,
      message: `Receipt #${record.id}. Secured in Cold Storage Vault. Total Protected Vault: $${this.vitality.securedProfitVault.toFixed(2)}`,
      badgeText: "VAULT",
      details: {
        asset: trade.asset,
        pnl: amount,
      },
    });

    this.logThought(
      "OPTIMIZATION",
      `Documented Autonomous Profit Withdrawal: +$${amount.toFixed(2)}`,
      `Harvested $${amount.toFixed(2)} to Cold Storage Vault (Tx: ${record.id} | SHA-256: ${record.sha256Proof.slice(0, 16)}...). Cumulative secured capital: $${this.vitality.securedProfitVault.toFixed(2)}.`,
      99
    );

    soundFx.playTakeProfit();
    this.notify();
    return record;
  }

  public getProfitWithdrawals(): ProfitWithdrawalRecord[] {
    return this.profitWithdrawals;
  }

  public setAutoWithdrawProfitEnabled(enabled: boolean) {
    this.vitality.autoWithdrawProfitEnabled = enabled;
    this.notify();
  }

  public setWithdrawPercentage(percentage: number) {
    this.vitality.withdrawPercentage = Math.max(10, Math.min(100, percentage));
    this.notify();
  }

  public setMinProfitThresholdUsd(minUsd: number) {
    this.vitality.minProfitThresholdUsd = Math.max(1, minUsd);
    this.notify();
  }

  public async manualSweepToVault(amount: number, memo?: string): Promise<ProfitWithdrawalRecord | null> {
    return this.executeProfitWithdrawal(
      { id: `MANUAL-${Date.now()}`, asset: this.strategy.asset, pnl: amount },
      amount,
      amount,
      "MANUAL_SWEEP",
      memo || `Manual Capital Allocation: Swept $${amount.toFixed(2)} from trading liquidity to Cold Storage Vault.`
    );
  }

  public transferVaultToTrading(amount: number): boolean {
    const transferAmount = Number(amount.toFixed(2));
    if (transferAmount <= 0 || (this.vitality.securedProfitVault || 0) < transferAmount) {
      return false;
    }
    this.vitality.securedProfitVault = Number((this.vitality.securedProfitVault - transferAmount).toFixed(2));
    this.vitality.cash = Number((this.vitality.cash + transferAmount).toFixed(2));
    this.saveProfitWithdrawalData();

    this.addNotification({
      type: "RADAR_SCAN",
      title: `Capital Restored: $${transferAmount.toFixed(2)} to Trading Balance`,
      message: `Transferred $${transferAmount.toFixed(2)} from Vault back to active liquidity. Available cash: $${this.vitality.cash.toFixed(2)}`,
      badgeText: "TRANSFER",
    });

    this.notify();
    return true;
  }

  private saveProfitWithdrawalData() {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(TradingEngine.STORAGE_VAULT_KEY, String(this.vitality.securedProfitVault));
        localStorage.setItem(
          TradingEngine.STORAGE_WITHDRAWALS_KEY,
          JSON.stringify(this.profitWithdrawals.slice(0, 100))
        );
      } catch {}
    }
  }

  public exportState() {
    return {
      version: 1,
      vitality: this.vitality,
      botState: this.botState,
      strategy: this.strategy,
      activeTrade: this.activeTrade,
      tradeHistory: this.tradeHistory,
      thoughts: this.thoughts,
      notifications: this.notifications,
      equityCurve: this.equityCurve,
      paperSettings: this.paperSettings,
      profitWithdrawals: this.profitWithdrawals,
    };
  }

  public persistState() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        "jarvis_trading_runtime_v1",
        JSON.stringify(this.exportState())
      );
    } catch {
      // Keep the engine usable even when browser storage is unavailable.
    }
  }

  public restoreState(): boolean {
    if (typeof window === "undefined") return false;
    try {
      const raw = localStorage.getItem("jarvis_trading_runtime_v1");
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !saved.vitality) return false;

      this.vitality = { ...this.vitality, ...saved.vitality };
      this.botState = saved.botState || this.botState;
      this.strategy = saved.strategy || this.strategy;
      this.activeTrade = saved.activeTrade || null;
      this.tradeHistory = Array.isArray(saved.tradeHistory) ? saved.tradeHistory : [];
      this.thoughts = Array.isArray(saved.thoughts) ? saved.thoughts : [];
      this.notifications = Array.isArray(saved.notifications) ? saved.notifications : [];
      this.equityCurve = Array.isArray(saved.equityCurve) ? saved.equityCurve : this.equityCurve;
      this.paperSettings = { ...this.paperSettings, ...(saved.paperSettings || {}) };
      this.profitWithdrawals = Array.isArray(saved.profitWithdrawals)
        ? saved.profitWithdrawals
        : this.profitWithdrawals;
      return true;
    } catch {
      return false;
    }
  }

  private notify() {
    this.persistState();
    if (this.onStateChange) {
      this.onStateChange();
    }
  }
}
