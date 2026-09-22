import { DailyPerformanceGoal, StrategyConfig, StrategyVaultEntry, Trade } from "../types/trading";

/**
 * Strategy registry.
 *
 * A paper-trading outcome is evidence, not proof.
 * A strategy is never called "validated" because of a tiny win streak.
 * Formal validation with out-of-sample evidence must explicitly promote it.
 */
const STORAGE_KEY = "jarvis_strategy_v2";
const DAILY_JOURNAL_STORAGE_KEY = "jarvis_daily_journal_v2";

export class StrategyVault {
  private entries: Map<string, StrategyVaultEntry> = new Map();
  private dailyGoal: DailyPerformanceGoal = {
    // Retained for backwards-compatible UI state. Jarvis no longer treats
    // a daily dollar target as a trading objective.
    dailyTargetUsd: 0,
    currentDailyPnlUsd: 0,
    tradesCountToday: 0,
    targetAchieved: false,
    streakDays: 0,
  };

  constructor() {
    this.loadFromStorage();
    this.rebuildDailyJournalFromStoredState();
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

  private cloneConfig(config: StrategyConfig): StrategyConfig {
    return {
      ...config,
      indicatorWeights: { ...config.indicatorWeights },
      rules: [...config.rules],
    };
  }

  public isDuplicateStrategy(config: StrategyConfig): {
    isDuplicate: boolean;
    existingEntry?: StrategyVaultEntry;
  } {
    const sig = this.computeSignature(config);
    const existing = this.entries.get(sig);
    return existing
      ? { isDuplicate: true, existingEntry: existing }
      : { isDuplicate: false };
  }

  public registerStrategy(
    config: StrategyConfig,
    category: StrategyVaultEntry["category"] = "TREND_FOLLOWING"
  ): StrategyVaultEntry {
    const signature = this.computeSignature(config);
    const existing = this.entries.get(signature);
    if (existing) return existing;

    const newEntry: StrategyVaultEntry = {
      id: `strat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
      status: "TESTING_PAPER",
      successNotes: "Registered for paper testing. No validation claim.",
      lastTestedTime: Date.now(),
      config: this.cloneConfig(config),
      evidence: {
        inSampleTrades: 0,
        outOfSampleTrades: 0,
        walkForwardWindows: 0,
        validationPassed: false,
      },
    };

    this.entries.set(signature, newEntry);
    this.saveToStorage();
    return newEntry;
  }

  public recordTradeOutcome(config: StrategyConfig, trade: Trade) {
    let entry = this.entries.get(this.computeSignature(config));
    if (!entry) entry = this.registerStrategy(config);

    const pnl = Number(trade.pnl || 0);
    entry.totalTrades += 1;

    if (pnl > 0) {
      entry.wins += 1;
      entry.grossProfitUsd = Number(
        ((entry.grossProfitUsd || 0) + pnl).toFixed(2)
      );
    } else if (pnl < 0) {
      entry.losses += 1;
      entry.grossLossUsd = Number(
        ((entry.grossLossUsd || 0) + Math.abs(pnl)).toFixed(2)
      );
    }

    entry.totalPnlUsd = Number((entry.totalPnlUsd + pnl).toFixed(2));
    entry.winRate =
      entry.totalTrades > 0
        ? Number(((entry.wins / entry.totalTrades) * 100).toFixed(1))
        : 0;
    entry.profitFactor =
      (entry.grossLossUsd || 0) > 0
        ? Number(((entry.grossProfitUsd || 0) / (entry.grossLossUsd || 0)).toFixed(2))
        : (entry.grossProfitUsd || 0) > 0
        ? Number.POSITIVE_INFINITY
        : 0;

    entry.lastTestedTime = Date.now();

    // Paper outcomes may reject a strategy but can never promote it to validated.
    if (entry.totalTrades >= 30) {
      if ((entry.profitFactor || 0) < 0.8 && entry.totalPnlUsd < 0) {
        entry.status = "DISCARDED_FAILED";
        entry.failureReason =
          "Rejected during paper testing: negative cumulative PnL and profit factor below 0.8.";
        entry.successNotes = undefined;
      } else {
        entry.status = "TESTING_PAPER";
        entry.successNotes =
          `Paper evidence: ${entry.totalTrades} trades, ${entry.winRate}% win rate, PF ${Number.isFinite(entry.profitFactor) ? entry.profitFactor : "∞"}. Formal validation still required.`;
        entry.failureReason = undefined;
      }
    }

    this.entries.set(entry.signature, entry);
    this.updateDailyJournal(pnl);
    this.saveToStorage();
  }

  /**
   * Explicit validation gate. Only the formal research/backtest pipeline should call this.
   */
  public recordValidation(
    config: StrategyConfig,
    evidence: NonNullable<StrategyVaultEntry["evidence"]>
  ): StrategyVaultEntry {
    let entry = this.entries.get(this.computeSignature(config));
    if (!entry) entry = this.registerStrategy(config);

    entry.evidence = { ...entry.evidence, ...evidence };
    entry.status = evidence.validationPassed
      ? "PROVEN_PROFITABLE"
      : "TESTING_PAPER";
    entry.lastTestedTime = evidence.lastValidatedAt || Date.now();

    if (evidence.validationPassed) {
      entry.successNotes =
        "Validated by the formal research gate. Review evidence before activating.";
      entry.failureReason = undefined;
    }

    this.entries.set(entry.signature, entry);
    this.saveToStorage();
    return entry;
  }

  public getAllStrategies(): StrategyVaultEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => {
      const order = {
        PROVEN_PROFITABLE: 0,
        TESTING_PAPER: 1,
        DISCARDED_FAILED: 2,
      };

      if (order[a.status] !== order[b.status]) {
        return order[a.status] - order[b.status];
      }

      return (b.totalPnlUsd || 0) - (a.totalPnlUsd || 0);
    });
  }

  public getProvenStrategies(): StrategyVaultEntry[] {
    return this.getAllStrategies().filter(
      (s) =>
        s.status === "PROVEN_PROFITABLE" &&
        s.evidence?.validationPassed === true
    );
  }

  public getDailyGoal(): DailyPerformanceGoal {
    return { ...this.dailyGoal };
  }

  /**
   * Retained for compatibility. Daily profit targets are intentionally disabled
   * because a professional process should not force the system to trade for income.
   */
  public setDailyTarget(_targetUsd: number) {
    this.dailyGoal.dailyTargetUsd = 0;
    this.dailyGoal.targetAchieved = false;
    this.saveToStorage();
  }

  private updateDailyJournal(pnl: number) {
    const today = new Date().toISOString().slice(0, 10);
    const stored = this.readDailyJournal();

    const current = stored[today] || { pnl: 0, trades: 0, wins: 0 };
    current.pnl = Number((current.pnl + pnl).toFixed(2));
    current.trades += 1;
    if (pnl > 0) current.wins += 1;

    stored[today] = current;

    this.dailyGoal.currentDailyPnlUsd = current.pnl;
    this.dailyGoal.tradesCountToday = current.trades;
    this.dailyGoal.targetAchieved = false;
    this.dailyGoal.streakDays = 0;

    this.writeDailyJournal(stored);
  }

  private rebuildDailyJournalFromStoredState() {
    const today = new Date().toISOString().slice(0, 10);
    const stored = this.readDailyJournal();
    const current = stored[today];

    if (current) {
      this.dailyGoal.currentDailyPnlUsd = current.pnl;
      this.dailyGoal.tradesCountToday = current.trades;
    }

    this.dailyGoal.dailyTargetUsd = 0;
    this.dailyGoal.targetAchieved = false;
  }

  private readDailyJournal(): Record<
    string,
    { pnl: number; trades: number; wins: number }
  > {
    if (typeof window === "undefined") return {};

    try {
      const raw = localStorage.getItem(DAILY_JOURNAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private writeDailyJournal(
    journal: Record<string, { pnl: number; trades: number; wins: number }>
  ) {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(DAILY_JOURNAL_STORAGE_KEY, JSON.stringify(journal));
    } catch {
      // Storage can fail in private browsing or when quota is exhausted.
    }
  }

  private saveToStorage() {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(this.entries.values()))
      );
    } catch {
      // Storage unavailable or quota exceeded.
    }
  }

  private loadFromStorage() {
    if (typeof window === "undefined") return;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;

      const arr: StrategyVaultEntry[] = JSON.parse(saved);
      for (const item of arr) {
        item.evidence = item.evidence || {
          inSampleTrades: 0,
          outOfSampleTrades: 0,
          walkForwardWindows: 0,
          validationPassed: false,
        };

        if (!item.evidence.validationPassed) {
          item.status =
            item.status === "DISCARDED_FAILED"
              ? "DISCARDED_FAILED"
              : "TESTING_PAPER";
        }

        item.grossProfitUsd = item.grossProfitUsd || 0;
        item.grossLossUsd = item.grossLossUsd || 0;
        item.profitFactor =
          item.grossLossUsd > 0
            ? Number((item.grossProfitUsd / item.grossLossUsd).toFixed(2))
            : item.grossProfitUsd > 0
            ? Number.POSITIVE_INFINITY
            : 0;

        this.entries.set(item.signature, item);
      }
    } catch {
      this.entries.clear();
    }
  }
}

export const strategyVaultInstance = new StrategyVault();
