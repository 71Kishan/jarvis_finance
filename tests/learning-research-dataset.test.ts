import { describe, expect, test } from "bun:test";
import { buildDecisionFeatureSnapshot } from "../src/learn/features";
import { buildLearningFeatureDataset } from "../src/learn/dataset";
import {
  auditLearningFeatureDataset,
  prepareLearningFeatureResearch,
  splitLearningFeatureDataset,
  LEARNING_RESEARCH_MIN_ROWS,
} from "../src/learn/researchDataset";
import type { Candle, StrategyConfig, Trade } from "../src/types/trading";
import type { SignalResult } from "../src/engine/signalEngine";
import type { LearningTradeRecord } from "../src/learn/types";

const strategy: StrategyConfig = {
  id: "research-dataset-strategy",
  name: "Research Dataset Strategy",
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
  indicatorWeights: {
    trendEMA: 0.3,
    rsiReversal: 0.2,
    bollingerMeanReversion: 0.15,
    macdMomentum: 0.25,
    volumeConfirmation: 0.1,
  },
  rules: [],
};

const candle: Candle = {
  timestamp: 1_700_000_000_000,
  open: 99,
  high: 103,
  low: 98,
  close: 102,
  volume: 250,
  indicators: {
    ema9: 100,
    ema21: 99,
    ema50: 98,
    rsi: 61,
    bbandUpper: 105,
    bbandMiddle: 100,
    bbandLower: 95,
    atr: 2,
    macd: 1.2,
    macdSignal: 0.8,
    macdHist: 0.4,
    volumeSMA: 200,
  },
};

const signal: SignalResult = {
  direction: "LONG",
  score: 82,
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

function makeRecord(index:number, features=true): LearningTradeRecord {
  const snapshot=buildDecisionFeatureSnapshot(
    { ...candle, timestamp: candle.timestamp + index*60_000 },
    signal,
    strategy,
    { recordedAt: candle.timestamp + index*60_000 + 5_000 },
  );
  return {
    tradeId: `research-${index}`,
    recordedAt: snapshot.decisionTimestamp + 10_000,
    asset: "BTC/USD",
    side: "LONG",
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    strategyName: strategy.name,
    signalScore: 82,
    entryPrice: 103,
    exitPrice: 104,
    quantity: 1,
    sizeUsd: 103,
    feesUsd: 0.1,
    slippageUsd: 0.02,
    pnlUsd: index % 4 === 0 ? -0.5 : 0.8,
    pnlPercent: index % 4 === 0 ? -0.5 : 0.8,
    outcome: index % 4 === 0 ? "LOSS" : "WIN",
    entryTime: snapshot.decisionTimestamp + 60_000,
    exitTime: snapshot.decisionTimestamp + 120_000,
    holdingPeriodMs: 60_000,
    exitStatus: index % 4 === 0 ? "CLOSED_STOP_LOSS" : "CLOSED_TAKE_PROFIT",
    rationale: "test",
    features: features ? snapshot : undefined,
  };
}

describe("learning research dataset", () => {
  test("chronologically splits without shuffling", () => {
    const records = Array.from({ length: 10 }, (_, index) => makeRecord(index));
    const dataset=buildLearningFeatureDataset(records);
    const split=splitLearningFeatureDataset(dataset);

    expect(split.train).toHaveLength(6);
    expect(split.validation).toHaveLength(2);
    expect(split.test).toHaveLength(2);
    expect(split.train[0].decisionTimestamp).toBeLessThan(split.validation[0].decisionTimestamp);
    expect(split.validation[0].decisionTimestamp).toBeLessThan(split.test[0].decisionTimestamp);
  });

  test("flags missing features and stays blocked below the first-experiment sample floor", () => {
    const records = Array.from({ length: 89 }, (_, index) => makeRecord(index));
    records[3] = makeRecord(3, false);

    const audit=auditLearningFeatureDataset(records);
    expect(audit.rowsConsidered).toBe(89);
    expect(audit.rowsMissingFeatures).toBe(1);
    expect(audit.rowsValid).toBe(88);

    const prepared=prepareLearningFeatureResearch(records);
    expect(prepared.readyForFirstExperiment).toBe(false);
    expect(prepared.blockedReasons[0]).toContain(`${LEARNING_RESEARCH_MIN_ROWS}`);
  });

  test("flags a decision snapshot captured after entry as a leakage issue", () => {
    const record=makeRecord(0);
    record.features = {
      ...record.features!,
      decisionTimestamp: record.entryTime + 1,
    };

    const audit=auditLearningFeatureDataset([record]);
    expect(audit.leakageIssues).toContain("decision_after_entry");
    expect(audit.isUsable).toBe(false);
  });

  test("does not consider outcomes part of the numeric feature names", () => {
    const dataset=buildLearningFeatureDataset([makeRecord(0)]);
    const targetNames=["pnl_usd","pnl_percent","outcome","exit_price","exit_time"];
    for (const target of targetNames) {
      expect(dataset.featureNames).not.toContain(target);
    }
  });
});
