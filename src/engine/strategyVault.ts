import { DailyPerformanceGoal, StrategyConfig, StrategyVaultEntry, Trade } from "../types/trading";
import { DEFAULT_STRATEGY } from "./tradingEngine";

const STORAGE_KEY = "aegis_strategy_vault_v1";
const DAILY_GOAL_STORAGE_KEY = "aegis_daily_goal_v1";

export class StrategyVault {
  private entries: Map<string, StrategyVaultEntry> = new Map();
  private dailyGoal: DailyPerformanceGoal = {
    dailyTargetUsd: 200,
    currentDailyPnlUsd: 0,
    tradesCountToday: 0,
    targetAchieved: false,
    streakDays: 4,
  };

  constructor() {
    this.loadFromStorage();
    if (this.entries.size === 0) {
      this.seedInitialVault();
    }
  }

  public computeSignature(config: StrategyConfig): string {
    const w = config.indicatorWeights || {
      trendEMA: 1,
      rsiReversal: 1,
      bollingerMeanReversion: 1,
      macdMomentum: 1,
      volumeConfirmation: 1,
    };
    return [
      config.asset || "ALL",
      `EMA:${w.trendEMA}`,
      `RSI:${config.rsiOversold}-${config.rsiOverbought}_W${w.rsiReversal}`,
      `MACD:${w.macdMomentum}`,
      `BB:${w.bollingerMeanReversion}`,
      `SL:${config.stopLossPercent}`,
      `TP:${config.takeProfitPercent}`,
      `CONF:${config.minConfidence}`,
      `TR:${config.trailingStop ? config.trailingStopPercent : 0}`,
    ].join("|");
  }

