import { describe, expect, test } from "bun:test";
import { DEFAULT_RISK_POLICY, evaluateRisk } from "../src/engine/riskPolicy";
import { DEFAULT_STRATEGY } from "../src/engine/tradingEngine";
import { modelEntryFill, modelExitFill, resolveStopTarget, grossPnL } from "../src/engine/executionModel";
import { evaluateSignal } from "../src/engine/signalEngine";
import { Candle } from "../src/types/trading";

const indicators = {
  ema9: 105, ema21: 103, ema50: 100, rsi: 58,
  bbandUpper: 110, bbandMiddle: 102, bbandLower: 94,
  atr: 1.2, macd: 2, macdSignal: 1, macdHist: 1, volumeSMA: 1000,
};
const candle = (timestamp: number): Candle => ({
  timestamp, open: 104, high: 106, low: 103, close: 105, volume: 1200, indicators: { ...indicators },
});

describe("execution model", () => {
  test("models adverse entry and exit slippage", () => {
    const settings = { slippageBps: 10, feeTierPercent: 0.04, leverage: 1, soundAlerts: false };
    expect(modelEntryFill(100, "LONG", 1000, settings).fillPrice).toBeGreaterThan(100);
    expect(modelExitFill(100, "LONG", 1000, settings).fillPrice).toBeLessThan(100);
  });
  test("uses conservative stop-first handling for ambiguous bars", () => {
    const result = resolveStopTarget("LONG", { open: 100, high: 105, low: 95, close: 101 }, 97, 103);
    expect(result).toEqual({ kind: "STOP", price: 97, ambiguous: true });
  });
  test("calculates long and short gross PnL", () => {
    expect(grossPnL("LONG", 100, 110, 2)).toBe(20);
    expect(grossPnL("SHORT", 100, 90, 2)).toBe(20);
  });
});

describe("risk policy", () => {
  test("blocks leverage and daily drawdown violations", () => {
    const result = evaluateRisk(DEFAULT_RISK_POLICY, {
      equity: 970, peakEquity: 1000, dailyStartEquity: 1000, openPositions: 0,
      requestedNotional: 200, leverage: 2, stopLossPercent: 1, recentLossCount: 0,
    }, DEFAULT_STRATEGY);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("leverage");
    expect(result.reasons.join(" ")).toContain("Daily drawdown");
  });
});

describe("signal engine", () => {
  test("refuses to signal before warm-up", () => {
    expect(evaluateSignal(candle(Date.now()), [candle(1)], DEFAULT_STRATEGY).eligible).toBe(false);
  });
  test("requires multi-factor confluence", () => {
    const rows = Array.from({ length: 60 }, (_, i) => candle(i + 1));
    const result = evaluateSignal(rows[rows.length - 1], rows, DEFAULT_STRATEGY);
    expect(result.direction).toBe("LONG");
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.eligible).toBe(true);
  });
});
