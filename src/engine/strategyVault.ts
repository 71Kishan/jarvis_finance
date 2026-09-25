import { DailyPerformanceGoal, StrategyConfig, StrategyVaultEntry, Trade } from "../types/trading";

const STORAGE_KEY = "jarvis_strategy_vault_v2";
const DAILY_GOAL_STORAGE_KEY = "jarvis_daily_process_v2";

export class StrategyVault {
  private entries: Map<string, StrategyVaultEntry> = new Map();
  private dailyGoal: DailyPerformanceGoal = {
    dailyTargetUsd: 0,
    currentDailyPnlUsd: 0,
    tradesCountToday: 0,
    targetAchieved: false,
    streakDays: 0,
    deprecated: true,
  };

  constructor() {
    this.loadFromStorage();
  }

  public computeSignature(config: StrategyConfig): string {
    const w = config.indicatorWeights;
    return [
      config.asset || "ALL",
      `EMA:${w.trendEMA}`,
      `RSI:${config.rsiOversold}-${config.rsiOverbought}_W${w.rsiReversal}`,
      `MACD:${w.macdMomentum}`,
      `BB:${w.bollingerMeanReversion}`,
      `VOL:${w.volumeConfirmation}`,
      `SL:${config.stopLossPercent}`,
      `TP:${config.takeProfitPercent}`,
      `CONF:${config.minConfidence}`,
      `TR:${config.trailingStop ? config.trailingStopPercent : 0}`,
      `RISK:${config.maxRiskPerTrade}`,
    ].join("|");
  }

  public registerStrategy(
    config: StrategyConfig,
    category: StrategyVaultEntry["category"] = "TREND_FOLLOWING",
  ): StrategyVaultEntry {
    const signature = this.computeSignature(config);
    const existing = this.entries.get(signature);
    if (existing) return existing;

    const entry: StrategyVaultEntry = {
      id: `strat-${Date.now()}`,
      signature,
      name: config.name || `Strategy v${config.version}`,
      category,
      asset: config.asset || "ALL",
      version: config.version,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnlUsd: 0,
      grossProfitUsd: 0,
      grossLossUsd: 0,
      profitFactor: 0,
      maxDrawdownPercent: 0,
      status: "DRAFT",
      successNotes: "Registered but not validated. Backtest and forward-paper evidence are required.",
      lastTestedTime: Date.now(),
      config: { ...config, indicatorWeights: { ...config.indicatorWeights } },
    };

    this.entries.set(signature, entry);
    this.saveToStorage();
    return entry;
  }

  public isDuplicateStrategy(config: StrategyConfig): { isDuplicate: boolean; existingEntry?: StrategyVaultEntry } {
    const existing = this.entries.get(this.computeSignature(config));
    return existing ? { isDuplicate: true, existingEntry: existing } : { isDuplicate: false };
  }

  public recordTradeOutcome(config: StrategyConfig, trade: Trade) {
    const entry = this.registerStrategy(config);
    entry.totalTrades += 1;

    if (trade.pnl > 0) {
      entry.wins += 1;
      entry.grossProfitUsd = Number(((entry.grossProfitUsd || 0) + trade.pnl).toFixed(2));
    } else if (trade.pnl < 0) {
      entry.losses += 1;
      entry.grossLossUsd = Number(((entry.grossLossUsd || 0) + Math.abs(trade.pnl)).toFixed(2));
    }

    entry.totalPnlUsd = Number((entry.totalPnlUsd + trade.pnl).toFixed(2));
    entry.winRate = entry.totalTrades > 0 ? Number((entry.wins / entry.totalTrades * 100).toFixed(1)) : 0;
    entry.profitFactor = (entry.grossLossUsd || 0) > 0
      ? Number(((entry.grossProfitUsd || 0) / (entry.grossLossUsd || 0)).toFixed(2))
      : 0;
    entry.lastTestedTime = Date.now();
    entry.status = "TESTING_PAPER";
    entry.successNotes =
      `Forward paper evidence: ${entry.totalTrades} trade(s), ${entry.winRate}% win rate, PF ${entry.profitFactor || "—"}. Validation remains pending out-of-sample and forward-paper checks.`;

    this.dailyGoal.currentDailyPnlUsd = Number((this.dailyGoal.currentDailyPnlUsd + trade.pnl).toFixed(2));
    this.dailyGoal.tradesCountToday += 1;
    this.dailyGoal.targetAchieved = false;
    this.saveToStorage();
  }

  public getAllStrategies(): StrategyVaultEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => b.lastTestedTime - a.lastTestedTime);
  }

  public getProvenStrategies(): StrategyVaultEntry[] {
    return this.getAllStrategies().filter((s) => s.status === "PROVISIONALLY_VALIDATED");
  }

  public getDailyGoal(): DailyPerformanceGoal {
    return { ...this.dailyGoal, deprecated: true, targetAchieved: false };
  }

  public setDailyTarget(targetUsd: number) {
    this.dailyGoal.dailyTargetUsd = Math.max(0, targetUsd);
    this.dailyGoal.deprecated = true;
    this.dailyGoal.targetAchieved = false;
    this.saveToStorage();
  }

  public resetDailyProcessStats() {
    this.dailyGoal.currentDailyPnlUsd = 0;
    this.dailyGoal.tradesCountToday = 0;
    this.dailyGoal.targetAchieved = false;
    this.saveToStorage();
  }

  private saveToStorage() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.entries.values())));
      localStorage.setItem(DAILY_GOAL_STORAGE_KEY, JSON.stringify(this.dailyGoal));
    } catch {
      // Best-effort browser cache.
    }
  }

  private loadFromStorage() {
    if (typeof localStorage === "undefined") return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved) as StrategyVaultEntry[];
        for (const item of arr) this.entries.set(item.signature, item);
      }
      const goalSaved = localStorage.getItem(DAILY_GOAL_STORAGE_KEY);
      if (goalSaved) {
        this.dailyGoal = {
          ...this.dailyGoal,
          ...(JSON.parse(goalSaved) as DailyPerformanceGoal),
          deprecated: true,
          targetAchieved: false,
        };
      }
    } catch {
      // Ignore corrupted local cache.
    }
  }
}

export const strategyVaultInstance = new StrategyVault();
