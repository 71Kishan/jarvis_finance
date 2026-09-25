import { describe, expect, test } from "bun:test";
import { MlRollingRobustness } from "../src/learn/mlRobustness";
import { buildDecisionFeatureSnapshot } from "../src/learn/features";
import type { Candle, StrategyConfig } from "../src/types/trading";
import type { SignalResult } from "../src/engine/signalEngine";
import type { LearningTradeRecord } from "../src/learn/types";

const strategy: StrategyConfig = {
  id: "robust-test",
  name: "Robust Test",
  version: 1,
  asset: "BTC/USD",
  description: "test",
  rsiOversold: 34,
  rsiOverbought: 68,
  stopLossPercent: 1,
  takeProfitPercent: 2,
  trailingStop: true,
  trailingStopPercent: 0.5,
  minConfidence: 70,
  maxRiskPerTrade: 0.5,
  indicatorWeights: { trendEMA: 0.3, rsiReversal: 0.2, bollingerMeanReversion: 0.15, macdMomentum: 0.25, volumeConfirmation: 0.1 },
  rules: [],
};

const signal: SignalResult = {
  direction: "LONG",
  score: 80,
  eligible: true,
  reasons: ["test"],
  components: [
    { name: "Trend", direction: "LONG", points: 30, reason: "trend" },
    { name: "Momentum", direction: "LONG", points: 25, reason: "momentum" },
    { name: "RSI Momentum", direction: "LONG", points: 20, reason: "rsi" },
    { name: "Volatility Structure", direction: "LONG", points: 15, reason: "bb" },
    { name: "Volume", direction: "NEUTRAL", points: 0, reason: "Volume participation confirmed." },
  ],
};

function record(index: number): LearningTradeRecord {
  const candle: Candle = {
    timestamp: 1_700_000_000_000 + index * 3_600_000,
    open: 99 + (index % 5) * 0.1,
    high: 103 + (index % 7) * 0.1,
    low: 98 + (index % 3) * 0.05,
    close: 102 + (index % 11) * 0.2,
    volume: 200 + (index % 9) * 20,
    indicators: {
      ema9: 99 + (index % 3),
      ema21: 98 + (index % 4),
      ema50: 97 + (index % 5),
      rsi: 45 + (index % 35),
      bbandUpper: 106 + (index % 4),
      bbandMiddle: 101 + (index % 3),
      bbandLower: 96,
      atr: 1.5 + (index % 5) * 0.2,
      macd: 0.2 + (index % 6) * 0.1,
      macdSignal: 0.1 + (index % 4) * 0.05,
      macdHist: -0.2 + (index % 8) * 0.08,
      volumeSMA: 180,
    },
  };
  const features = buildDecisionFeatureSnapshot(candle, signal, strategy, {
    recordedAt: candle.timestamp + 1_000,
    spreadBps: 3 + (index % 4),
    marketOpen: true,
    marketDataTimestamp: candle.timestamp,
    marketDataSource: "LIVE_MARKET_DATA",
  });
  const win = index % 3 !== 0;
  return {
    tradeId: "rolling-" + index,
    recordedAt: candle.timestamp + 120_000,
    asset: "BTC/USD",
    side: "LONG",
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    strategyName: strategy.name,
    signalScore: 80,
    entryPrice: 103,
    exitPrice: win ? 105 : 101,
    quantity: 1,
    sizeUsd: 103,
    feesUsd: 0.1,
    slippageUsd: 0.02,
    pnlUsd: win ? 1.2 : -0.9,
    pnlPercent: win ? 1.2 : -0.9,
    outcome: win ? "WIN" : "LOSS",
    entryTime: candle.timestamp + 60_000,
    exitTime: candle.timestamp + 120_000,
    holdingPeriodMs: 60_000,
    exitStatus: win ? "CLOSED_TAKE_PROFIT" : "CLOSED_STOP_LOSS",
    rationale: "test",
    features,
  };
}

describe("ML rolling robustness", () => {
  test("requires enough chronological history for three independent folds", () => {
    const result = MlRollingRobustness.run(Array.from({ length: 209 }, (_, i) => record(i)));
    expect(result.status).toBe("INSUFFICIENT_HISTORY");
    expect(result.foldsCompleted).toBe(0);
  });

  test("runs three chronological folds without using later rows for earlier selections", () => {
    const records = Array.from({ length: 240 }, (_, i) => record(i));
    const result = MlRollingRobustness.run(records);
    expect(result.status).toBe("READY");
    expect(result.foldsCompleted).toBe(3);
    expect(result.totalTestRows).toBe(90);
    expect(result.folds[0].testRows).toBe(30);
    expect(result.folds[1].fold).toBe(2);
    expect(result.notes.length).toBeGreaterThan(0);
  });
});
