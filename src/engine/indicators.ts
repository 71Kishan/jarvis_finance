import { Candle, IndicatorValues } from "../types/trading";

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 1) {
    throw new Error("Indicator period must be an integer greater than 1.");
  }
}

export function calculateEMA(prices: number[], period: number): number[] {
  assertPeriod(period);
  if (prices.length === 0) return [];

  const k = 2 / (period + 1);
  const ema = new Array<number>(prices.length);
  ema[0] = prices[0];

  for (let i = 1; i < prices.length; i += 1) {
    ema[i] = prices[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

export function calculateRSI(prices: number[], period = 14): number[] {
  assertPeriod(period);
  const result = new Array<number>(prices.length).fill(Number.NaN);
  if (prices.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i += 1) {
    const change = prices[i] - prices[i - 1];
    gainSum += Math.max(change, 0);
    lossSum += Math.max(-change, 0);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = rsiValue(avgGain, avgLoss);

  for (let i = period + 1; i < prices.length; i += 1) {
    const change = prices[i] - prices[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = ((period - 1) * avgGain + gain) / period;
    avgLoss = ((period - 1) * avgLoss + loss) / period;
    result[i] = rsiValue(avgGain, avgLoss);
  }

  return result;
}

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function calculateBollingerBands(
  prices: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  assertPeriod(period);
  if (!Number.isFinite(stdDevMultiplier) || stdDevMultiplier <= 0) {
    throw new Error("Bollinger standard deviation multiplier must be positive.");
  }

  const upper = new Array<number>(prices.length).fill(Number.NaN);
  const middle = new Array<number>(prices.length).fill(Number.NaN);
  const lower = new Array<number>(prices.length).fill(Number.NaN);

  for (let i = period - 1; i < prices.length; i += 1) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((sum, p) => sum + p, 0) / period;
    const variance = slice.reduce((sum, p) => sum + (p - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);

    middle[i] = mean;
    upper[i] = mean + stdDevMultiplier * stdDev;
    lower[i] = mean - stdDevMultiplier * stdDev;
  }

  return { upper, middle, lower };
}

export function calculateATR(candles: Candle[], period = 14): number[] {
  assertPeriod(period);
  if (candles.length === 0) return [];

  const tr = candles.map((candle, i) => {
    if (i === 0) return candle.high - candle.low;
    const prevClose = candles[i - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose),
    );
  });

  const atr = new Array<number>(candles.length).fill(Number.NaN);
  if (tr.length < period) return atr;

  let currentAtr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atr[period - 1] = currentAtr;

  for (let i = period; i < tr.length; i += 1) {
    currentAtr = ((period - 1) * currentAtr + tr[i]) / period;
    atr[i] = currentAtr;
  }

  return atr;
}

export function calculateMACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: number[]; signal: number[]; hist: number[] } {
  assertPeriod(fastPeriod);
  assertPeriod(slowPeriod);
  assertPeriod(signalPeriod);
  if (fastPeriod >= slowPeriod) throw new Error("MACD fast period must be smaller than slow period.");

  const emaFast = calculateEMA(prices, fastPeriod);
  const emaSlow = calculateEMA(prices, slowPeriod);
  const macdLine = prices.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = calculateEMA(macdLine, signalPeriod);
  const hist = macdLine.map((value, i) => value - signalLine[i]);

  return { macd: macdLine, signal: signalLine, hist };
}

export function attachIndicators(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const rsi = calculateRSI(closes, 14);
  const bb = calculateBollingerBands(closes, 20, 2);
  const atr = calculateATR(candles, 14);
  const macd = calculateMACD(closes, 12, 26, 9);

  return candles.map((candle, idx) => {
    const volStart = Math.max(0, idx - 19);
    const volumeSMA = volumes.slice(volStart, idx + 1).reduce((a, b) => a + b, 0) / (idx - volStart + 1);

    const required = [ema50[idx], rsi[idx], bb.upper[idx], bb.middle[idx], bb.lower[idx], atr[idx]];
    const ready = idx >= 49 && required.every((v) => Number.isFinite(v));

    const indicators: IndicatorValues = {
      ema9: ema9[idx],
      ema21: ema21[idx],
      ema50: ema50[idx],
      rsi: rsi[idx],
      bbandUpper: bb.upper[idx],
      bbandMiddle: bb.middle[idx],
      bbandLower: bb.lower[idx],
      atr: atr[idx],
      macd: macd.macd[idx],
      macdSignal: macd.signal[idx],
      macdHist: macd.hist[idx],
      volumeSMA,
      ready,
    };

    return { ...candle, indicators };
  });
}
