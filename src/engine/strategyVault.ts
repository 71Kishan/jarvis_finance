import { DailyPerformanceGoal, StrategyConfig, StrategyVaultEntry, Trade } from "../types/trading";

const STORAGE_KEY = "jarvis_strategy_v2";
const DAILY_GOAL_STORAGE_KEY = "jarvis_daily_goal_v2";
const QUALIFICATION_TRADES = 100;
const QUALIFICATION_OOS_TRADES = 30;
const MIN_PROFIT_FACTOR = 1.1;
const MAX_QUALIFIED_DRAWDOWN = 20;

export class StrategyVault {
  private entries = new Map<string, StrategyVaultEntry>();
  private dailyGoal: DailyPerformanceGoal = {
    dailyTargetUsd: 0,
    currentDailyPnlUsd: 0,
    tradesCountToday: 0,
    targetAchieved: false,
    streakDays: 0,
  };

  constructor() {
    this.loadFromStorage();
  }

  public computeSignature(config: StrategyConfig): string {
    const w = config.indicatorWeights;
    return [
      config.asset || "ALL",
      "EMA:" + w.trendEMA,
      "RSI:" + config.rsiOversold + "-" + config.rsiOverbought + "_W" + w.rsiReversal,
      "MACD:" + w.macdMomentum,
      "BB:" + w.bollingerMeanReversion,
      "VOL:" + w.volumeConfirmation,
      "SL:" + config.stopLossPercent,
      "TP:" + config.takeProfitPercent,
      "CONF:" + config.minConfidence,
      "TR:" + (config.trailingStop ? config.trailingStopPercent : 0),
      "TA:" + (config.trailingActivationPercent ?? 1),
      "RULES:" + config.rules.join(","),
    ].join("|");
  }

  public isDuplicateStrategy(config: StrategyConfig): { isDuplicate: boolean; existingEntry?: StrategyVaultEntry } {
    const signature = this.computeSignature(config);
    const existing = this.entries.get(signature);
    return existing ? { isDuplicate: true, existingEntry: existing } : { isDuplicate: false };
  }

  public registerStrategy(
    config: StrategyConfig,
    category: StrategyVaultEntry["category"] = "TREND_FOLLOWING",
  ): StrategyVaultEntry {
    const signature = this.computeSignature(config);
    const existing = this.entries.get(signature);
    if (existing) return existing;

    const entry: StrategyVaultEntry = {
      id: "strat-" + Date.now(),
      signature,
      name: config.name || "Unnamed strategy",
      category,
      asset: config.asset || "UNKNOWN",
      version: config.version,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnlUsd: 0,
      profitFactor: 0,
      maxDrawdownPercent: 0,
      status: "TESTING_PAPER",
      evidenceStatus: "PAPER_TESTING",
      grossProfitUsd: 0,
      grossLossUsd: 0,
      lastTestedTime: Date.now(),
      config: { ...config },
    };

    this.entries.set(signature, entry);
    this.saveToStorage();
    return entry;
  }

  public recordTradeOutcome(config: StrategyConfig, trade: Trade) {
    const entry = this.registerStrategy(config);

    entry.totalTrades += 1;
    if (trade.pnl > 0) {
      entry.wins += 1;
      entry.grossProfitUsd = Number(((entry.grossProfitUsd ?? 0) + trade.pnl).toFixed(2));
    } else if (trade.pnl < 0) {
      entry.losses += 1;
      entry.grossLossUsd = Number(((entry.grossLossUsd ?? 0) + Math.abs(trade.pnl)).toFixed(2));
    }

    entry.totalPnlUsd = Number(((entry.grossProfitUsd ?? 0) - (entry.grossLossUsd ?? 0)).toFixed(2));
    entry.winRate = entry.totalTrades ? Number(((entry.wins / entry.totalTrades) * 100).toFixed(2)) : 0;
    entry.profitFactor =
      (entry.grossLossUsd ?? 0) > 0
        ? Number(((entry.grossProfitUsd ?? 0) / (entry.grossLossUsd ?? 0)).toFixed(3))
        : 0;
    entry.expectancyUsd = entry.totalTrades ? Number((entry.totalPnlUsd / entry.totalTrades).toFixed(2)) : 0;
    entry.lastTestedTime = Date.now();

    // Paper observations alone never become "proven" after a tiny sample.
    if (
      entry.totalTrades >= QUALIFICATION_TRADES &&
      (entry.outOfSampleTrades ?? 0) >= QUALIFICATION_OOS_TRADES &&
      entry.profitFactor >= MIN_PROFIT_FACTOR &&
      entry.totalPnlUsd > 0 &&
      entry.maxDrawdownPercent <= MAX_QUALIFIED_DRAWDOWN &&
      (entry.outOfSamplePnlUsd ?? 0) > 0
    ) {
      entry.status = "PROVEN_PROFITABLE";
      entry.evidenceStatus = "QUALIFIED";
      entry.successNotes = "Qualified only after minimum trade-count, holdout and drawdown gates were met.";
      entry.failureReason = undefined;
    }

    if (
      entry.totalTrades >= QUALIFICATION_TRADES &&
      (entry.totalPnlUsd < 0 || entry.profitFactor < 1)
    ) {
      entry.status = "DISCARDED_FAILED";
      entry.evidenceStatus = "REJECTED";
      entry.failureReason = "Rejected on negative expectancy/profit factor after the minimum evidence window.";
    }

    this.entries.set(entry.signature, entry);
    this.updateDailyGoal(trade);
    this.saveToStorage();
  }

