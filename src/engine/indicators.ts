import { Candle, IndicatorValues } from "../types/trading";

export function calculateEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emaArray: number[] = [];
  
  if (prices.length === 0) return [];
  
  let currentEma = prices[0];
  emaArray.push(currentEma);

  for (let i = 1; i < prices.length; i++) {
    currentEma = prices[i] * k + currentEma * (1 - k);
    emaArray.push(currentEma);
  }
  return emaArray;
}

export function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  if (prices.length <= period) {
    return prices.map(() => 50);
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = 0; i < period; i++) {
    rsi[i] = 50;
  }

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));
  }

  return rsi;
}

export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      middle.push(prices[i]);
      upper.push(prices[i] * 1.02);
      lower.push(prices[i] * 0.98);
      continue;
    }

    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((sum, p) => sum + p, 0) / period;
    const variance =
      slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    middle.push(mean);
    upper.push(mean + stdDevMultiplier * stdDev);
    lower.push(mean - stdDevMultiplier * stdDev);
  }

  return { upper, middle, lower };
}

export function calculateATR(candles: Candle[], period: number = 14): number[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low);
      continue;
    }
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const hl = current.high - current.low;
    const hpc = Math.abs(current.high - prevClose);
    const lpc = Math.abs(current.low - prevClose);
    tr.push(Math.max(hl, hpc, lpc));
  }

  const atr: number[] = [];
  let sum = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let currentAtr = sum / period;

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      atr.push(tr[i]);
    } else if (i === period - 1) {
      atr.push(currentAtr);
    } else {
      currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
      atr.push(currentAtr);
    }
  }

  return atr;
}

export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number[]; signal: number[]; hist: number[] } {
  const emaFast = calculateEMA(prices, fastPeriod);
  const emaSlow = calculateEMA(prices, slowPeriod);

  const macdLine: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    macdLine.push(emaFast[i] - emaSlow[i]);
  }

  const signalLine = calculateEMA(macdLine, signalPeriod);
  const hist: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    hist.push(macdLine[i] - signalLine[i]);
  }

  return { macd: macdLine, signal: signalLine, hist };
}

export function attachIndicators(candles: Candle[]): Candle[] {
  if (candles.length === 0) return candles;

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
    const volSlice = volumes.slice(Math.max(0, idx - 19), idx + 1);
    const volumeSMA = volSlice.reduce((a, b) => a + b, 0) / volSlice.length;

    const indicators: IndicatorValues = {
      ema9: ema9[idx] || candle.close,
      ema21: ema21[idx] || candle.close,
      ema50: ema50[idx] || candle.close,
      rsi: rsi[idx] ?? 50,
      bbandUpper: bb.upper[idx] || candle.close * 1.02,
      bbandMiddle: bb.middle[idx] || candle.close,
      bbandLower: bb.lower[idx] || candle.close * 0.98,
      atr: atr[idx] || candle.close * 0.015,
      macd: macd.macd[idx] || 0,
      macdSignal: macd.signal[idx] || 0,
      macdHist: macd.hist[idx] || 0,
      volumeSMA,
    };

    return {
      ...candle,
      indicators,
    };
  });
}
