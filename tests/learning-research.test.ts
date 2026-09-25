import { describe, expect, test } from "bun:test";
import { generateResearchCandidates } from "../src/learn/candidateGenerator";
import { LearningResearchLoop } from "../src/learn/researchLoop";
import type { Candle, StrategyConfig } from "../src/types/trading";
import type { LearningTradeRecord } from "../src/learn/types";

const strategy: StrategyConfig = {
  id: "base",
  name: "Base",
  version: 1,
  asset: "BTC/USD",
  description: "test",
  rsiOversold: 34,
  rsiOverbought: 68,
  stopLossPercent: 1,
  takeProfitPercent: 2.2,
  trailingStop: true,
  trailingStopPercent: 0.6,
  minConfidence: 70,
  maxRiskPerTrade: 0.5,
  indicatorWeights: {
    trendEMA: 0.3,
    rsiReversal: 0.2,
    bollingerMeanReversion: 0.15,
    macdMomentum: 0.25,
    volumeConfirmation: 0.1,
  },
  rules: [],
};

function makeCandle(index: number): Candle {
  const close = 100 + index * 0.1;
  return {
    timestamp: 1_700_000_000_000 + index * 60_000,
    open: close - 0.05,
    high: close + 0.1,
    low: close - 0.1,
    close,
    volume: 100,
  };
}

function makeRecord(index: number): LearningTradeRecord {
  return {
    tradeId: "trade-" + index,
    recordedAt: 1_700_000_000_000 + index * 86_400_000,
    asset: "BTC/USD",
    side: "LONG",
    strategyId: "base",
    strategyVersion: 1,
    strategyName: "Base",
    signalScore: 70 + (index % 10),
    entryPrice: 100,
    exitPrice: 101,
    quantity: 1,
    sizeUsd: 100,
    feesUsd: 0.08,
    slippageUsd: 0.02,
    pnlUsd: index % 3 === 0 ? -0.5 : 0.9,
    pnlPercent: index % 3 === 0 ? -0.5 : 0.9,
    outcome: index % 3 === 0 ? "LOSS" : "WIN",
    entryTime: 1_700_000_000_000 + index * 60_000,
    exitTime: 1_700_000_060_000 + index * 60_000,
    holdingPeriodMs: 60_000,
    exitStatus: index % 3 === 0 ? "CLOSED_STOP_LOSS" : "CLOSED_TAKE_PROFIT",
    rationale: "test outcome",
  };
}

describe("learning research loop", () => {
  test("generates deterministic, bounded candidate perturbations", () => {
    const a = generateResearchCandidates(strategy);
    const b = generateResearchCandidates(strategy);

    expect(a).toEqual(b);
    expect(a.length).toBe(6);
    expect(new Set(a.map((candidate) => candidate.id)).size).toBe(6);

    for (const candidate of a) {
      const total = Object.values(candidate.indicatorWeights).reduce((sum, value) => sum + value, 0);
      expect(total).toBeCloseTo(1, 10);
      expect(candidate.maxRiskPerTrade).toBeGreaterThanOrEqual(0.1);
      expect(candidate.maxRiskPerTrade).toBeLessThanOrEqual(1);
      expect(candidate.minConfidence).toBeGreaterThanOrEqual(50);
      expect(candidate.minConfidence).toBeLessThanOrEqual(90);
    }
  });

  test("blocks research proposals when historical data is insufficient", () => {
    const result = LearningResearchLoop.run(
      strategy,
      Array.from({ length: 359 }, (_, index) => makeCandle(index)),
      Array.from({ length: 100 }, (_, index) => makeRecord(index)),
    );

    expect(result.status).toBe("INSUFFICIENT_HISTORY");
    expect(result.proposedCandidate).toBeNull();
    expect(result.gates.minimumHistoryBars).toBe(false);
  });

  test("blocks self-improvement proposals when the structured outcome dataset is too small", () => {
    const result = LearningResearchLoop.run(
      strategy,
      Array.from({ length: 360 }, (_, index) => makeCandle(index)),
      Array.from({ length: 29 }, (_, index) => makeRecord(index)),
    );

    expect(result.status).toBe("INSUFFICIENT_LEARNING_DATA");
    expect(result.proposedCandidate).toBeNull();
    expect(result.gates.minimumLearningTrades).toBe(false);
  });

  test("summarizes structured outcomes without treating signal score as probability", () => {
    const summary = LearningResearchLoop.summarizeDataset(
      Array.from({ length: 30 }, (_, index) => makeRecord(index)),
    );

    expect(summary.tradeRecords).toBe(30);
    expect(summary.wins).toBe(20);
    expect(summary.losses).toBe(10);
    expect(summary.flats).toBe(0);
    expect(summary.strategiesObserved).toBe(1);
    expect(summary.totalPnlUsd).toBeCloseTo(13, 8);
  });
});
