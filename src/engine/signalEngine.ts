import { Candle, IndicatorValues, StrategyConfig } from "../types/trading";

export interface SignalComponent {
  name: string;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  points: number;
  reason: string;
}

export interface SignalResult {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  score: number;
  components: SignalComponent[];
  reasons: string[];
  eligible: boolean;
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function evaluateSignal(candle: Candle, recentCandles: Candle[], strategy: StrategyConfig): SignalResult {
  const ind = candle.indicators;
  if (!ind || recentCandles.length < 60) {
    return { direction: "NEUTRAL", score: 0, components: [], reasons: ["Insufficient warm-up history."] , eligible: false };
  }

  const price = candle.close;
  const weights = strategy.indicatorWeights;
  const components: SignalComponent[] = [];

  const trendLong = ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50 && price > ind.ema9;
  const trendShort = ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50 && price < ind.ema9;
  components.push({
    name: "Trend",
    direction: trendLong ? "LONG" : trendShort ? "SHORT" : "NEUTRAL",
    points: trendLong || trendShort ? 100 * weights.trendEMA : 0,
    reason: trendLong ? "Price is above a rising 9/21/50 EMA stack." : trendShort ? "Price is below a falling 9/21/50 EMA stack." : "EMA structure is not directionally aligned.",
  });

  const momentumLong = ind.macdHist > 0 && ind.macd > ind.macdSignal;
  const momentumShort = ind.macdHist < 0 && ind.macd < ind.macdSignal;
  components.push({
    name: "Momentum",
    direction: momentumLong ? "LONG" : momentumShort ? "SHORT" : "NEUTRAL",
    points: momentumLong || momentumShort ? 100 * weights.macdMomentum : 0,
    reason: momentumLong ? "MACD momentum is positive." : momentumShort ? "MACD momentum is negative." : "MACD does not confirm direction.",
  });

  const rsiLong = ind.rsi >= 52 && ind.rsi <= 68;
  const rsiShort = ind.rsi <= 48 && ind.rsi >= 32;
  components.push({
    name: "RSI",
    direction: rsiLong ? "LONG" : rsiShort ? "SHORT" : "NEUTRAL",
    points: rsiLong || rsiShort ? 100 * weights.rsiReversal : 0,
    reason: rsiLong ? `RSI ${ind.rsi.toFixed(1)} supports positive momentum without an extreme reading.` : rsiShort ? `RSI ${ind.rsi.toFixed(1)} supports negative momentum without an extreme reading.` : `RSI ${ind.rsi.toFixed(1)} is neutral or stretched; no directional confirmation.`,
  });

  const bandLong = price >= ind.bbandMiddle && price < ind.bbandUpper;
  const bandShort = price <= ind.bbandMiddle && price > ind.bbandLower;
  components.push({
    name: "Volatility Structure",
    direction: bandLong ? "LONG" : bandShort ? "SHORT" : "NEUTRAL",
    points: bandLong || bandShort ? 100 * weights.bollingerMeanReversion : 0,
    reason: bandLong ? "Price is in the upper half of the Bollinger structure." : bandShort ? "Price is in the lower half of the Bollinger structure." : "Price is outside the expected Bollinger structure.",
  });

  const volumeLong = candle.volume >= ind.volumeSMA * 1.1;
  const volumeShort = volumeLong;
  components.push({
    name: "Volume",
    direction: volumeLong ? "LONG" : volumeShort ? "SHORT" : "NEUTRAL",
    points: volumeLong ? 100 * weights.volumeConfirmation : 0,
    reason: volumeLong ? `Volume is ${((candle.volume / Math.max(ind.volumeSMA, 1)) * 100).toFixed(0)}% of its 20-bar average.` : "Volume does not confirm participation.",
  });

  let longScore = 0;
  let shortScore = 0;
  for (const c of components) {
    if (c.direction === "LONG") longScore += c.points;
    if (c.direction === "SHORT") shortScore += c.points;
  }

  const direction = longScore === shortScore ? "NEUTRAL" : longScore > shortScore ? "LONG" : "SHORT";
  const score = Math.round(clamp(Math.max(longScore, shortScore)));
  const reasons = components.filter(c => c.direction === direction).map(c => c.reason);
  const eligible = direction !== "NEUTRAL" && score >= strategy.minConfidence;

  return { direction, score, components, reasons, eligible };
}