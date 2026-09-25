import { describe, expect, test } from "bun:test";
import { buildLearningTradeRecord } from "../src/learn/types";
import { LearningPerformanceJournal } from "../src/learn/performanceJournal";
import type { StrategyConfig, Trade } from "../src/types/trading";

const strategy: StrategyConfig = {
  id: "strategy-1",
  name: "Test Strategy",
  version: 7,
  asset: "BTC/USD",
  description: "test",
  rsiOversold: 30,
  rsiOverbought: 70,
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

const trade: Trade = {
  id: "PTRD-1",
  asset: "BTC/USD",
  type: "LONG",
  entryPrice: 100,
  exitPrice: 105,
  amount: 2,
  sizeUsd: 200,
  entryTime: 1_000,
  exitTime: 2_000,
  stopLoss: 99,
  takeProfit: 102,
  pnl: 9,
  pnlPercent: 4.5,
  feesUsd: 1,
  slippageUsd: 0.2,
  status: "CLOSED_TAKE_PROFIT",
  signalScore: 82,
  confidence: 82,
  rationale: "Trend and momentum aligned.",
};

describe("learning performance journal", () => {
  test("builds a structured outcome record without treating score as probability", () => {
    const record = buildLearningTradeRecord(trade, strategy, 3_000);

    expect(record).toMatchObject({
      tradeId: "PTRD-1",
      strategyId: "strategy-1",
      strategyVersion: 7,
      signalScore: 82,
      pnlUsd: 9,
      outcome: "WIN",
      holdingPeriodMs: 1_000,
      exitStatus: "CLOSED_TAKE_PROFIT",
    });
  });

  test("is idempotent by trade id and can restore exported records", () => {
    const journal = new LearningPerformanceJournal();

    const first = journal.recordTrade(trade, strategy, 3_000);
    const second = journal.recordTrade({ ...trade, pnl: 999 }, strategy, 4_000);
    expect(second).toEqual(first);

    const restored = new LearningPerformanceJournal();
    restored.hydrate(journal.exportState());

    expect(restored.get("PTRD-1")).toEqual(first);
  });

  test("keeps the learning dataset bounded", () => {
    const journal = new LearningPerformanceJournal();

    for (let i = 0; i < 2_050; i += 1) {
      journal.recordTrade({ ...trade, id: "TRADE-" + i }, strategy, i);
    }

    expect(journal.list(10)).toHaveLength(10);
    expect(journal.get("TRADE-0")).toBeNull();
    expect(journal.get("TRADE-2049")).not.toBeNull();
  });
});
