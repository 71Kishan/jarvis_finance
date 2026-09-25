import { describe, expect, test } from "bun:test";
import { FirstMlExperiment } from "../src/learn/mlBaseline";
import { buildDecisionFeatureSnapshot } from "../src/learn/features";
import type { Candle, StrategyConfig } from "../src/types/trading";
import type { SignalResult } from "../src/engine/signalEngine";
import type { LearningTradeRecord } from "../src/learn/types";

const strategy: StrategyConfig = {
  id: "ml-test",
  name: "ML Test",
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
    low: 98,
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
    tradeId: "ml-" + index,
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
    pnlUsd: win ? 1.2 + (index % 4) * 0.1 : -0.9,
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

describe("first ML experiment", () => {
  test("blocks below the research dataset gate", () => {
    const result = FirstMlExperiment.run(Array.from({ length: 89 }, (_, i) => record(i)));
    expect(result.status).toBe("BLOCKED");
    expect(result.model).toBeNull();
    expect(result.blockedReasons.join(" ")).toContain("90");
  });

  test("is deterministic and keeps the test partition held out during selection", () => {
    const records = Array.from({ length: 120 }, (_, i) => record(i));
    const a = FirstMlExperiment.run(records);
    const b = FirstMlExperiment.run(records);

    expect(a).toEqual(b);
    expect(a.status).toBe("READY");
    expect(a.train).not.toBeNull();
    expect(a.validation).not.toBeNull();
    expect(a.test).not.toBeNull();
    expect(a.deterministicTest).not.toBeNull();
    expect(a.modelFilteredTest).not.toBeNull();
    expect(a.selectedThreshold).toBeGreaterThanOrEqual(0.5);
    expect(a.selectedThreshold).toBeLessThanOrEqual(0.65);
    expect(a.test!.rows).toBe(24);
    expect(a.selectedFeatures.length).toBeGreaterThan(0);
  });

  test("blocks a single-class training partition", () => {
    const records = Array.from({ length: 120 }, (_, i) => {
      const row = record(i);
      row.outcome = "WIN";
      row.pnlUsd = 1;
      return row;
    });
    const result = FirstMlExperiment.run(records);
    expect(result.status).toBe("INSUFFICIENT_CLASS_VARIETY");
  });
});