  public registerBacktestEvidence(
    config: StrategyConfig,
    result: {
      totalTrades: number;
      winRate: number;
      totalPnl: number;
      profitFactor: number;
      maxDrawdown: number;
      outOfSampleTrades?: number;
      outOfSamplePnl?: number;
      outOfSampleMaxDrawdown?: number;
      expectancyUsd?: number;
    },
  ) {
    const entry = this.registerStrategy(config);
    entry.lastTestedTime = Date.now();
    entry.totalTrades = Math.max(entry.totalTrades, result.totalTrades);
    entry.wins = Math.max(entry.wins, Math.round(result.totalTrades * result.winRate / 100));
    entry.losses = Math.max(0, entry.totalTrades - entry.wins);
    entry.winRate = result.winRate;
    entry.totalPnlUsd = result.totalPnl;
    entry.profitFactor = result.profitFactor;
    entry.maxDrawdownPercent = result.maxDrawdown;
    entry.outOfSampleTrades = result.outOfSampleTrades ?? 0;
    entry.outOfSamplePnlUsd = result.outOfSamplePnl ?? 0;
    entry.outOfSampleMaxDrawdownPercent = result.outOfSampleMaxDrawdown ?? 0;
    entry.expectancyUsd = result.expectancyUsd ?? (result.totalTrades ? result.totalPnl / result.totalTrades : 0);

    const qualifies =
      result.totalTrades >= QUALIFICATION_TRADES &&
      (result.outOfSampleTrades ?? 0) >= QUALIFICATION_OOS_TRADES &&
      result.profitFactor >= MIN_PROFIT_FACTOR &&
      result.totalPnl > 0 &&
      (result.outOfSamplePnl ?? 0) > 0 &&
      result.maxDrawdown <= MAX_QUALIFIED_DRAWDOWN;

    if (qualifies) {
      entry.status = "PROVEN_PROFITABLE";
      entry.evidenceStatus = "QUALIFIED";
      entry.successNotes = "Backtest candidate passed the configured evidence gate. Keep paper-forward validation running.";
    } else {
      entry.status = "TESTING_PAPER";
      entry.evidenceStatus = "PAPER_TESTING";
    }

    this.entries.set(entry.signature, entry);
    this.saveToStorage();
    return entry;
  }

  public getAllStrategies(): StrategyVaultEntry[] {
    const evidenceOrder: Record<string, number> = {
      QUALIFIED: 0,
      PAPER_TESTING: 1,
      REJECTED: 2,
      UNTESTED: 3,
    };

    return Array.from(this.entries.values()).sort((a, b) => {
      const ae = evidenceOrder[a.evidenceStatus ?? "UNTESTED"];
      const be = evidenceOrder[b.evidenceStatus ?? "UNTESTED"];
      if (ae !== be) return ae - be;
      return b.totalTrades - a.totalTrades;
    });
  }

  public getProvenStrategies(): StrategyVaultEntry[] {
    return this.getAllStrategies().filter((s) => s.status === "PROVEN_PROFITABLE");
  }

  public getDailyGoal(): DailyPerformanceGoal {
    return { ...this.dailyGoal };
  }

  public setDailyTarget(targetUsd: number) {
    // Retained for UI compatibility, but a PnL target is informational and never used as an entry trigger.
    this.dailyGoal.dailyTargetUsd = Math.max(0, Number(targetUsd) || 0);
    this.dailyGoal.targetAchieved =
      this.dailyGoal.dailyTargetUsd > 0 && this.dailyGoal.currentDailyPnlUsd >= this.dailyGoal.dailyTargetUsd;
    this.saveToStorage();
  }

  private updateDailyGoal(trade: Trade) {
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = localStorage.getItem("jarvis_daily_goal_date_v2");
    if (lastDate !== today) {
      this.dailyGoal.currentDailyPnlUsd = 0;
      this.dailyGoal.tradesCountToday = 0;
      this.dailyGoal.targetAchieved = false;
      this.dailyGoal.streakDays = this.dailyGoal.streakDays;
      localStorage.setItem("jarvis_daily_goal_date_v2", today);
    }

    this.dailyGoal.currentDailyPnlUsd = Number((this.dailyGoal.currentDailyPnlUsd + trade.pnl).toFixed(2));
    this.dailyGoal.tradesCountToday += 1;
    this.dailyGoal.targetAchieved =
      this.dailyGoal.dailyTargetUsd > 0 &&
      this.dailyGoal.currentDailyPnlUsd >= this.dailyGoal.dailyTargetUsd;
  }

  private saveToStorage() {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.entries.values())));
    localStorage.setItem(DAILY_GOAL_STORAGE_KEY, JSON.stringify(this.dailyGoal));
  }

  private loadFromStorage() {
    if (typeof localStorage === "undefined") return;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved) as StrategyVaultEntry[];
        for (const item of arr) {
          if (item?.signature) this.entries.set(item.signature, item);
        }
      }

      const goalSaved = localStorage.getItem(DAILY_GOAL_STORAGE_KEY);
      if (goalSaved) {
        const parsed = JSON.parse(goalSaved) as DailyPerformanceGoal;
        if (parsed && typeof parsed === "object") this.dailyGoal = parsed;
      }
    } catch {
      // Ignore corrupt local state; the paper account can be reset without affecting source code.
    }
  }
}

export const strategyVaultInstance = new StrategyVault();
