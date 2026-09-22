import assert from "node:assert/strict";
import { attachIndicators } from "../src/engine/indicators";
import { StrategyOptimizer } from "../src/engine/optimizer";
import { DEFAULT_STRATEGY } from "../src/engine/tradingEngine";
import type { Candle } from "../src/types/trading";

function makeCandles(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.25 + Math.sin(i / 7) * 0.8;
    return {
      timestamp: 1_700_000_000_000 + i * 60_000,
      open: close - 0.15,
      high: close + 0.45,
      low: close - 0.45,
      close,
      volume: 1_000 + (i % 10) * 25,
    };
  });
}

const candles = makeCandles(140);
const enriched = attachIndicators(candles);

assert.equal(enriched.length, candles.length);
assert.equal(enriched[0].indicators?.ready, false);
assert.equal(enriched[48].indicators?.ready, false);
assert.equal(enriched[49].indicators?.ready, true);

for (const candle of enriched.slice(49)) {
  const ind = candle.indicators!;
  assert.ok(Number.isFinite(ind.ema50));
  assert.ok(Number.isFinite(ind.rsi));
  assert.ok(ind.rsi >= 0 && ind.rsi <= 100);
  assert.ok(Number.isFinite(ind.atr));
}

const result = StrategyOptimizer.backtest(DEFAULT_STRATEGY, enriched, 10_000, {
  feeRatePercent: 0.04,
  slippageBps: 2,
});

assert.equal(result.strategyName, DEFAULT_STRATEGY.name);
assert.ok(result.totalTrades >= 0);
assert.ok(result.maxDrawdown >= 0);
assert.ok(result.feesPaid !== undefined);
assert.ok(result.slippageCost !== undefined);

console.log("Jarvis Finance engine tests passed.");