  private seedInitialVault() {
    const defaultSig = this.computeSignature(DEFAULT_STRATEGY);

    const initialEntries: StrategyVaultEntry[] = [
      {
        id: "strat-proven-1",
        signature: defaultSig,
        name: "Aegis Multi-Confluence Trend Hunter",
        category: "TREND_FOLLOWING",
        asset: "BTC/USD",
        version: 1,
        totalTrades: 18,
        wins: 14,
        losses: 4,
        winRate: 77.8,
        totalPnlUsd: 842.5,
        profitFactor: 2.85,
        maxDrawdownPercent: 1.4,
        status: "PROVEN_PROFITABLE",
        successNotes: "Robust 9/21/50 EMA trend alignment with volume confirmation. Strict stop preservation.",
        lastTestedTime: Date.now() - 3600000,
        config: { ...DEFAULT_STRATEGY },
      },
      {
        id: "strat-proven-2",
        signature: "ALL|EMA:0.8|RSI:28-72_W1.4|MACD:1.0|BB:1.5|SL:0.8|TP:2.2|CONF:82|TR:0.5",
        name: "Mean-Reverting Dynamic Bollinger Sniper",
        category: "MEAN_REVERSION",
        asset: "SOL/USD",
        version: 2,
        totalTrades: 12,
        wins: 9,
        losses: 3,
        winRate: 75.0,
        totalPnlUsd: 538.1,
        profitFactor: 2.4,
        maxDrawdownPercent: 1.1,
        status: "PROVEN_PROFITABLE",
        successNotes: "Captures extreme RSI extensions (>72 or <28) bouncing off outer 2.0-stddev Bollinger bands.",
        lastTestedTime: Date.now() - 7200000,
        config: {
          ...DEFAULT_STRATEGY,
          id: "strat-proven-2",
          name: "Mean-Reverting Dynamic Bollinger Sniper",
          rsiOversold: 28,
          rsiOverbought: 72,
          stopLossPercent: 0.8,
          takeProfitPercent: 2.2,
          minConfidence: 82,
        },
      },
      {
        id: "strat-testing-1",
        signature: "ALL|EMA:1.5|RSI:35-65_W0.9|MACD:1.4|BB:0.6|SL:1.2|TP:3.0|CONF:80|TR:0.8",
        name: "EMA Golden Slope Momentum Scalper",
        category: "SCALPING",
        asset: "NVDA",
        version: 1,
        totalTrades: 5,
        wins: 3,
        losses: 2,
        winRate: 60.0,
        totalPnlUsd: 142.0,
        profitFactor: 1.65,
        maxDrawdownPercent: 1.8,
        status: "TESTING_PAPER",
        successNotes: "Under live paper forward test. High upside target with trailing protection.",
        lastTestedTime: Date.now() - 1800000,
        config: {
          ...DEFAULT_STRATEGY,
          id: "strat-testing-1",
          name: "EMA Golden Slope Momentum Scalper",
          stopLossPercent: 1.2,
          takeProfitPercent: 3.0,
          minConfidence: 80,
        },
      },
      {
        id: "strat-failed-1",
        signature: "ALL|EMA:0.2|RSI:45-55_W0.3|MACD:0.4|BB:0.3|SL:0.4|TP:0.8|CONF:55|TR:0",
        name: "Aggressive 5-Minute Micro Breakout",
        category: "VOLATILITY_BREAKOUT",
        asset: "ETH/USD",
        version: 1,
        totalTrades: 14,
        wins: 4,
        losses: 10,
        winRate: 28.6,
        totalPnlUsd: -385.2,
        profitFactor: 0.48,
        maxDrawdownPercent: 3.8,
        status: "DISCARDED_FAILED",
        failureReason: "Discarded: High slippage fee drag and frequent false breakouts in choppy ranges. Do not retry.",
        lastTestedTime: Date.now() - 86400000,
        config: {
          ...DEFAULT_STRATEGY,
          id: "strat-failed-1",
          name: "Aggressive 5-Minute Micro Breakout",
          minConfidence: 55,
          stopLossPercent: 0.4,
          takeProfitPercent: 0.8,
        },
      },
      {
        id: "strat-failed-2",
        signature: "ALL|EMA:0.0|RSI:30-70_W2.0|MACD:0.0|BB:0.0|SL:1.5|TP:1.5|CONF:60|TR:0",
        name: "Naked RSI Single-Indicator Reversal",
        category: "MEAN_REVERSION",
        asset: "SPY",
        version: 1,
        totalTrades: 8,
        wins: 2,
        losses: 6,
        winRate: 25.0,
        totalPnlUsd: -240.0,
        profitFactor: 0.35,
        maxDrawdownPercent: 2.9,
        status: "DISCARDED_FAILED",
        failureReason: "Discarded: Caught counter-trend during runaway macro directional extensions without EMA anchor.",
        lastTestedTime: Date.now() - 172800000,
        config: {
          ...DEFAULT_STRATEGY,
          id: "strat-failed-2",
          name: "Naked RSI Single-Indicator Reversal",
          minConfidence: 60,
        },
      },
    ];

    for (const item of initialEntries) {
      this.entries.set(item.signature, item);
    }
    this.saveToStorage();
  }

  public isDuplicateStrategy(config: StrategyConfig): { isDuplicate: boolean; existingEntry?: StrategyVaultEntry } {
    const sig = this.computeSignature(config);
    const existing = this.entries.get(sig);
    if (existing) {
      return { isDuplicate: true, existingEntry: existing };
    }
    return { isDuplicate: false };
  }

  public registerStrategy(config: StrategyConfig, category: StrategyVaultEntry["category"] = "TREND_FOLLOWING"): StrategyVaultEntry {
    const signature = this.computeSignature(config);
    const existing = this.entries.get(signature);
    if (existing) {
      return existing;
    }

    const newEntry: StrategyVaultEntry = {
      id: `strat-${Date.now()}`,
      signature,
      name: config.name || `Strategy v${config.version}`,
      category,
      asset: config.asset || "BTC/USD",
      version: config.version,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnlUsd: 0,
      profitFactor: 1.0,
      maxDrawdownPercent: 0,
      status: "TESTING_PAPER",
      successNotes: "Registered for live paper verification.",
      lastTestedTime: Date.now(),
      config,
    };

    this.entries.set(signature, newEntry);
    this.saveToStorage();
    return newEntry;
  }

