import type { Candle } from "../types/trading";

export const BINANCE_CHART_INTERVALS = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
] as const;

export type BinanceChartInterval = (typeof BINANCE_CHART_INTERVALS)[number];

export const isBinanceChartInterval = (value: string): value is BinanceChartInterval =>
  (BINANCE_CHART_INTERVALS as readonly string[]).includes(value);

export interface NormalizedChartBars {
  completed: Candle[];
  formingCandle: Candle | null;
}

function mapKlineRow(row: unknown): Candle | null {
  if (!Array.isArray(row)) return null;

  const candle: Candle = {
    timestamp: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };

  return [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
    ? candle
    : null;
}

export function normalizeBinanceKlines(
  rows: unknown[],
  now = Date.now(),
  maxCompleted = 500,
): NormalizedChartBars {
  const completed: Candle[] = [];
  let formingCandle: Candle | null = null;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    const candle = mapKlineRow(row);
    const closeTime = Number(row[6]);

    if (!candle || !Number.isFinite(closeTime)) continue;

    if (closeTime > now) {
      formingCandle = candle;
    } else {
      completed.push(candle);
    }
  }

  completed.sort((a, b) => a.timestamp - b.timestamp);

  return {
    completed: completed.slice(-Math.max(1, Math.min(maxCompleted, 1000))),
    formingCandle,
  };
}
