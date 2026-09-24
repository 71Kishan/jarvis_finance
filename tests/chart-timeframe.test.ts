import { describe, expect, test } from "bun:test";
import {
  BINANCE_CHART_INTERVALS,
  isBinanceChartInterval,
  normalizeBinanceKlines,
} from "../src/server/binanceChartData";

describe("Binance chart timeframe contract", () => {
  test("allows only supported chart intervals", () => {
    expect(isBinanceChartInterval("1m")).toBe(true);
    expect(isBinanceChartInterval("4h")).toBe(true);
    expect(isBinanceChartInterval("7m")).toBe(false);
    expect(BINANCE_CHART_INTERVALS).toContain("1d");
  });

  test("separates completed and forming provider bars", () => {
    const now = 1_700_000_060_000;

    const result = normalizeBinanceKlines([
      [1_700_000_000_000, "100", "105", "99", "104", "10", 1_700_000_059_999],
      [1_700_000_060_000, "104", "106", "103", "105", "8", 1_700_000_119_999],
      ["bad"],
    ], now);

    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]).toMatchObject({
      timestamp: 1_700_000_000_000,
      open: 100,
      high: 105,
      low: 99,
      close: 104,
      volume: 10,
    });
    expect(result.formingCandle).toMatchObject({
      timestamp: 1_700_000_060_000,
      open: 104,
      high: 106,
      low: 103,
      close: 105,
      volume: 8,
    });
  });

  test("sorts completed bars and caps history", () => {
    const now = 1_700_010_000_000;
    const rows = Array.from({ length: 3 }, (_, index) => {
      const timestamp = 1_700_000_000_000 + (2 - index) * 60_000;
      return [timestamp, "100", "101", "99", String(100 + index), "5", timestamp + 59_999];
    });

    const result = normalizeBinanceKlines(rows, now, 2);
    expect(result.completed).toHaveLength(2);
    expect(result.completed[0].timestamp).toBe(1_700_000_060_000);
    expect(result.completed[1].timestamp).toBe(1_700_000_120_000);
  });
});
