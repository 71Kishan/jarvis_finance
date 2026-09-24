import { describe, expect, test } from "bun:test";
import { AutonomousShadowRuntime } from "../src/server/shadowRuntime";
import type { PlatformRepository, ShadowRuntimeRecord } from "../src/platform/platformRepository";
import type { StrategyConfig } from "../src/types/trading";
import { DEFAULT_STRATEGY } from "../src/engine/tradingEngine";

function makeGateway() {
  const candles = Array.from({ length: 80 }, (_, index) => ({
    timestamp: 1_760_000_000_000 + index * 60_000,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1000,
  }));

  return {
    getSnapshot() {
      return {
        gateway: { state: "READY", stale: false },
        candles,
        ticker: {
          bid: 99.99,
          ask: 100.01,
          lastUpdated: Date.now(),
        },
      };
    },
  };
}

describe("server-owned shadow runtime", () => {
  test("processes only trusted completed candles and persists state without a provider order path", async () => {
    const saved: any[] = [];
    const storedRepository = {
      isPersistenceReady: () => true,
      loadShadowRuntime: async () => null,
      saveShadowRuntime: async (input: any) => {
        saved.push(input);
        return {
          id: "shadow-1",
          userId: input.userId,
          strategyId: input.strategyId,
          strategyVersion: input.strategyVersion,
          symbol: input.symbol,
          status: input.status,
          runtimeState: input.runtimeState,
          lastProcessedCandleAt: input.lastProcessedCandleAt,
          startedAt: input.startedAt,
          updatedAt: Date.now(),
        } satisfies ShadowRuntimeRecord;
      },
    } as unknown as PlatformRepository;

    const runtime = new AutonomousShadowRuntime(
      makeGateway() as any,
      storedRepository,
      {
        symbol: "BTC/USD",
        strategy: DEFAULT_STRATEGY satisfies StrategyConfig,
        pollIntervalMs: 10_000,
      },
    );

    await runtime.start("user-1");
    const running = runtime.getStatus();

    expect(running.status).toBe("RUNNING");
    expect(running.lastProcessedCandleAt).toBe(1_760_004_740_000);
    expect(saved.length).toBeGreaterThan(0);
    expect(running.activeTrade).toBeNull();

    await runtime.stop();
    expect(runtime.getStatus().status).toBe("STOPPED");
  });
});
