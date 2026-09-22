import test from "node:test";
import assert from "node:assert/strict";
import { attachIndicators } from "./indicators";
import { StrategyOptimizer } from "./optimizer";
import { StrategyVault } from "./strategyVault";
import { StrategyConfig, Trade } from "../types/trading";

const strategy: StrategyConfig = {
  id: "test-strategy",
  name: "Test Strategy",
  version: 1,
  asset: "BTC/USD",
  description: "Unit-test strategy",
  rsiOversold: 30,
  rsiOverbought: 70,
  stopLossPercent: 1,
  takeProfitPercent: 2,
  trailingStop: false,
  trailingStopPercent: 0.5,
  minConfidence: 100,
  maxRiskPerTrade: 1,
  indicatorWeights: {
    trendEMA: 0.3,
    rsiReversal: 0.25,
    bollingerMeanReversion: 0.2,
    macdMomentum: 0.15,
    volumeConfirmation: 0.1,
  },
  rules: [],
};

function candles(count: number) {
  const raw = [];
  for (let i = 0; i < count; i++) {
    const close = 100 + i * 0.5;
    raw.push({
      timestamp: Date.UTC(2026, 0, 1) + i * 60_000,
      open: close - 0.25,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000 + i,
    });
  }
  return attachIndicators(raw);
}

test("optimizer rejects undersized samples", () => {
  const result = StrategyOptimizer.backtest(strategy, candles(40));
  assert.equal(result.verdict, "INSUFFICIENT_DATA");
  assert.equal(result.totalTrades, 0);
});

test("optimizer returns explicit cost and risk metrics", () => {
  const result = StrategyOptimizer.backtest(strategy, candles(120));
  assert.equal(typeof result.totalFees, "number");
  assert.equal(typeof result.totalSlippage, "number");
  assert.equal(typeof result.sharpeRatio, "number");
  assert.equal(typeof result.sortinoRatio, "number");
  assert.equal(typeof result.maxDrawdown, "number");
  assert.ok(result.verdict);
});

test("strategy vault never promotes paper results automatically", () => {
  const vault = new StrategyVault();
  const entry = vault.registerStrategy(strategy);
  assert.equal(entry.status, "TESTING_PAPER");

  const trade: Trade = {
    id: "t1",
    asset: strategy.asset,
    type: "LONG",
    entryPrice: 100,
    exitPrice: 102,
    amount: 1,
    sizeUsd: 100,
    entryTime: Date.now(),
    exitTime: Date.now(),
    stopLoss: 99,
    takeProfit: 102,
    pnl: 2,
    pnlPercent: 2,
    status: "CLOSED_TAKE_PROFIT",
    confidence: 0,
    rationale: "test",
  };

  vault.recordTradeOutcome(strategy, trade);
  const afterPaper = vault.getAllStrategies()[0];
  assert.equal(afterPaper.status, "TESTING_PAPER");
  assert.equal(afterPaper.totalTrades, 1);

  vault.recordValidation(strategy, {
    inSampleTrades: 100,
    outOfSampleTrades: 40,
    walkForwardWindows: 4,
    lastValidatedAt: Date.now(),
    validationPassed: true,
  });

  assert.equal(vault.getProvenStrategies().length, 1);
});

test("daily profit target API is disabled", () => {
  const vault = new StrategyVault();
  vault.setDailyTarget(500);
  assert.equal(vault.getDailyGoal().dailyTargetUsd, 0);
  assert.equal(vault.getDailyGoal().targetAchieved, false);
});