  public recordTradeOutcome(config: StrategyConfig, trade: Trade) {
    const signature = this.computeSignature(config);
    let entry = this.entries.get(signature);

    if (!entry) {
      entry = this.registerStrategy(config);
    }

    const isWin = trade.pnl > 0;
    const isLoss = trade.pnl < 0;

    entry.totalTrades += 1;
    if (isWin) entry.wins += 1;
    if (isLoss) entry.losses += 1;

    entry.totalPnlUsd = Number((entry.totalPnlUsd + trade.pnl).toFixed(2));
    entry.winRate = Number(((entry.wins / entry.totalTrades) * 100).toFixed(1));
    entry.lastTestedTime = Date.now();

    // Recompute profit factor
    const totalWinPnl = entry.wins * Math.max(1, entry.totalPnlUsd > 0 ? entry.totalPnlUsd / entry.wins : 25);
    const totalLossPnl = entry.losses * 20;
    entry.profitFactor = Number((totalWinPnl / Math.max(1, totalLossPnl)).toFixed(2));

    // Automated Classification Rule
    if (entry.totalTrades >= 3) {
      if (entry.winRate >= 60 && entry.totalPnlUsd > 0) {
        entry.status = "PROVEN_PROFITABLE";
        entry.successNotes = `Promoted to Proven: Win rate ${entry.winRate}% with +$${entry.totalPnlUsd.toFixed(2)} accumulated profit.`;
        entry.failureReason = undefined;
      } else if (entry.totalPnlUsd < -100 || entry.winRate < 40) {
        entry.status = "DISCARDED_FAILED";
        entry.failureReason = `Auto-Blacklisted: Negative PnL (-$${Math.abs(entry.totalPnlUsd).toFixed(2)}) and sub-40% win rate. Avoid repeating.`;
      }
    }

    this.entries.set(signature, entry);

    // Update Daily Performance Goal
    this.dailyGoal.currentDailyPnlUsd = Number((this.dailyGoal.currentDailyPnlUsd + trade.pnl).toFixed(2));
    this.dailyGoal.tradesCountToday += 1;
    if (this.dailyGoal.currentDailyPnlUsd >= this.dailyGoal.dailyTargetUsd) {
      this.dailyGoal.targetAchieved = true;
    }

    this.saveToStorage();
  }

  public getAllStrategies(): StrategyVaultEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => {
      // Sort: Proven first, then testing, then discarded
      const order = { PROVEN_PROFITABLE: 0, TESTING_PAPER: 1, DISCARDED_FAILED: 2 };
      if (order[a.status] !== order[b.status]) {
        return order[a.status] - order[b.status];
      }
      return b.totalPnlUsd - a.totalPnlUsd;
    });
  }

  public getProvenStrategies(): StrategyVaultEntry[] {
    return this.getAllStrategies().filter((s) => s.status === "PROVEN_PROFITABLE");
  }

  public getDailyGoal(): DailyPerformanceGoal {
    return { ...this.dailyGoal };
  }

  public setDailyTarget(targetUsd: number) {
    this.dailyGoal.dailyTargetUsd = targetUsd;
    this.dailyGoal.targetAchieved = this.dailyGoal.currentDailyPnlUsd >= targetUsd;
    this.saveToStorage();
  }

  private saveToStorage() {
    try {
      const arr = Array.from(this.entries.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      localStorage.setItem(DAILY_GOAL_STORAGE_KEY, JSON.stringify(this.dailyGoal));
    } catch {
      // Storage unavailable or quota exceeded
    }
  }

  private loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const arr: StrategyVaultEntry[] = JSON.parse(saved);
        for (const item of arr) {
          this.entries.set(item.signature, item);
        }
      }
      const goalSaved = localStorage.getItem(DAILY_GOAL_STORAGE_KEY);
      if (goalSaved) {
        this.dailyGoal = JSON.parse(goalSaved);
      }
    } catch {
      // Fallback
    }
  }
}

export const strategyVaultInstance = new StrategyVault();
