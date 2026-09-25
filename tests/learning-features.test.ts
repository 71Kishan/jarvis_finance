import { describe, expect, test } from "bun:test";
import { buildDecisionFeatureSnapshot } from "../src/learn/features";
import { buildLearningFeatureDataset } from "../src/learn/dataset";
import { LearningPerformanceJournal } from "../src/learn/performanceJournal";
import type { Candle, StrategyConfig, Trade } from "../src/types/trading";
import type { SignalResult } from "../src/engine/signalEngine";

const strategy: StrategyConfig = {
  id: "feature-strategy",
  name: "Feature Test Strategy",
  version: 3,
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
  timestamp: 1_700_000_060_000,
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
  reasons: ["Trend and momentum aligned."],
  components: [
    { name: "Trend", direction: "LONG", points: 30, reason: "Trend aligned." },
    { name: "Momentum", direction: "LONG", points: 25, reason: "Momentum aligned." },
    { name: "RSI Momentum", direction: "LONG", points: 20, reason: "RSI aligned." },
    { name: "Volatility Structure", direction: "LONG", points: 15, reason: "Bollinger aligned." },
    { name: "Volume", direction: "NEUTRAL", points: 0, reason: "Volume is 125% of its 20-bar average; participation confirmed." },
  ],
};

const trade: Trade = {
  id: "FEATURE-TRADE-1",
  asset: "BTC/USD",
  type: "LONG",
  entryPrice: 103,
  exitPrice: 105,
  amount: 1,
  sizeUsd: 103,
  entryTime: candle.timestamp + 60_000,
  exitTime: candle.timestamp + 120_000,
  stopLoss: 101,
  takeProfit: 106,
  pnl: 1.5,
  pnlPercent: 1.46,
  feesUsd: 0.1,
  slippageUsd: 0.02,
  status: "CLOSED_TAKE_PROFIT",
  signalScore: 82,
  confidence: 82,
  rationale: "Test feature snapshot.",
};

describe("learning feature layer", () => {
  test("captures entry-time market and signal features deterministically", () => {
    const snapshot = buildDecisionFeatureSnapshot(candle, signal, strategy, {
      recordedAt: 1_700_000_065_000,
      spreadBps: 4,
      marketOpen: true,
      marketDataTimestamp: 1_700_000_064_500,
      marketDataSource: "LIVE_MARKET_DATA",
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      decisionTimestamp: candle.timestamp,
      asset: "BTC/USD",
      strategyId: "feature-strategy",
      strategyVersion: 3,
      signalDirection: "LONG",
      signalScore: 82,
      eligible: true,
      priceVsEma9Pct: 2,
      priceVsEma21Pct: 3.030303,
      atrPct: 1.960784,
      volumeRatio: 1.25,
      trendAlignment: 1,
      momentumAlignment: 1,
      rsiAlignment: 1,
      volatilityStructureAlignment: 1,
      volumeConfirmed: true,
      spreadBps: 4,
      marketOpen: true,
      marketDataSource: "LIVE_MARKET_DATA",
      marketDataAgeMs: 500,
    });
    expect(snapshot.signalScore).not.toBe(0.82);
  });

  test("dataset is numeric, versioned, stable, and excludes trades with no captured features", () => {
    const snapshot = buildDecisionFeatureSnapshot(candle, signal, strategy, { recordedAt: 1_700_000_065_000 });
    const withFeatures = { ...trade, learningFeatures: snapshot };
    const record = {
      tradeId: withFeatures.id,
      recordedAt: withFeatures.exitTime as number,
      asset: withFeatures.asset,
      side: withFeatures.type,
      strategyId: strategy.id,
      strategyVersion: strategy.version,
      strategyName: strategy.name,
      signalScore: withFeatures.signalScore,
      entryPrice: withFeatures.entryPrice,
      exitPrice: withFeatures.exitPrice as number,
      quantity: withFeatures.amount,
      sizeUsd: withFeatures.sizeUsd,
      feesUsd: withFeatures.feesUsd || 0,
      slippageUsd: withFeatures.slippageUsd || 0,
      pnlUsd: withFeatures.pnl,
      pnlPercent: withFeatures.pnlPercent,
      outcome: "WIN" as const,
      entryTime: withFeatures.entryTime,
      exitTime: withFeatures.exitTime as number,
      holdingPeriodMs: (withFeatures.exitTime as number) - withFeatures.entryTime,
      exitStatus: withFeatures.status,
      rationale: withFeatures.rationale,
      features: snapshot,
    };

    const dataset = buildLearningFeatureDataset([
      record,
      { ...record, tradeId: "MANUAL-NO-FEATURES", features: undefined },
    ]);

    expect(dataset.schemaVersion).toBe(1);
    expect(dataset.recordsConsidered).toBe(2);
    expect(dataset.recordsWithFeatures).toBe(1);
    expect(dataset.recordsWithoutFeatures).toBe(1);
    expect(dataset.rows[0].features.signal_score).toBe(82);
    expect(dataset.rows[0].features.signal_direction).toBe(1);
    expect(Object.keys(dataset.rows[0].features)).toHaveLength(27);
    expect(dataset.featureNames).toHaveLength(27);
  });

  test("journal exports the feature dataset without inventing missing features", () => {
    const snapshot = buildDecisionFeatureSnapshot(candle, signal, strategy);
    const journal = new LearningPerformanceJournal();

    journal.recordTrade({ ...trade, learningFeatures: snapshot }, strategy, 2_000);
    journal.recordTrade({ ...trade, id: "MANUAL-2", learningFeatures: undefined }, strategy, 3_000);

    const dataset = journal.exportLearningDataset();
    expect(dataset.recordsConsidered).toBe(2);
    expect(dataset.recordsWithFeatures).toBe(1);
    expect(dataset.recordsWithoutFeatures).toBe(1);
    expect(dataset.rows[0].tradeId).toBe("FEATURE-TRADE-1");
  });
});
