import type { MarketDataSource, Candle, StrategyConfig } from "../types/trading";
import type { SignalResult } from "../engine/signalEngine";

export const LEARNING_FEATURE_SCHEMA_VERSION = 1 as const;

export interface DecisionFeatureSnapshot {
  schemaVersion: typeof LEARNING_FEATURE_SCHEMA_VERSION;
  decisionTimestamp: number;
  asset: string;
  strategyId: string;
  strategyVersion: number;
  signalDirection: SignalResult["direction"];
  signalScore: number; // Score only; never a calibrated probability.
  eligible: boolean;
  price: number;
  priceVsEma9Pct: number | null;
  priceVsEma21Pct: number | null;
  priceVsEma50Pct: number | null;
  ema9Vs21Pct: number | null;
  ema21Vs50Pct: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bollingerPosition: number | null;
  bollingerWidthPct: number | null;
  atrPct: number | null;
  volumeRatio: number | null;
  candleReturnPct: number | null;
  candleRangePct: number | null;
  candleBodyToRange: number | null;
  trendAlignment: -1 | 0 | 1;
  momentumAlignment: -1 | 0 | 1;
  rsiAlignment: -1 | 0 | 1;
  volatilityStructureAlignment: -1 | 0 | 1;
  volumeConfirmed: boolean;
  spreadBps: number | null;
  marketOpen: boolean | null;
  marketDataTimestamp: number | null;
  marketDataSource: MarketDataSource | null;
  marketDataAgeMs: number | null;
}

const finiteOrNull = (value: number | undefined): number | null => (
  value !== undefined && Number.isFinite(value) ? Number(value) : null
);

const pct = (numerator: number, denominator: number): number | null => (
  Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? Number(((numerator / denominator) * 100).toFixed(6))
    : null
);

const directionValue = (direction: "LONG" | "SHORT" | "NEUTRAL"): -1 | 0 | 1 => (
  direction === "LONG" ? 1 : direction === "SHORT" ? -1 : 0
);

const componentDirection = (
  signal: SignalResult,
  name: string,
): -1 | 0 | 1 => {
  const component = signal.components.find((entry) => entry.name === name);
  return component ? directionValue(component.direction) : 0;
};

/**
 * Capture decision-time features from the completed signal candle.
 *
 * The snapshot is intentionally created before execution. That means later
 * model/research work cannot accidentally reconstruct entry features from the
 * exit bar or from information that was unavailable at decision time.
 */
export function buildDecisionFeatureSnapshot(
  candle: Candle,
  signal: SignalResult,
  strategy: StrategyConfig,
  context: {
    recordedAt?: number;
    spreadBps?: number;
    marketOpen?: boolean;
    marketDataTimestamp?: number;
    marketDataSource?: MarketDataSource;
  } = {},
): DecisionFeatureSnapshot {
  const ind = candle.indicators;
  const recordedAt = Number.isFinite(context.recordedAt)
    ? Number(context.recordedAt)
    : Date.now();
  const price = Number.isFinite(candle.close) ? candle.close : 0;
  const bandWidth = ind ? ind.bbandUpper - ind.bbandLower : 0;
  const range = candle.high - candle.low;
  const marketDataTimestamp = finiteOrNull(context.marketDataTimestamp);
  const marketDataAgeMs = marketDataTimestamp !== null
    ? Math.max(0, recordedAt - marketDataTimestamp)
    : null;

  return {
    schemaVersion: LEARNING_FEATURE_SCHEMA_VERSION,
    decisionTimestamp: Number(candle.timestamp) || recordedAt,
    asset: strategy.asset,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    signalDirection: signal.direction,
    signalScore: Number.isFinite(signal.score) ? signal.score : 0,
    eligible: Boolean(signal.eligible),
    price,
    priceVsEma9Pct: ind ? pct(price - ind.ema9, ind.ema9) : null,
    priceVsEma21Pct: ind ? pct(price - ind.ema21, ind.ema21) : null,
    priceVsEma50Pct: ind ? pct(price - ind.ema50, ind.ema50) : null,
    ema9Vs21Pct: ind ? pct(ind.ema9 - ind.ema21, ind.ema21) : null,
    ema21Vs50Pct: ind ? pct(ind.ema21 - ind.ema50, ind.ema50) : null,
    rsi: ind ? finiteOrNull(ind.rsi) : null,
    macd: ind ? finiteOrNull(ind.macd) : null,
    macdSignal: ind ? finiteOrNull(ind.macdSignal) : null,
    macdHist: ind ? finiteOrNull(ind.macdHist) : null,
    bollingerPosition: ind && bandWidth > 0
      ? Number(((price - ind.bbandMiddle) / bandWidth).toFixed(6))
      : null,
    bollingerWidthPct: ind ? pct(ind.bbandUpper - ind.bbandLower, price) : null,
    atrPct: ind ? pct(ind.atr, price) : null,
    volumeRatio: ind && ind.volumeSMA > 0
      ? Number((candle.volume / ind.volumeSMA).toFixed(6))
      : null,
    candleReturnPct: pct(candle.close - candle.open, candle.open),
    candleRangePct: pct(range, price),
    candleBodyToRange: range > 0
      ? Number(((candle.close - candle.open) / range).toFixed(6))
      : 0,
    trendAlignment: componentDirection(signal, "Trend"),
    momentumAlignment: componentDirection(signal, "Momentum"),
    rsiAlignment: componentDirection(signal, "RSI Momentum"),
    volatilityStructureAlignment: componentDirection(signal, "Volatility Structure"),
    volumeConfirmed: signal.components.some(
      (entry) => entry.name === "Volume" && entry.reason.includes("participation confirmed"),
    ),
    spreadBps: finiteOrNull(context.spreadBps),
    marketOpen: context.marketOpen === undefined ? null : Boolean(context.marketOpen),
    marketDataTimestamp,
    marketDataSource: context.marketDataSource ?? null,
    marketDataAgeMs,
  };
}
