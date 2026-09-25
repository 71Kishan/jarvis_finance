import type { StrategyConfig, Trade } from "../types/trading";
import { buildLearningTradeRecord, LearningTradeRecord } from "./types";
import { buildLearningFeatureDataset, LearningFeatureDataset } from "./dataset";

const MAX_RECORDS = 2000;

export class LearningPerformanceJournal {
  private records = new Map<string, LearningTradeRecord>();

  public recordTrade(
    trade: Trade,
    strategy: StrategyConfig,
    recordedAt = Date.now(),
  ): LearningTradeRecord {
    const existing = this.records.get(trade.id);
    if (existing) return { ...existing };

    const record = buildLearningTradeRecord(trade, strategy, recordedAt);
    this.records.set(record.tradeId, record);

    if (this.records.size > MAX_RECORDS) {
      const oldest = this.records.keys().next().value;
      if (oldest) this.records.delete(oldest);
    }

    return { ...record };
  }

  public list(limit = MAX_RECORDS): LearningTradeRecord[] {
    return Array.from(this.records.values())
      .sort((a, b) => b.recordedAt - a.recordedAt)
      .slice(0, Math.max(1, Math.min(MAX_RECORDS, limit)))
      .map((record) => ({ ...record }));
  }

  public get(tradeId: string): LearningTradeRecord | null {
    const record = this.records.get(tradeId);
    return record ? { ...record } : null;
  }

  public exportState(): LearningTradeRecord[] {
    return this.list(MAX_RECORDS);
  }

  public hydrate(records: LearningTradeRecord[]): void {
    this.records.clear();
    for (const record of records.slice(-MAX_RECORDS)) {
      if (record?.tradeId) this.records.set(record.tradeId, { ...record });
    }
  }

  public exportLearningDataset(limit = MAX_RECORDS): LearningFeatureDataset {
    return buildLearningFeatureDataset(this.list(limit));
  }

  public clear(): void {
    this.records.clear();
  }
}

export const learningPerformanceJournal = new LearningPerformanceJournal();
