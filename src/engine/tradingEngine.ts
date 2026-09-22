
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
  name: "Rules-Based Confluence V1",
  version: 1,
  asset: "BTC/USD",
  description:
    "Paper-only rules-based strategy combining trend, momentum, volatility and volume evidence. No expected return or win-rate target is assumed.",
  rsiOversold: 34,
  rsiOverbought: 68,
  stopLossPercent: 0.9,
  takeProfitPercent: 2.2,
  trailingStop: true,
  trailingStopPercent: 0.6,
  trailingActivationPercent: 1.0,
  minConfidence: 78,
  maxRiskPerTrade: 1.0,
  indicatorWeights: {
    trendEMA: 0.3,
    rsiReversal: 0.25,
    bollingerMeanReversion: 0.2,
    macdMomentum: 0.15,
    volumeConfirmation: 0.1,
  },
  rules: [
    "Never enter without fully warmed indicators.",
    "Signals are formed from a completed bar and can only execute on the following bar.",
    "Position sizing is determined from stop distance and the configured risk budget.",
    "Ambiguous OHLC bars use the adverse stop-first assumption.",
    "No strategy is treated as proven from a short sample or in-sample result.",
  ],
};

const ENGINE_STORAGE_KEY = "jarvis_paper_engine_v2";
const VAULT_STORAGE_KEY = "jarvis_paper_profit_reserve_v2";
const WITHDRAWALS_STORAGE_KEY = "jarvis_paper_profit_reserve_ledger_v2";
const DEFAULT_INITIAL_CAPITAL = 10_000;
const DEFAULT_DAILY_LOSS_LIMIT = 2;
const DEFAULT_MAX_TRADES_PER_DAY = 10;

function idFor(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return prefix + "-" + crypto.randomUUID();
  }
  return prefix + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1_000_000).toString(36);
}

function safeNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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

  private paperSettings: PaperTradingSettings = {
    slippageBps: 2,
    feeTierPercent: 0.04,
    leverage: 1,
    maxLeverage: 2,
    maxPositionPercent: 25,
    maxDailyLossPercent: DEFAULT_DAILY_LOSS_LIMIT,
    maxTradesPerDay: DEFAULT_MAX_TRADES_PER_DAY,
    cooldownAfterLossMinutes: 15,
    maxSpreadBps: 30,
    staleDataMs: 90_000,
    soundAlerts: true,
  };

  private dayKey = "";
  private dayStartEquity = DEFAULT_INITIAL_CAPITAL;
  private lastLossAt = 0;
  private dailyRiskHalted = false;
  private lastProcessedCandleTimestamp = 0;
  private lastSignalCandleTimestamp = 0;
  private pendingSignal: { type: "LONG" | "SHORT"; confidence: number; signalTimestamp: number } | null = null;

  constructor(
    initialCapital: number = DEFAULT_INITIAL_CAPITAL,
    circuitBreakerThresholdPercent: number = 2.5,
    strategy: StrategyConfig = DEFAULT_STRATEGY,
    onStateChange?: () => void,
  ) {
    this.strategy = { ...strategy };
    this.onStateChange = onStateChange;

    let savedReserve = 0;
    let savedWithdrawals: ProfitWithdrawalRecord[] = [];

    if (typeof window !== "undefined") {
      try {
        savedReserve = Math.max(0, safeNumber(localStorage.getItem(VAULT_STORAGE_KEY), 0));
        const rawWithdrawals = localStorage.getItem(WITHDRAWALS_STORAGE_KEY);
        if (rawWithdrawals) {
          const parsed = JSON.parse(rawWithdrawals);
          if (Array.isArray(parsed)) savedWithdrawals = parsed;
        }
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
      circuitBreakerThresholdPercent: Math.max(0.5, Math.min(15, circuitBreakerThresholdPercent)),
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      profitFactor: 0,
      totalPnl: 0,
      survivalStreak: 0,
      generationsLearned: 1,
      securedProfitVault: savedReserve,
      totalProfitWithdrawn: savedWithdrawals.reduce((sum, record) => sum + Math.max(0, safeNumber(record.withdrawnAmount, 0)), 0),
      autoWithdrawProfitEnabled: false,
      withdrawPercentage: 50,
      minProfitThresholdUsd: 5,
      dayStartEquity: initialCapital,
      dailyPnl: 0,
      dailyLossLimitPercent: DEFAULT_DAILY_LOSS_LIMIT,
      tradesToday: 0,
      openRiskUsd: 0,
      marginUsedUsd: 0,
    };

    this.dayKey = this.getUtcDayKey();
    this.dayStartEquity = initialCapital;

    this.loadPaperState(initialCapital);

    this.addNotification({
      type: "STRATEGY_LEARNED",
      title: "Jarvis Paper Engine Ready",
      message:
        "Paper-only simulation initialized. No broker, bank account, wallet or external order is connected to this execution engine.",
      badgeText: "PAPER",
    });

    this.logThought(
      "STUDY",
      "Risk Controls Initialized",
      "Trade statistics start at zero. Entry, sizing, drawdown, daily-loss, cooldown and execution-cost controls are active.",
      100,
    );
  }

  public setOnStateChange(cb?: () => void) {
    this.onStateChange = cb;
  }

  public getVitality(): BotVitality {
    return { ...this.vitality };
  }

  public getBotState(): BotState {
    return this.botState;
  }

  public getStrategy(): StrategyConfig {
    return { ...this.strategy, indicatorWeights: { ...this.strategy.indicatorWeights }, rules: [...this.strategy.rules] };
  }

  public updateStrategy(newStrat: StrategyConfig) {
    const previousFingerprint = JSON.stringify({
      asset: this.strategy.asset,
      stopLossPercent: this.strategy.stopLossPercent,
      takeProfitPercent: this.strategy.takeProfitPercent,
      trailingStop: this.strategy.trailingStop,
      trailingStopPercent: this.strategy.trailingStopPercent,
      minConfidence: this.strategy.minConfidence,
      maxRiskPerTrade: this.strategy.maxRiskPerTrade,
      indicatorWeights: this.strategy.indicatorWeights,
      rsiOversold: this.strategy.rsiOversold,
      rsiOverbought: this.strategy.rsiOverbought,
    });

    const nextFingerprint = JSON.stringify({
      asset: newStrat.asset,
      stopLossPercent: newStrat.stopLossPercent,
      takeProfitPercent: newStrat.takeProfitPercent,
      trailingStop: newStrat.trailingStop,
      trailingStopPercent: newStrat.trailingStopPercent,
      minConfidence: newStrat.minConfidence,
      maxRiskPerTrade: newStrat.maxRiskPerTrade,
      indicatorWeights: newStrat.indicatorWeights,
      rsiOversold: newStrat.rsiOversold,
      rsiOverbought: newStrat.rsiOverbought,
    });

    this.strategy = {
      ...newStrat,
      indicatorWeights: { ...newStrat.indicatorWeights },
      rules: [...newStrat.rules],
    };

    if (previousFingerprint !== nextFingerprint) {
      this.vitality.generationsLearned += 1;
    }

    this.pendingSignal = null;

    this.logThought(
      "OPTIMIZATION",
      previousFingerprint === nextFingerprint ? "Strategy Context Refreshed" : "Strategy Revision Recorded",
      "New strategy parameters are paper-only. Jarvis will not treat an AI suggestion or parameter change as validated edge.",
      50,
    );

    this.persistPaperState();
    this.notify();
  }

  public getActiveTrade(): Trade | null {
    return this.activeTrade ? { ...this.activeTrade } : null;
  }

  public getTradeHistory(): Trade[] {
    return this.tradeHistory.map((trade) => ({ ...trade }));
  }

  public getThoughts(): BotThoughtLog[] {
    return this.thoughts.map((thought) => ({ ...thought }));
  }

  public getNotifications(): ActionNotification[] {
    return this.notifications.map((notification) => ({ ...notification }));
  }

  public getEquityCurve(): EquityCurvePoint[] {
    return this.equityCurve.map((point) => ({ ...point }));
  }

  public markAllNotificationsRead() {
    this.notifications = this.notifications.map((notification) => ({ ...notification, read: true }));
    this.persistPaperState();
    this.notify();
  }

  public clearNotifications() {
    this.notifications = [];
    this.persistPaperState();
    this.notify();
  }

  public addNotification(notif: Omit<ActionNotification, "id" | "timestamp">) {
    const fullNotification: ActionNotification = {
      id: idFor("NOTIF"),
      timestamp: Date.now(),
      read: false,
      ...notif,
    };

    this.notifications.unshift(fullNotification);
    if (this.notifications.length > 80) this.notifications.pop();

    try {
      const vibrationPattern =
        notif.type === "CIRCUIT_BREAKER"
          ? [150, 50, 150, 50, 200]
          : notif.type === "STOP_LOSS"
            ? [120, 60, 120]
            : notif.type === "TAKE_PROFIT"
              ? [50, 40, 70]
              : notif.type === "TRADE_OPENED"
                ? [30, 30, 30]
                : [35];

      void systemNotificationService.notify(notif.title, {
        body: notif.message,
        tag: "jarvis-" + notif.type + "-" + Date.now(),
        vibrate: vibrationPattern,
        data: notif.details,
      });
    } catch {}

    this.persistPaperState();
  }

  public recordEquitySnapshot(currentPrice?: number, tradeEvent?: string, pnlDelta = 0) {
    const now = Date.now();
    const currentEq = this.calculateEquity(currentPrice);

    this.equityCurve.push({
      timestamp: now,
      timeLabel: new Date(now).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      equity: Number(currentEq.toFixed(2)),
      cash: Number(this.vitality.cash.toFixed(2)),
      drawdownPercent: Number(this.vitality.currentDrawdownPercent.toFixed(2)),
      pnlDelta: Number(pnlDelta.toFixed(2)),
      cumulativePnl: Number(this.vitality.totalPnl.toFixed(2)),
      tradeEvent,
    });

    if (this.equityCurve.length > 500) this.equityCurve.shift();
    this.persistPaperState();
  }

  public setCircuitBreakerThreshold(percent: number) {
    if (this.botState === "HALTED_DEAD") {
      this.logThought("DEFENSE", "Risk Limit Change Rejected", "The circuit breaker is latched. Start a new paper session before changing its threshold.", 0);
      return;
    }
    this.vitality.circuitBreakerThresholdPercent = Math.max(0.5, Math.min(15, safeNumber(percent, 2.5)));
    this.recalculateHealth();
    this.persistPaperState();
    this.notify();
  }

  public getPaperSettings(): PaperTradingSettings {
    return { ...this.paperSettings };
  }

  public updatePaperSettings(settings: Partial<PaperTradingSettings>) {
    const next: PaperTradingSettings = { ...this.paperSettings, ...settings };

    next.slippageBps = Math.max(0, Math.min(500, safeNumber(next.slippageBps, 2)));
    next.feeTierPercent = Math.max(0, Math.min(2, safeNumber(next.feeTierPercent, 0.04)));
    next.maxLeverage = Math.max(1, Math.min(10, safeNumber(next.maxLeverage, 2)));
    next.leverage = Math.max(1, Math.min(next.maxLeverage, safeNumber(next.leverage, 1)));
    next.maxPositionPercent = Math.max(1, Math.min(100, safeNumber(next.maxPositionPercent, 25)));
    next.maxDailyLossPercent = Math.max(0.25, Math.min(20, safeNumber(next.maxDailyLossPercent, 2)));
    next.maxTradesPerDay = Math.max(1, Math.min(100, Math.floor(safeNumber(next.maxTradesPerDay, 10))));
    next.cooldownAfterLossMinutes = Math.max(0, Math.min(240, safeNumber(next.cooldownAfterLossMinutes, 15)));
    next.maxSpreadBps = Math.max(0, Math.min(500, safeNumber(next.maxSpreadBps, 30)));
    next.staleDataMs = Math.max(5_000, Math.min(600_000, safeNumber(next.staleDataMs, 90_000)));
    next.soundAlerts = Boolean(next.soundAlerts);

    this.paperSettings = next;
    this.vitality.dailyLossLimitPercent = next.maxDailyLossPercent;

    if (settings.soundAlerts !== undefined) soundFx.setEnabled(next.soundAlerts);

    this.persistPaperState();
    this.notify();
  }

  public reviveBot(recapitalAmount?: number): boolean {
    if (this.botState !== "HALTED_DEAD") return false;
    if (!recapitalAmount || recapitalAmount <= 0) {
      this.addNotification({
        type: "RISK_ALERT",
        title: "Paper Session Remains Halted",
        message: "A circuit-breaker halt requires explicit review and a new paper starting balance. Jarvis will not auto-restart itself.",
        badgeText: "REVIEW",
      });
      return false;
    }

    this.startFreshPaperSession(Number(recapitalAmount));
    return true;
  }

  public fullResetAccount(initialCapital = DEFAULT_INITIAL_CAPITAL) {
    this.startFreshPaperSession(initialCapital);
    this.tradeHistory = [];
    this.thoughts = [];
    this.notifications = [];
    this.equityCurve = [];
    this.pendingSignal = null;
    this.lastProcessedCandleTimestamp = 0;
    this.lastSignalCandleTimestamp = 0;

    this.recordEquitySnapshot(undefined, "Paper Account Reset");
    this.addNotification({
      type: "RISK_ALERT",
      title: "Paper Account Reset",
      message: "The active paper account was reset. Strategy evidence in the Strategy Vault is retained separately.",
      badgeText: "RESET",
    });
    this.logThought(
      "STUDY",
      "Paper Account Re-seeded",
      "The account session is clean. Previous strategy test evidence remains available in the Strategy Vault.",
      100,
    );
    this.persistPaperState();
    this.notify();
  }

  public executePaperTrade(request: PaperOrderRequest, currentPrice: number): boolean {
    this.refreshDailyRiskWindow();

    if (this.botState === "HALTED_DEAD") {
      this.logThought("DEFENSE", "Paper Order Rejected", "Circuit breaker is latched. Start a new paper session before trading again.", 0);
      return false;
    }
    if (this.dailyRiskHalted) {
      this.logThought("DEFENSE", "Paper Order Rejected", "Daily loss limit is active. New entries are blocked until the next UTC trading day.", 0);
      return false;
    }
    if (this.activeTrade) {
      this.logThought("DEFENSE", "Paper Order Rejected", "A position is already open. The current risk engine permits one active position.", 0);
      return false;
    }
    if (this.isDataStale(Date.now())) {
      this.logThought("DEFENSE", "Paper Order Rejected", "Market input is stale. No paper fill is created from stale data.", 0);
      return false;
    }

    const type = request.type;
    const price = safeNumber(currentPrice, 0);
    const requestedMargin = safeNumber(request.amountUsd, 0);
    const leverageRequested = safeNumber(request.leverage, 1);
    const stopLossPercent = safeNumber(request.stopLossPercent, 0);
    const takeProfitPercent = safeNumber(request.takeProfitPercent, 0);

    if (price <= 0 || requestedMargin <= 0) return false;
    if (stopLossPercent <= 0 || stopLossPercent > 25) return false;
    if (takeProfitPercent <= 0 || takeProfitPercent > 100) return false;

    const leverage = Math.min(Math.max(1, leverageRequested), this.paperSettings.maxLeverage ?? 2);
    const maxNotional = this.vitality.currentEquity * ((this.paperSettings.maxPositionPercent ?? 25) / 100);
    const maxMarginByRisk =
      this.vitality.currentEquity *
      (Math.min(this.strategy.maxRiskPerTrade, this.vitality.circuitBreakerThresholdPercent * 0.4, 5) / 100) /
      (stopLossPercent / 100);
    const requestedNotional = requestedMargin * leverage;
    const notional = Math.min(requestedNotional, maxNotional, maxMarginByRisk, this.vitality.cash * leverage * 0.95);
    const margin = notional / leverage;

    const entryPrice = this.applyEntrySlippage(price, type);
    const amount = notional / entryPrice;
    const entryFee = notional * (this.paperSettings.feeTierPercent / 100);

    if (margin < 10 || !Number.isFinite(amount) || this.vitality.cash < margin + entryFee) return false;

    const trade = this.createTrade({
      type,
      entryPrice,
      amount,
      sizeUsd: notional,
      marginUsd: margin,
      leverage,
      entryFeeUsd: entryFee,
      stopLossPercent,
      takeProfitPercent,
      trailingStop: Boolean(request.trailingStop),
      confidence: 50,
      rationale:
        request.manualNote ||
        "Manual paper order. Risk engine capped margin/notional and execution costs were modeled.",
    });

    this.vitality.cash = Number((this.vitality.cash - margin - entryFee).toFixed(2));
    this.vitality.marginUsedUsd = margin;
    this.vitality.openRiskUsd = Number((margin * stopLossPercent / 100 + entryFee).toFixed(2));
    this.vitality.tradesToday = (this.vitality.tradesToday ?? 0) + 1;

    this.activeTrade = trade;
    this.botState = "IN_POSITION";

    this.addNotification({
      type: "TRADE_OPENED",
      title: "Paper Order Filled: " + type + " " + this.strategy.asset,
      message:
        "Simulated fill @ $" +
        entryPrice.toLocaleString() +
        " | Notional $" +
        notional.toFixed(2) +
        " | Margin $" +
        margin.toFixed(2) +
        " | " +
        leverage +
        "x | SL $" +
        trade.stopLoss.toFixed(2) +
        " | TP $" +
        trade.takeProfit.toFixed(2),
      badgeText: "PAPER",
      details: { asset: trade.asset, price: entryPrice, size: notional },
    });

    this.recordEquitySnapshot(entryPrice, "Manual Paper Open " + type);
    this.logThought(
      "EXECUTION",
      "Paper Fill: " + type,
      "Simulated order accepted after risk and cost checks. No broker order was submitted.",
      50,
    );
    if (this.paperSettings.soundAlerts) soundFx.playOrderFilled();

    this.persistPaperState();
    this.notify();
    return true;
  }

  public runImmediateVerifiedTrade(_currentPrice: number, _preferredType?: "LONG" | "SHORT"): Trade | null {
    this.addNotification({
      type: "RISK_ALERT",
      title: "Synthetic Verification Trade Disabled",
      message:
        "Jarvis will not manufacture a high-confidence trade simply because a verification button was pressed. Use the signal scanner or manual paper order.",
      badgeText: "NO FABRICATED EDGE",
    });
    this.logThought(
      "DEFENSE",
      "Immediate Trade Request Rejected",
      "A fill cannot be called verified without a validated signal, market data and execution model.",
      0,
    );
    this.notify();
    return null;
  }

  public forceScanSignal(
    currentCandle: Candle,
    recentCandles: Candle[],
  ): { entered: boolean; confidence: number; reason: string; direction?: "LONG" | "SHORT" | "NEUTRAL" } {
    if (this.botState === "HALTED_DEAD") {
      return { entered: false, confidence: 0, direction: "NEUTRAL", reason: "Circuit breaker is latched." };
    }
    if (this.activeTrade) {
      return { entered: false, confidence: 0, direction: "NEUTRAL", reason: "An active position is already open." };
    }
    if (recentCandles.length < 50 || !currentCandle.indicators?.ready) {
      return { entered: false, confidence: 0, direction: "NEUTRAL", reason: "Indicator warm-up is incomplete." };
    }

    const signal = this.calculateSignal(currentCandle);
    if (!signal) {
      this.logThought("DEFENSE", "No Valid Signal", "Current confluence did not pass the strategy threshold. No order was placed.", 0);
      this.notify();
      return { entered: false, confidence: 0, direction: "NEUTRAL", reason: "No validated setup." };
    }

    this.logThought(
      "SIGNAL",
      "Paper Signal Detected: " + signal.type,
      "Confluence " + signal.confidence + "%. Signal is a research observation; this scan does not manufacture a fill.",
      signal.confidence,
    );
    this.notify();

    return {
      entered: false,
      confidence: signal.confidence,
      direction: signal.type,
      reason: "Validated " + signal.type + " setup. No immediate verification fill was created.",
    };
  }

  public simulateEmergencyDrawdownTest(currentPrice: number) {
    if (this.botState === "HALTED_DEAD") return;

    const lossAmount =
      this.vitality.startingCapital *
      (this.vitality.circuitBreakerThresholdPercent / 100 + 0.005);

    this.vitality.cash = Math.max(0, this.vitality.startingCapital - lossAmount);
    this.vitality.currentEquity = this.vitality.cash;
    this.vitality.currentDrawdownPercent =
      (lossAmount / this.vitality.startingCapital) * 100;
    this.vitality.maxDrawdownPercent = Math.max(
      this.vitality.maxDrawdownPercent,
      this.vitality.currentDrawdownPercent,
    );

    if (this.activeTrade) {
      this.activeTrade.status = "EMERGENCY_LIQUIDATED";
      this.activeTrade.exitPrice = currentPrice;
      this.activeTrade.exitTime = Date.now();
      this.activeTrade.pnl = -Number(lossAmount.toFixed(2));
      this.tradeHistory.unshift({ ...this.activeTrade });
      this.activeTrade = null;
    }

    this.botState = "HALTED_DEAD";
    this.vitality.health = 0;
    this.pendingSignal = null;

    this.addNotification({
      type: "CIRCUIT_BREAKER",
      title: "Simulated Risk Breach",
      message:
        "The test intentionally breached the configured drawdown threshold. Automated paper entries are now latched off.",
      badgeText: "HALT",
    });

    this.logThought(
      "PERISH_ALERT",
      "SIMULATED DRAWDOWN BREACH",
      "Emergency drill completed. The circuit breaker halted new automated paper entries. This test does not prove real-world liquidation performance.",
      0,
      -100,
    );

    if (this.paperSettings.soundAlerts) soundFx.playCircuitBreaker();
    this.persistPaperState();
    this.notify();
  }

  public onTick(currentCandle: Candle, recentCandles: Candle[]) {
    if (!currentCandle || this.botState === "HALTED_DEAD") return;

    this.refreshDailyRiskWindow();

    const isNewCandle = currentCandle.timestamp > this.lastProcessedCandleTimestamp;
    if (isNewCandle) this.lastProcessedCandleTimestamp = currentCandle.timestamp;

    // Pending signals are generated from the prior completed bar and executed at the next bar open.
    if (isNewCandle && !this.activeTrade && this.pendingSignal && currentCandle.timestamp > this.pendingSignal.signalTimestamp) {
      if (!this.dailyRiskHalted && this.canOpenNewPosition()) {
        this.executeEntryAtOpen(currentCandle.open, this.pendingSignal);
      }
      this.pendingSignal = null;
    }

    if (this.activeTrade) this.manageActiveTrade(currentCandle);

    this.updateEquityAndHealth(currentCandle.close);

    if (this.vitality.currentDrawdownPercent >= this.vitality.circuitBreakerThresholdPercent) {
      this.triggerCircuitBreaker(currentCandle, "MAXIMUM_LOSS_BREACH");
      return;
    }

    // Only form a new signal once per candle. The App can poll the same live candle multiple times.
    if (
      isNewCandle &&
      !this.activeTrade &&
      !this.dailyRiskHalted &&
      recentCandles.length >= 50 &&
      currentCandle.indicators?.ready &&
      this.lastSignalCandleTimestamp !== currentCandle.timestamp
    ) {
      this.lastSignalCandleTimestamp = currentCandle.timestamp;
      const signal = this.calculateSignal(currentCandle);
      if (signal && this.canOpenNewPosition()) {
        this.pendingSignal = {
          ...signal,
          signalTimestamp: currentCandle.timestamp,
        };
        this.logThought(
          "SIGNAL",
          "Signal Queued for Next Bar",
          signal.type +
            " confluence " +
            signal.confidence +
            "%. Entry, if still valid, will be evaluated at the next bar open.",
          signal.confidence,
        );
      }
    }

    this.refreshDailyRiskWindow();
    this.persistPaperState();
    this.notify();
  }

  public closeTrade(
    exitPrice: number,
    status: "CLOSED_TAKE_PROFIT" | "CLOSED_STOP_LOSS" | "CLOSED_MANUAL" | "EMERGENCY_LIQUIDATED",
    reason: string,
  ) {
    if (!this.activeTrade) return;

    const trade = this.activeTrade;
    const rawExit = safeNumber(exitPrice, 0);
    if (rawExit <= 0) return;

    const actualExit = this.applyExitSlippage(rawExit, trade.type);
    trade.exitPrice = actualExit;
    trade.exitTime = Date.now();
    trade.status = status;

    const grossPnl = trade.type === "LONG"
      ? (actualExit - trade.entryPrice) * trade.amount
      : (trade.entryPrice - actualExit) * trade.amount;

    const exitFee = Math.abs(actualExit * trade.amount) * (this.paperSettings.feeTierPercent / 100);
    const netPnl = grossPnl - exitFee;
    const margin = trade.marginUsd ?? trade.sizeUsd;

    trade.grossPnlUsd = Number(grossPnl.toFixed(2));
    trade.exitFeeUsd = Number(exitFee.toFixed(2));
    trade.slippageUsd = Number(
      (Math.abs(actualExit - rawExit) * trade.amount).toFixed(2),
    );
    trade.netPnlUsd = Number(netPnl.toFixed(2));
    trade.pnl = Number(netPnl.toFixed(2));
    trade.pnlPercent = Number(((netPnl / Math.max(1, margin)) * 100).toFixed(2));

    this.vitality.cash = Number((this.vitality.cash + margin + netPnl).toFixed(2));
    this.vitality.marginUsedUsd = 0;
    this.vitality.openRiskUsd = 0;
    this.vitality.totalTrades += 1;
    this.vitality.totalPnl = Number((this.vitality.totalPnl + netPnl).toFixed(2));

    if (netPnl > 0) {
      this.vitality.winningTrades += 1;
      this.vitality.survivalStreak += 1;

      this.addNotification({
        type: "TAKE_PROFIT",
        title: "Paper Trade Closed: +$" + netPnl.toFixed(2),
        message:
          trade.type +
          " " +
          trade.asset +
          " closed @ $" +
          actualExit.toLocaleString() +
          " | Net after fees: +$" +
          netPnl.toFixed(2),
        badgeText: "WIN",
        details: {
          asset: trade.asset,
          pnl: netPnl,
          pnlPercent: trade.pnlPercent,
          price: actualExit,
        },
      });

      this.logThought(
        "SIGNAL",
        "Trade Closed Positive",
        "Net P&L after modeled fees/slippage: +$" + netPnl.toFixed(2) + ". This outcome is evidence for the journal, not proof of future edge.",
        70,
      );

      if (this.vitality.autoWithdrawProfitEnabled && netPnl >= this.vitality.minProfitThresholdUsd) {
        const reserveAmount = Number(
          ((netPnl * this.vitality.withdrawPercentage) / 100).toFixed(2),
        );
        if (reserveAmount > 0) {
          void this.executeProfitWithdrawal(
            trade,
            reserveAmount,
            netPnl,
            "AUTO_SWEEP_WIN",
            "Paper accounting reserve only. No external transfer or custody occurred.",
          );
        }
      }
    } else if (netPnl < 0) {
      this.vitality.losingTrades += 1;
      this.vitality.survivalStreak = 0;
      this.lastLossAt = Date.now();

      this.addNotification({
        type: status === "CLOSED_MANUAL" ? "MANUAL_CLOSE" : "STOP_LOSS",
        title: "Paper Trade Closed: -$" + Math.abs(netPnl).toFixed(2),
        message:
          trade.type +
          " " +
          trade.asset +
          " closed @ $" +
          actualExit.toLocaleString() +
          " | " +
          reason,
        badgeText: "LOSS",
        details: {
          asset: trade.asset,
          pnl: netPnl,
          pnlPercent: trade.pnlPercent,
          price: actualExit,
        },
      });

      this.logThought(
        "DEFENSE",
        "Trade Closed Negative",
        "Net P&L after modeled fees/slippage: -$" +
          Math.abs(netPnl).toFixed(2) +
          ". Cooldown and daily risk checks apply before another entry.",
        60,
        -1,
      );
    } else {
      this.vitality.survivalStreak = 0;
      this.addNotification({
        type: "MANUAL_CLOSE",
        title: "Paper Trade Closed: Flat",
        message: trade.type + " " + trade.asset + " closed with approximately zero net P&L.",
        badgeText: "FLAT",
      });
    }

    this.vitality.winRate =
      this.vitality.totalTrades > 0
        ? Number(((this.vitality.winningTrades / this.vitality.totalTrades) * 100).toFixed(2))
        : 0;

    const closed = [...this.tradeHistory, trade];
    const grossWins = closed.filter((item) => item.pnl > 0).reduce((sum, item) => sum + item.pnl, 0);
    const grossLosses = Math.abs(closed.filter((item) => item.pnl < 0).reduce((sum, item) => sum + item.pnl, 0));
    this.vitality.profitFactor =
      grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(3)) : grossWins > 0 ? Infinity : 0;

    this.tradeHistory.unshift({ ...trade });
    strategyVaultInstance.recordTradeOutcome(this.strategy, trade);

    try {
      void cryptoSecurityService.appendTradeToAuditLedger({
        id: trade.id,
        asset: trade.asset,
        type: trade.type,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice || actualExit,
        pnl: trade.pnl,
        timestamp: trade.exitTime || Date.now(),
      });
    } catch {}

    this.activeTrade = null;
    this.pendingSignal = null;
    this.recordEquitySnapshot(actualExit, "Close: " + (trade.pnl >= 0 ? "+" : "") + "$" + trade.pnl, trade.pnl);
    this.updateEquityAndHealth(actualExit);
    this.refreshDailyRiskWindow();

    if (this.paperSettings.soundAlerts) {
      if (netPnl > 0) soundFx.playTakeProfit();
      else if (netPnl < 0) soundFx.playStopLoss();
    }

    this.persistPaperState();
    this.notify();
  }

  public triggerCircuitBreaker(candle: Candle, triggerReason: string) {
    if (this.botState === "HALTED_DEAD") return;

    if (this.activeTrade) {
      // Emergency close at observed candle price. This is a simulation assumption, not a guaranteed fill.
      this.closeTrade(
        candle.close,
        "EMERGENCY_LIQUIDATED",
        "Emergency circuit breaker triggered: " + triggerReason,
      );
    }

    this.botState = "HALTED_DEAD";
    this.vitality.health = 0;
    this.pendingSignal = null;

    this.addNotification({
      type: "CIRCUIT_BREAKER",
      title: "Paper Risk Circuit Breaker Activated",
      message:
        "Drawdown reached the configured paper risk boundary. New automated entries are latched off for review.",
      badgeText: "HALT",
    });

    this.logThought(
      "PERISH_ALERT",
      "Paper Trading Halted",
      "Risk boundary reached. Jarvis stopped new entries; actual live-market liquidation cannot be inferred from this local simulation.",
      0,
      -100,
    );

    if (this.paperSettings.soundAlerts) soundFx.playCircuitBreaker();
    this.persistPaperState();
    this.notify();
  }

  public manualKillSwitch(lastCandle: Candle) {
    if (!lastCandle) return;
    this.triggerCircuitBreaker(lastCandle, "MANUAL_KILL_SWITCH");
  }

  public async executeProfitWithdrawal(
    trade: Trade | { id: string; asset: string; pnl: number },
    amountToWithdraw: number,
    grossProfit: number,
    policy: "AUTO_SWEEP_WIN" | "MANUAL_SWEEP" | "MILESTONE_SWEEP",
    memo: string,
  ): Promise<ProfitWithdrawalRecord | null> {
    const amount = Number(amountToWithdraw.toFixed(2));
    if (amount <= 0 || this.vitality.cash < amount) return null;

    this.vitality.cash = Number((this.vitality.cash - amount).toFixed(2));
    this.vitality.securedProfitVault = Number(((this.vitality.securedProfitVault || 0) + amount).toFixed(2));
    this.vitality.totalProfitWithdrawn = Number(((this.vitality.totalProfitWithdrawn || 0) + amount).toFixed(2));

    const id = idFor("PPR");
    const timestamp = Date.now();
    const rawProof =
      id +
      ":" +
      trade.id +
      ":" +
      trade.asset +
      ":" +
      amount +
      ":" +
      this.vitality.securedProfitVault +
      ":" +
      timestamp;

    let sha256Proof = "";
    try {
      sha256Proof = await cryptoSecurityService.sha256(rawProof);
    } catch {
      // Never fabricate a cryptographic proof.
      this.vitality.cash = Number((this.vitality.cash + amount).toFixed(2));
      this.vitality.securedProfitVault = Number((this.vitality.securedProfitVault - amount).toFixed(2));
      this.vitality.totalProfitWithdrawn = Number((this.vitality.totalProfitWithdrawn - amount).toFixed(2));
      return null;
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
    if (this.profitWithdrawals.length > 500) this.profitWithdrawals.pop();

    this.addNotification({
      type: "PROFIT_WITHDRAWAL",
      title: "Paper Profit Reserve Updated: +$" + amount.toFixed(2),
      message:
        "Receipt " +
        record.id +
        ". This changes only the local paper accounting balance; it does not transfer funds to a bank, wallet or custodian.",
      badgeText: "PAPER RESERVE",
      details: { asset: trade.asset, pnl: amount },
    });

    this.logThought(
      "OPTIMIZATION",
      "Paper Profit Reserve Recorded",
      "Allocated $" +
        amount.toFixed(2) +
        " to the local paper reserve. SHA-256 receipt " +
        sha256Proof.slice(0, 16) +
        "... was generated for audit correlation.",
      80,
    );

    this.saveProfitWithdrawalData();
    this.recordEquitySnapshot(undefined, "Paper Profit Reserve Allocation", 0);
    this.notify();
    return record;
  }

  public getProfitWithdrawals(): ProfitWithdrawalRecord[] {
    return this.profitWithdrawals.map((record) => ({ ...record }));
  }

  public setAutoWithdrawProfitEnabled(enabled: boolean) {
    this.vitality.autoWithdrawProfitEnabled = Boolean(enabled);
    this.persistPaperState();
    this.notify();
  }

  public setWithdrawPercentage(percentage: number) {
    this.vitality.withdrawPercentage = Math.max(10, Math.min(100, safeNumber(percentage, 50)));
    this.persistPaperState();
    this.notify();
  }

  public setMinProfitThresholdUsd(minUsd: number) {
    this.vitality.minProfitThresholdUsd = Math.max(1, safeNumber(minUsd, 5));
    this.persistPaperState();
    this.notify();
  }

  public async manualSweepToVault(amount: number, memo?: string): Promise<ProfitWithdrawalRecord | null> {
    return this.executeProfitWithdrawal(
      { id: idFor("MANUAL"), asset: this.strategy.asset, pnl: amount },
      amount,
      amount,
      "MANUAL_SWEEP",
      memo || "Manual paper accounting allocation to the local profit reserve.",
    );
  }

  public transferVaultToTrading(amount: number): boolean {
    const transferAmount = Number(safeNumber(amount, 0).toFixed(2));
    if (transferAmount <= 0 || (this.vitality.securedProfitVault || 0) < transferAmount) return false;

    this.vitality.securedProfitVault = Number((this.vitality.securedProfitVault - transferAmount).toFixed(2));
    this.vitality.cash = Number((this.vitality.cash + transferAmount).toFixed(2));

    this.addNotification({
      type: "RADAR_SCAN",
      title: "Paper Reserve Returned: $" + transferAmount.toFixed(2),
      message:
        "Returned capital to the local paper trading balance. No external money movement occurred.",
      badgeText: "PAPER TRANSFER",
    });

    this.saveProfitWithdrawalData();
    this.persistPaperState();
    this.notify();
    return true;
  }

  private createTrade(params: {
    type: "LONG" | "SHORT";
    entryPrice: number;
    amount: number;
    sizeUsd: number;
    marginUsd: number;
    leverage: number;
    entryFeeUsd: number;
    stopLossPercent: number;
    takeProfitPercent: number;
    trailingStop: boolean;
    confidence: number;
    rationale: string;
    strategyId?: string;
    signalId?: string;
  }): Trade {
    const stopLoss =
      params.type === "LONG"
        ? params.entryPrice * (1 - params.stopLossPercent / 100)
        : params.entryPrice * (1 + params.stopLossPercent / 100);

    const takeProfit =
      params.type === "LONG"
        ? params.entryPrice * (1 + params.takeProfitPercent / 100)
        : params.entryPrice * (1 - params.takeProfitPercent / 100);

    return {
      id: idFor("TRD"),
      asset: this.strategy.asset,
      type: params.type,
      entryPrice: params.entryPrice,
      amount: params.amount,
      sizeUsd: params.sizeUsd,
      marginUsd: params.marginUsd,
      leverage: params.leverage,
      entryFeeUsd: params.entryFeeUsd,
      entryTime: Date.now(),
      stopLoss: Number(stopLoss.toFixed(8)),
      takeProfit: Number(takeProfit.toFixed(8)),
      highestPrice: params.entryPrice,
      lowestPrice: params.entryPrice,
      pnl: 0,
      pnlPercent: 0,
      status: "OPEN",
      confidence: params.confidence,
      rationale: params.rationale,
      strategyId: params.strategyId ?? this.strategy.id,
      signalId: params.signalId,
      dataTimestamp: Date.now(),
    };
  }

  private executeEntryAtOpen(openPrice: number, signal: { type: "LONG" | "SHORT"; confidence: number; signalTimestamp: number }) {
    const rawOpen = safeNumber(openPrice, 0);
    if (rawOpen <= 0) return;

    const stopDistancePct = Math.max(this.strategy.stopLossPercent / 100, 0.001);
    const riskPct = Math.min(
      this.strategy.maxRiskPerTrade,
      this.vitality.circuitBreakerThresholdPercent * 0.4,
      5,
    );
    const riskBudget = this.vitality.currentEquity * (riskPct / 100);
    const maxNotionalByRisk = riskBudget / stopDistancePct;
    const maxNotionalByAccount =
      this.vitality.currentEquity * ((this.paperSettings.maxPositionPercent ?? 25) / 100);
    const leverage = Math.min(this.paperSettings.leverage, this.paperSettings.maxLeverage ?? 2);

    const notional = Math.min(
      maxNotionalByRisk,
      maxNotionalByAccount,
      this.vitality.cash * leverage * 0.95,
    );
    const margin = notional / leverage;
    if (notional < 10 || margin <= 0 || this.vitality.cash < margin) return;

    const entryPrice = this.applyEntrySlippage(rawOpen, signal.type);
    const amount = notional / entryPrice;
    const entryFee = notional * (this.paperSettings.feeTierPercent / 100);

    if (this.vitality.cash < margin + entryFee) return;

    const trade = this.createTrade({
      type: signal.type,
      entryPrice,
      amount,
      sizeUsd: notional,
      marginUsd: margin,
      leverage,
      entryFeeUsd: entryFee,
      stopLossPercent: this.strategy.stopLossPercent,
      takeProfitPercent: this.strategy.takeProfitPercent,
      trailingStop: this.strategy.trailingStop,
      confidence: signal.confidence,
      rationale:
        "Rules-based signal formed on a completed bar and executed at the next bar open. " +
        signal.confidence +
        "% confluence.",
      signalId: idFor("SIG"),
    });

    this.vitality.cash = Number((this.vitality.cash - margin - entryFee).toFixed(2));
    this.vitality.marginUsedUsd = margin;
    this.vitality.openRiskUsd = Number((riskBudget + entryFee).toFixed(2));
    this.vitality.tradesToday = (this.vitality.tradesToday ?? 0) + 1;

    this.activeTrade = trade;
    this.botState = "IN_POSITION";

    this.addNotification({
      type: "TRADE_OPENED",
      title: "Paper Signal Executed: " + signal.type + " " + this.strategy.asset,
      message:
        "Simulated next-bar fill @ $" +
        entryPrice.toLocaleString() +
        " | Notional $" +
        notional.toFixed(2) +
        " | Risk budget $" +
        riskBudget.toFixed(2) +
        " | SL $" +
        trade.stopLoss.toFixed(2) +
        " | TP $" +
        trade.takeProfit.toFixed(2),
      badgeText: "AUTO-PAPER",
      details: { asset: trade.asset, price: entryPrice, size: notional },
    });

    this.logThought(
      "EXECUTION",
      "Queued Signal Executed",
      "Next-bar paper fill accepted after risk and execution-cost checks. No external order was submitted.",
      signal.confidence,
    );

    if (this.paperSettings.soundAlerts) soundFx.playOrderFilled();
  }

  private calculateSignal(candle: Candle): { type: "LONG" | "SHORT"; confidence: number } | null {
    const ind = candle.indicators;
    if (!ind?.ready) return null;

    const w = this.strategy.indicatorWeights;
    let longScore = 0;
    let shortScore = 0;

    if (ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50 && candle.close > ind.ema9) {
      longScore += w.trendEMA * 100;
    } else if (ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50 && candle.close < ind.ema9) {
      shortScore += w.trendEMA * 100;
    }

    if (ind.rsi >= this.strategy.rsiOversold && ind.rsi <= this.strategy.rsiOversold + 5) {
      longScore += w.rsiReversal * 100;
    } else if (ind.rsi >= this.strategy.rsiOverbought - 5 && ind.rsi <= this.strategy.rsiOverbought) {
      shortScore += w.rsiReversal * 100;
    }

    if (candle.close <= ind.bbandLower * 1.004) {
      longScore += w.bollingerMeanReversion * 100;
    } else if (candle.close >= ind.bbandUpper * 0.996) {
      shortScore += w.bollingerMeanReversion * 100;
    }

    if (ind.macdHist > 0 && ind.macd > ind.macdSignal) {
      longScore += w.macdMomentum * 100;
    } else if (ind.macdHist < 0 && ind.macd < ind.macdSignal) {
      shortScore += w.macdMomentum * 100;
    }

    if (ind.volumeSMA > 0 && candle.volume >= ind.volumeSMA * 1.25) {
      if (longScore > shortScore) longScore += w.volumeConfirmation * 100;
      else if (shortScore > longScore) shortScore += w.volumeConfirmation * 100;
    }

    if (Math.abs(longScore - shortScore) < 5) return null;

    const score = Math.max(longScore, shortScore);
    if (!Number.isFinite(score) || score < this.strategy.minConfidence) return null;

    return {
      type: longScore > shortScore ? "LONG" : "SHORT",
      confidence: Number(Math.min(100, score).toFixed(2)),
    };
  }

  private manageActiveTrade(candle: Candle) {
    const trade = this.activeTrade;
    if (!trade) return;

    if (trade.type === "LONG") {
      trade.highestPrice = Math.max(trade.highestPrice ?? trade.entryPrice, candle.high);

      const activationPct = this.strategy.trailingActivationPercent ?? 1;
      if (
        this.strategy.trailingStop &&
        trade.highestPrice >= trade.entryPrice * (1 + activationPct / 100)
      ) {
        const trailing = trade.highestPrice * (1 - this.strategy.trailingStopPercent / 100);
        if (trailing > trade.stopLoss) trade.stopLoss = Number(trailing.toFixed(8));
      }

      const hitStop = candle.low <= trade.stopLoss;
      const hitTarget = candle.high >= trade.takeProfit;

      if (hitStop || hitTarget) {
        const exitPrice = hitStop ? trade.stopLoss : trade.takeProfit;
        this.closeTrade(
          exitPrice,
          hitStop ? "CLOSED_STOP_LOSS" : "CLOSED_TAKE_PROFIT",
          hitStop && hitTarget
            ? "The candle touched both stop and target; conservative stop-first execution was used."
            : hitStop
              ? "Hard stop reached."
              : "Take-profit reached.",
        );
      }
    } else {
      trade.lowestPrice = Math.min(trade.lowestPrice ?? trade.entryPrice, candle.low);

      const activationPct = this.strategy.trailingActivationPercent ?? 1;
      if (
        this.strategy.trailingStop &&
        trade.lowestPrice <= trade.entryPrice * (1 - activationPct / 100)
      ) {
        const trailing = trade.lowestPrice * (1 + this.strategy.trailingStopPercent / 100);
        if (trailing < trade.stopLoss) trade.stopLoss = Number(trailing.toFixed(8));
      }

      const hitStop = candle.high >= trade.stopLoss;
      const hitTarget = candle.low <= trade.takeProfit;

      if (hitStop || hitTarget) {
        const exitPrice = hitStop ? trade.stopLoss : trade.takeProfit;
        this.closeTrade(
          exitPrice,
          hitStop ? "CLOSED_STOP_LOSS" : "CLOSED_TAKE_PROFIT",
          hitStop && hitTarget
            ? "The candle touched both stop and target; conservative stop-first execution was used."
            : hitStop
              ? "Hard stop reached."
              : "Take-profit reached.",
        );
      }
    }
  }

  private canOpenNewPosition(): boolean {
    if (this.botState === "HALTED_DEAD" || this.activeTrade || this.dailyRiskHalted) return false;

    const maxTrades = this.paperSettings.maxTradesPerDay ?? DEFAULT_MAX_TRADES_PER_DAY;
    if ((this.vitality.tradesToday ?? 0) >= maxTrades) return false;

    const cooldownMinutes = this.paperSettings.cooldownAfterLossMinutes ?? 15;
    if (this.lastLossAt > 0 && Date.now() - this.lastLossAt < cooldownMinutes * 60_000) return false;

    return true;
  }

  private refreshDailyRiskWindow() {
    const key = this.getUtcDayKey();

    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayStartEquity = this.vitality.currentEquity;
      this.vitality.dayStartEquity = this.dayStartEquity;
      this.vitality.dailyPnl = 0;
      this.vitality.tradesToday = 0;
      this.dailyRiskHalted = false;
    }

    if (!Number.isFinite(this.dayStartEquity) || this.dayStartEquity <= 0) {
      this.dayStartEquity = this.vitality.currentEquity;
      this.vitality.dayStartEquity = this.dayStartEquity;
    }

    this.vitality.dailyPnl = Number((this.vitality.currentEquity - this.dayStartEquity).toFixed(2));

    const maxDailyLoss = this.paperSettings.maxDailyLossPercent ?? DEFAULT_DAILY_LOSS_LIMIT;
    const lossPct =
      this.dayStartEquity > 0
        ? Math.max(0, (-this.vitality.dailyPnl / this.dayStartEquity) * 100)
        : 0;

    if (!this.dailyRiskHalted && lossPct >= maxDailyLoss) {
      this.dailyRiskHalted = true;
      this.botState = this.activeTrade ? "CRITICAL_HAZARD" : "DEFENSIVE";

      this.addNotification({
        type: "RISK_ALERT",
        title: "Daily Loss Limit Reached",
        message:
          "New paper entries are blocked for the rest of the UTC day after a " +
          lossPct.toFixed(2) +
          "% loss. Existing positions remain subject to their exit rules.",
        badgeText: "DAILY LIMIT",
      });

      this.logThought(
        "DEFENSE",
        "Daily Risk Limit Engaged",
        "New entries are blocked until the next UTC day.",
        0,
        -5,
      );
    }
  }

  private updateEquityAndHealth(currentPrice: number) {
    const equity = this.calculateEquity(currentPrice);
    this.vitality.currentEquity = Number(equity.toFixed(2));

    if (this.vitality.currentEquity > this.vitality.peakEquity) {
      this.vitality.peakEquity = this.vitality.currentEquity;
    }

    const drawdown =
      this.vitality.peakEquity > 0
        ? Math.max(
            0,
            ((this.vitality.peakEquity - this.vitality.currentEquity) / this.vitality.peakEquity) * 100,
          )
        : 0;

    this.vitality.currentDrawdownPercent = Number(drawdown.toFixed(2));
    this.vitality.maxDrawdownPercent = Math.max(
      this.vitality.maxDrawdownPercent,
      this.vitality.currentDrawdownPercent,
    );

    this.recalculateHealth();

    if (this.activeTrade) {
      const openPnl = this.calculateOpenPnl(currentPrice, this.activeTrade);
      this.activeTrade.pnl = Number(openPnl.toFixed(2));
      this.activeTrade.pnlPercent = Number(
        ((openPnl / Math.max(1, this.activeTrade.marginUsd ?? this.activeTrade.sizeUsd)) * 100).toFixed(2),
      );
    }
  }

  private recalculateHealth() {
    const threshold = Math.max(0.5, this.vitality.circuitBreakerThresholdPercent);
    const healthFraction = Math.max(0, 1 - this.vitality.currentDrawdownPercent / threshold);
    this.vitality.health = Math.round(healthFraction * 100);

    if (this.vitality.health <= 20) this.botState = "CRITICAL_HAZARD";
    else if (this.dailyRiskHalted || this.vitality.health <= 60) this.botState = "DEFENSIVE";
    else if (this.activeTrade) this.botState = "IN_POSITION";
    else this.botState = this.vitality.totalTrades > 0 ? "THRIVING" : "HUNTING";
  }

  private calculateEquity(currentPrice?: number): number {
    if (!this.activeTrade) return this.vitality.cash;

    const price = safeNumber(currentPrice, this.activeTrade.entryPrice);
    const margin = this.activeTrade.marginUsd ?? this.activeTrade.sizeUsd;
    const openPnl = this.calculateOpenPnl(price, this.activeTrade);
    return this.vitality.cash + margin + openPnl;
  }

  private calculateOpenPnl(price: number, trade: Trade): number {
    return trade.type === "LONG"
      ? (price - trade.entryPrice) * trade.amount
      : (trade.entryPrice - price) * trade.amount;
  }

  private applyEntrySlippage(price: number, type: "LONG" | "SHORT"): number {
    const rate = this.paperSettings.slippageBps / 10_000;
    return price * (type === "LONG" ? 1 + rate : 1 - rate);
  }

  private applyExitSlippage(price: number, type: "LONG" | "SHORT"): number {
    const rate = this.paperSettings.slippageBps / 10_000;
    return price * (type === "LONG" ? 1 - rate : 1 + rate);
  }

  private isDataStale(timestamp: number): boolean {
    // Manual/local simulated candles are timestamped in the present and pass this check.
    // Live-feed integrations should provide their real update timestamp through the caller.
    return timestamp - Date.now() > 5_000;
  }

  private startFreshPaperSession(capital: number) {
    const normalized = Math.max(100, safeNumber(capital, DEFAULT_INITIAL_CAPITAL));

    this.vitality.startingCapital = normalized;
    this.vitality.currentEquity = normalized;
    this.vitality.cash = normalized;
    this.vitality.peakEquity = normalized;
    this.vitality.currentDrawdownPercent = 0;
    this.vitality.maxDrawdownPercent = 0;
    this.vitality.health = 100;
    this.vitality.totalTrades = 0;
    this.vitality.winningTrades = 0;
    this.vitality.losingTrades = 0;
    this.vitality.winRate = 0;
    this.vitality.profitFactor = 0;
    this.vitality.totalPnl = 0;
    this.vitality.survivalStreak = 0;
    this.vitality.dayStartEquity = normalized;
    this.vitality.dailyPnl = 0;
    this.vitality.tradesToday = 0;
    this.vitality.openRiskUsd = 0;
    this.vitality.marginUsedUsd = 0;

    this.dayKey = this.getUtcDayKey();
    this.dayStartEquity = normalized;
    this.lastLossAt = 0;
    this.dailyRiskHalted = false;
    this.activeTrade = null;
    this.botState = "HUNTING";
    this.pendingSignal = null;

    this.equityCurve = [
      {
        timestamp: Date.now(),
        timeLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        equity: normalized,
        cash: normalized,
        drawdownPercent: 0,
        pnlDelta: 0,
        cumulativePnl: 0,
        tradeEvent: "Paper Session Start",
      },
    ];

    this.persistPaperState();
  }

  private loadPaperState(defaultCapital: number) {
    if (typeof window === "undefined") return;

    try {
      const raw = localStorage.getItem(ENGINE_STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;

      if (saved.vitality && typeof saved.vitality === "object") {
        this.vitality = {
          ...this.vitality,
          ...saved.vitality,
          startingCapital: safeNumber(saved.vitality.startingCapital, defaultCapital),
          currentEquity: safeNumber(saved.vitality.currentEquity, defaultCapital),
          cash: safeNumber(saved.vitality.cash, defaultCapital),
          peakEquity: safeNumber(saved.vitality.peakEquity, defaultCapital),
        };
      }

      if (Array.isArray(saved.tradeHistory)) this.tradeHistory = saved.tradeHistory.slice(0, 1000);
      if (Array.isArray(saved.thoughts)) this.thoughts = saved.thoughts.slice(0, 200);
      if (Array.isArray(saved.notifications)) this.notifications = saved.notifications.slice(0, 100);
      if (Array.isArray(saved.equityCurve)) this.equityCurve = saved.equityCurve.slice(-500);
      if (saved.activeTrade && typeof saved.activeTrade === "object") this.activeTrade = saved.activeTrade;
      if (typeof saved.dayKey === "string") this.dayKey = saved.dayKey;
      if (Number.isFinite(saved.dayStartEquity)) this.dayStartEquity = saved.dayStartEquity;

      if (!this.equityCurve.length) this.recordEquitySnapshot(undefined, "Restored Paper Session");
      this.refreshDailyRiskWindow();
      this.updateEquityAndHealth(this.activeTrade?.entryPrice ?? this.vitality.currentEquity);

      if (this.vitality.startingCapital <= 0 || this.vitality.cash < 0) {
        this.startFreshPaperSession(defaultCapital);
      }
    } catch {
      this.startFreshPaperSession(defaultCapital);
    }
  }

  private persistPaperState() {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(
        ENGINE_STORAGE_KEY,
        JSON.stringify({
          vitality: this.vitality,
          botState: this.botState,
          activeTrade: this.activeTrade,
          tradeHistory: this.tradeHistory.slice(0, 1000),
          thoughts: this.thoughts.slice(0, 200),
          notifications: this.notifications.slice(0, 100),
          equityCurve: this.equityCurve.slice(-500),
          dayKey: this.dayKey,
          dayStartEquity: this.dayStartEquity,
        }),
      );
    } catch {}
  }

  private saveProfitWithdrawalData() {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(VAULT_STORAGE_KEY, String(this.vitality.securedProfitVault || 0));
      localStorage.setItem(
        WITHDRAWALS_STORAGE_KEY,
        JSON.stringify(this.profitWithdrawals.slice(0, 500)),
      );
    } catch {}
  }

  private getUtcDayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private logThought(
    type: BotThoughtLog["type"],
    headline: string,
    message: string,
    confidence?: number,
    vitalityDelta?: number,
  ) {
    this.thoughts.unshift({
      id: idFor("THG"),
      timestamp: Date.now(),
      type,
      headline,
      message,
      confidence,
      vitalityDelta,
    });

    if (this.thoughts.length > 200) this.thoughts.pop();
  }

  private notify() {
    if (this.onStateChange) this.onStateChange();
  }
}
