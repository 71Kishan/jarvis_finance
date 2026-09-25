import type { LearningTradeRecord } from "./types";
import {
  DecisionFeatureSnapshot,
  LEARNING_FEATURE_SCHEMA_VERSION,
} from "./features";

export interface LearningFeatureDatasetRow {
  tradeId: string;
  recordedAt: number;
  decisionTimestamp: number;
  entryTime: number;
  exitTime: number;
  holdingPeriodMs: number;
  asset: string;
  strategyId: string;
  strategyVersion: number;
  outcome: LearningTradeRecord["outcome"];
  pnlUsd: number;
  pnlPercent: number;
  features: Record<string, number | null>;
}

export interface LearningFeatureDataset {
  schemaVersion: typeof LEARNING_FEATURE_SCHEMA_VERSION;
  featureNames: readonly string[];
  recordsConsidered: number;
  recordsWithFeatures: number;
  recordsWithoutFeatures: number;
  rows: LearningFeatureDatasetRow[];
}

export const LEARNING_FEATURE_NAMES = [
  "signal_score",
  "signal_direction",
  "eligible",
  "price_vs_ema9_pct",
  "price_vs_ema21_pct",
  "price_vs_ema50_pct",
  "ema9_vs_21_pct",
  "ema21_vs_50_pct",
  "rsi",
  "macd",
  "macd_signal",
  "macd_hist",
  "bollinger_position",
  "bollinger_width_pct",
  "atr_pct",
  "volume_ratio",
  "candle_return_pct",
  "candle_range_pct",
  "candle_body_to_range",
  "trend_alignment",
  "momentum_alignment",
  "rsi_alignment",
  "volatility_structure_alignment",
  "volume_confirmed",
  "spread_bps",
  "market_open",
  "market_data_age_ms",
] as const;

const signalDirectionValue = (direction: DecisionFeatureSnapshot["signalDirection"]) =>
  direction === "LONG" ? 1 : direction === "SHORT" ? -1 : 0;

export function toNumericFeatureVector(
  snapshot: DecisionFeatureSnapshot,
): Record<string, number | null> {
  return {
    signal_score: snapshot.signalScore,
    signal_direction: signalDirectionValue(snapshot.signalDirection),
    eligible: snapshot.eligible ? 1 : 0,
    price_vs_ema9_pct: snapshot.priceVsEma9Pct,
    price_vs_ema21_pct: snapshot.priceVsEma21Pct,
    price_vs_ema50_pct: snapshot.priceVsEma50Pct,
    ema9_vs_21_pct: snapshot.ema9Vs21Pct,
    ema21_vs_50_pct: snapshot.ema21Vs50Pct,
    rsi: snapshot.rsi,
    macd: snapshot.macd,
    macd_signal: snapshot.macdSignal,
    macd_hist: snapshot.macdHist,
    bollinger_position: snapshot.bollingerPosition,
    bollinger_width_pct: snapshot.bollingerWidthPct,
    atr_pct: snapshot.atrPct,
    volume_ratio: snapshot.volumeRatio,
    candle_return_pct: snapshot.candleReturnPct,
    candle_range_pct: snapshot.candleRangePct,
    candle_body_to_range: snapshot.candleBodyToRange,
    trend_alignment: snapshot.trendAlignment,
    momentum_alignment: snapshot.momentumAlignment,
    rsi_alignment: snapshot.rsiAlignment,
    volatility_structure_alignment: snapshot.volatilityStructureAlignment,
    volume_confirmed: snapshot.volumeConfirmed ? 1 : 0,
    spread_bps: snapshot.spreadBps,
    market_open: snapshot.marketOpen === null ? null : snapshot.marketOpen ? 1 : 0,
    market_data_age_ms: snapshot.marketDataAgeMs,
  };
}

/**
 * Build a stable, numeric dataset for future research/ML experiments.
 *
 * Only records that have an entry-time feature snapshot are exported as rows.
 * Manual paper trades without a decision snapshot remain in the performance
 * journal but are counted separately instead of being silently fabricated.
 */
export function buildLearningFeatureDataset(
  records: LearningTradeRecord[],
): LearningFeatureDataset {
  const sorted = records
    .filter((record) => record && Number.isFinite(record.recordedAt))
    .slice()
    .sort((a, b) => a.recordedAt - b.recordedAt);

  const rows = sorted
    .filter((record) => Boolean(record.features))
    .map((record) => ({
      tradeId: record.tradeId,
      recordedAt: record.recordedAt,
      decisionTimestamp: record.features!.decisionTimestamp,
      entryTime: record.entryTime,
      exitTime: record.exitTime,
      holdingPeriodMs: record.holdingPeriodMs,
      asset: record.asset,
      strategyId: record.strategyId,
      strategyVersion: record.strategyVersion,
      outcome: record.outcome,
      pnlUsd: record.pnlUsd,
      pnlPercent: record.pnlPercent,
      features: toNumericFeatureVector(record.features as DecisionFeatureSnapshot),
    }));

  return {
    schemaVersion: LEARNING_FEATURE_SCHEMA_VERSION,
    featureNames: LEARNING_FEATURE_NAMES,
    recordsConsidered: sorted.length,
    recordsWithFeatures: rows.length,
    recordsWithoutFeatures: sorted.length - rows.length,
    rows,
  };
}
