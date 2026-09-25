import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { FirstMlExperiment } from "../src/learn/mlBaseline";
import { LearningShadowStore } from "../src/server/learningShadowStore";
import { evaluateShadowPromotionGate } from "../src/server/shadowPromotionGate";
import type { DecisionFeatureSnapshot } from "../src/learn/features";
import type { Trade } from "../src/types/trading";

const snapshot: DecisionFeatureSnapshot = {
  schemaVersion: 1, decisionTimestamp: 1700000000000, asset: "BTC/USD",
  strategyId: "shadow-test", strategyVersion: 1, signalDirection: "LONG",
  signalScore: 80, eligible: true, price: 100, priceVsEma9Pct: 1,
  priceVsEma21Pct: 2, priceVsEma50Pct: 3, ema9Vs21Pct: 1, ema21Vs50Pct: 1,
  rsi: 60, macd: 1, macdSignal: 0.8, macdHist: 0.2, bollingerPosition: 0.2,
  bollingerWidthPct: 4, atrPct: 1.5, volumeRatio: 1.2, candleReturnPct: 0.5,
  candleRangePct: 2, candleBodyToRange: 0.5, trendAlignment: 1,
  momentumAlignment: 1, rsiAlignment: 1, volatilityStructureAlignment: 1,
  volumeConfirmed: true, spreadBps: 3, marketOpen: true,
  marketDataTimestamp: 1699999999900, marketDataSource: "LIVE_MARKET_DATA",
  marketDataAgeMs: 100,
};

const model = {
  schemaVersion: 1 as const,
  modelType: "LOGISTIC_META_LABELER" as const,
  featureNames: ["signal_score"],
  means: [70], scales: [10], weights: [0.5], bias: 0,
  calibrationSlope: 1, calibrationIntercept: 0, threshold: 0.55,
  config: { regularization: 1, learningRate: 0.05, iterations: 700, classWeighting: "NONE" as const },
  trainedThrough: 1700000000000, fingerprint: "shadow-model-v1",
};

test("shadow prediction artifact is deterministic", () => {
  const a = FirstMlExperiment.predictShadow(model, snapshot);
  const b = FirstMlExperiment.predictShadow(model, snapshot);
  expect(a).toEqual(b);
  expect(a.modelFingerprint).toBe(model.fingerprint);
  expect(a.probability).toBeGreaterThan(0);
  expect(a.probability).toBeLessThan(1);
});

test("shadow store persists and resolves a paper trade", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-shadow-"));
  const file = path.join(dir, "shadow.json");
  try {
    const store = new LearningShadowStore(file);
    store.setModel(model);
    store.record(snapshot, FirstMlExperiment.predictShadow(model, snapshot), "paper-1", 2000);
    const trade = {
      id: "paper-1", asset: "BTC/USD", type: "LONG",
      entryPrice: 100, exitPrice: 102, amount: 1, sizeUsd: 100,
      entryTime: 1000, exitTime: 2100, stopLoss: 99, takeProfit: 102,
      pnl: 2, pnlPercent: 2, status: "CLOSED_TAKE_PROFIT",
      signalScore: 80, confidence: 80, rationale: "test",
    } as Trade;
    store.resolveTrade(trade, 3000);
    const restored = new LearningShadowStore(file);
    const summary = restored.getSummary();
    expect(restored.getModel()?.fingerprint).toBe(model.fingerprint);
    expect(summary.predictions).toBe(1);
    expect(summary.resolvedPredictions).toBe(1);
    expect(summary.wins).toBe(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("shadow promotion review stays blocked until all gates are satisfied", () => {
  const experiment = {
    mlStatus: "READY",
    modelFingerprint: "shadow-model-v1",
    mlRobustnessStatus: "READY",
    robustness: { stableAcrossFolds: true },
  } as any;

  const blocked = evaluateShadowPromotionGate(experiment, {
    predictions: 99, resolvedPredictions: 49,
    wins: 30, losses: 19, flats: 0, meanProbability: 0.6,
    logLoss: 0.6, brierScore: 0.2,
    baselineLogLoss: 0.7, baselineBrierScore: 0.25,
    featureDriftScore: 0.5, missingFeatureRate: 0,
    driftFlag: false, lastPredictionAt: 1, lastResolvedAt: 1,
  });
  expect(blocked.eligibleForReview).toBe(false);

  const ready = evaluateShadowPromotionGate(experiment, {
    predictions: 100, resolvedPredictions: 50,
    wins: 30, losses: 20, flats: 0, meanProbability: 0.6,
    logLoss: 0.6, brierScore: 0.2,
    baselineLogLoss: 0.7, baselineBrierScore: 0.25,
    featureDriftScore: 0.5, missingFeatureRate: 0,
    driftFlag: false, lastPredictionAt: 2, lastResolvedAt: 2,
  });
  expect(ready.eligibleForReview).toBe(true);
});
