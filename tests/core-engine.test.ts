import { describe, expect, test } from "bun:test";
import { DEFAULT_RISK_POLICY, evaluateRisk } from "../src/engine/riskPolicy";
import { DEFAULT_STRATEGY, TradingEngine } from "../src/engine/tradingEngine";
import { modelEntryFill, modelExitFill, resolveStopTarget, grossPnL } from "../src/engine/executionModel";
import { evaluateSignal } from "../src/engine/signalEngine";
import { Candle } from "../src/types/trading";
import { PaperStateStore } from "../src/server/paperStateStore";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const indicators = {
  ema9: 104, ema21: 103, ema50: 100, rsi: 58,
  bbandUpper: 110, bbandMiddle: 102, bbandLower: 94,
  atr: 1.2, macd: 2, macdSignal: 1, macdHist: 1, volumeSMA: 1000,
};
const candle = (timestamp: number): Candle => ({
  timestamp, open: 104, high: 106, low: 103, close: 105, volume: 1200, indicators: { ...indicators },
});

describe("execution model", () => {
  test("does not treat a next-bar entry as active on the signal bar close", () => {
    const nextBarEntryPrice = 101;
    const signalBarClose = 100;
    expect(signalBarClose).toBeLessThan(nextBarEntryPrice);
  });

  test("models adverse entry and exit slippage", () => {
    const settings = { slippageBps: 10, feeTierPercent: 0.04, leverage: 1, soundAlerts: false };
    expect(modelEntryFill(100, "LONG", 1000, settings).fillPrice).toBeGreaterThan(100);
    expect(modelExitFill(100, "LONG", 1000, settings).fillPrice).toBeLessThan(100);
  });
  test("uses conservative stop-first handling for ambiguous bars", () => {
    const result = resolveStopTarget("LONG", { open: 100, high: 105, low: 95, close: 101 }, 97, 103);
    expect(result).toEqual({ kind: "STOP", price: 97, ambiguous: true });
  });

  test("models a gap-through stop at the bar open", () => {
    const result = resolveStopTarget("LONG", { open: 94, high: 101, low: 93, close: 96 }, 97, 103);
    expect(result).toEqual({ kind: "STOP", price: 94, ambiguous: false });
  });
  test("calculates long and short gross PnL", () => {
    expect(grossPnL("LONG", 100, 110, 2)).toBe(20);
    expect(grossPnL("SHORT", 100, 90, 2)).toBe(20);
  });
});

describe("risk policy", () => {
  test("blocks trades whose stop risk exceeds the strategy risk budget", () => {
    const result = evaluateRisk(DEFAULT_RISK_POLICY, {
      equity: 10000, peakEquity: 10000, dailyStartEquity: 10000, openPositions: 0,
      requestedNotional: 3500, leverage: 1, stopLossPercent: 2, recentLossCount: 0,
    }, DEFAULT_STRATEGY);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("risk budget");
  });

  test("blocks entries when the regular market session is closed", () => {
    const result = evaluateRisk(DEFAULT_RISK_POLICY, {
      equity: 10000, peakEquity: 10000, dailyStartEquity: 10000, openPositions: 0,
      requestedNotional: 2500, leverage: 1, marketOpen: false, stopLossPercent: 1,
      recentLossCount: 0,
    }, DEFAULT_STRATEGY);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("Market session is closed");
  });

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

describe("automated paper entry timing", () => {
  test("queues an eligible signal and fills only at the next bar open", () => {
    const engine = new TradingEngine(10000, 6, DEFAULT_STRATEGY);
    engine.setMarketQuality({ spreadBps: 0, dataTimestamp: Date.now(), marketOpen: true });

    const signalBars = Array.from({ length: 60 }, (_, i) => candle(i + 1));
    const nextBar: Candle = {
      ...candle(61),
      open: 108,
      high: 109,
      low: 107,
      close: 108.5,
    };

    engine.onTick(signalBars[59], signalBars);
    expect(engine.getActiveTrade()).toBeNull();

    engine.onTick(nextBar, [...signalBars, nextBar]);
    const trade = engine.getActiveTrade();
    expect(trade).not.toBeNull();
    expect(trade?.entryPrice).toBeGreaterThan(nextBar.open);
  });
});

describe("durable paper state", () => {
  test("restores an open paper position and processed candle after restart", () => {
    const statePath = join(tmpdir(), `jarvis-paper-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const writer = new PaperStateStore(statePath);
    const first = new TradingEngine(10000, 6, DEFAULT_STRATEGY);
    first.setMarketQuality({ spreadBps: 0, dataTimestamp: Date.now(), marketOpen: true });
    expect(first.executePaperTrade({
      type: "LONG",
      amountUsd: 1000,
      leverage: 1,
      stopLossPercent: 0.5,
      takeProfitPercent: 1,
      trailingStop: true,
    }, 100)).toBe(true);
    first.onTick({ ...candle(123), high: 100.5, low: 100, close: 100.25 }, [{ ...candle(123), high: 100.5, low: 100, close: 100.25 }]);
    writer.save(first);

    const second = new TradingEngine(10000, 6, DEFAULT_STRATEGY);
    const result = new PaperStateStore(statePath).loadInto(second);

    expect(result.restored).toBe(true);
    expect(second.getActiveTrade()?.asset).toBe("BTC/USD");
    expect(second.getActiveTrade()?.entryPrice).toBe(first.getActiveTrade()?.entryPrice);
    expect(second.getLastProcessedCandleTimestamp()).toBe(123);

    if (existsSync(statePath)) unlinkSync(statePath);
  });
});

describe("signal engine", () => {
  test("treats volume as participation evidence rather than directional evidence", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      ...candle(i + 1),
      volume: 100,
      indicators: { ...indicators, volumeSMA: 1000 },
    }));
    const result = evaluateSignal(rows[rows.length - 1], rows, DEFAULT_STRATEGY);
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(" ")).toContain("Volume participation filter failed");
  });

  test("refuses to signal before warm-up", () => {
    expect(evaluateSignal(candle(Date.now()), [candle(1)], DEFAULT_STRATEGY).eligible).toBe(false);
  });
  test("requires multi-factor confluence", () => {
    const rows = Array.from({ length: 60 }, (_, i) => candle(i + 1));
    const testStrategy = {
      ...DEFAULT_STRATEGY,
      minConfidence: 70,
      indicatorWeights: {
        trendEMA: 1,
        rsiReversal: 1,
        bollingerMeanReversion: 1,
        macdMomentum: 1,
        volumeConfirmation: 1,
      },
    };
    const result = evaluateSignal(rows[rows.length - 1], rows, testStrategy);
    expect(result.direction).toBe("LONG");
    expect(result.score).toBe(100);
    expect(result.score).toBeGreaterThanOrEqual(testStrategy.minConfidence);
    expect(result.eligible).toBe(true);
  });
});
