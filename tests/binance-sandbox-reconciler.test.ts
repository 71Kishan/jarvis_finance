import { afterEach, describe, expect, test } from "bun:test";
import { BinanceProviderError } from "../src/platform/binanceSpotAccountAdapter";
import { BinanceSandboxReconciler } from "../src/server/binanceSandboxReconciler";
import type { BrokerOrder, Fill } from "../src/platform/types";

afterEach(() => {
  // Keep timers from leaking if a test fails before explicit cleanup.
});

function order(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    clientOrderId: "jrv_test_order",
    accountId: "acct-1",
    instrumentId: "BINANCE_SPOT:BINANCE:BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: "0.001",
    limitPrice: "50000",
    timeInForce: "GTC",
    reduceOnly: false,
    requestedAt: 1,
    status: "SUBMITTED",
    filledQuantity: "0",
    updatedAt: 1,
    ...overrides,
  };
}

function fill(overrides: Partial<Fill> = {}): Fill {
  return {
    id: "binance-testnet:BTCUSDT:77",
    accountId: "binance-testnet-local",
    orderClientId: "jrv_test_order",
    externalOrderId: "123",
    externalTradeId: "77",
    instrumentId: "BINANCE_SPOT:BINANCE:BTCUSDT",
    side: "BUY",
    quantity: "0.001",
    price: "50100",
    feeAmount: "0.000001",
    feeAsset: "BTC",
    liquidity: "TAKER",
    executedAt: 1000,
    ...overrides,
  };
}

function makeHarness() {
  const current = new Map<string, BrokerOrder>([["jrv_test_order", order()]]);
  const storedFills: Fill[] = [];
  const transitions: Array<{ status: string; reason?: string }> = [];

  const store = {
    async listActiveOrders() {
      const currentOrder = current.get("jrv_test_order")!;
      return [{
        userId: "user-1",
        externalAccountId: "binance-testnet-local",
        order: currentOrder,
      }];
    },
    async markStatus(_userId: string, clientOrderId: string, status: BrokerOrder["status"], options: any = {}) {
      const existing = current.get(clientOrderId);
      if (!existing) return null;

      const next = {
        ...existing,
        status,
        externalOrderId: options.externalOrderId ?? existing.externalOrderId,
        filledQuantity: options.filledQuantity ?? existing.filledQuantity,
        averageFillPrice: options.averageFillPrice ?? existing.averageFillPrice,
        submittedAt: options.submittedAt ?? existing.submittedAt,
        updatedAt: Date.now(),
      };
      current.set(clientOrderId, next);
      transitions.push({ status, reason: options.failureReason });
      return next;
    },
    async recordFill(_userId: string, providerFill: Fill) {
      if (storedFills.some((item) =>
        item.accountId === providerFill.accountId &&
        item.externalOrderId === providerFill.externalOrderId &&
        item.externalTradeId === providerFill.externalTradeId
      )) {
        return { inserted: false, fill: null };
      }
      storedFills.push(providerFill);
      return { inserted: true, fill: providerFill };
    },
  } as any;

  return { current, storedFills, transitions, store };
}

describe("Binance sandbox reconciliation", () => {
  test("reconciles a filled provider order and imports its fills", async () => {
    const harness = makeHarness();

    const adapter = {
      async getOrderBySymbol() {
        return order({
          externalOrderId: "123",
          status: "FILLED",
          filledQuantity: "0.001",
          averageFillPrice: "50100",
          submittedAt: 500,
        });
      },
      async getFills() {
        return [fill()];
      },
    } as any;

    const reconciler = new BinanceSandboxReconciler(harness.store, adapter, 5_000);
    const status = await reconciler.runOnce();

    expect(status.lastSuccessAt).toBeNumber();
    expect(status.lastProcessedCount).toBe(1);
    expect(harness.current.get("jrv_test_order")?.status).toBe("FILLED");
    expect(harness.current.get("jrv_test_order")?.externalOrderId).toBe("123");
    expect(harness.current.get("jrv_test_order")?.filledQuantity).toBe("0.001");
    expect(harness.storedFills).toHaveLength(1);
  });

  test("is idempotent when the provider returns the same fill on repeated reconciliation", async () => {
    const harness = makeHarness();

    const adapter = {
      async getOrderBySymbol() {
        return order({
          externalOrderId: "123",
          status: "FILLED",
          filledQuantity: "0.001",
          averageFillPrice: "50100",
        });
      },
      async getFills() {
        return [fill()];
      },
    } as any;

    const reconciler = new BinanceSandboxReconciler(harness.store, adapter, 5_000);
    await reconciler.runOnce();
    await reconciler.runOnce();

    expect(harness.storedFills).toHaveLength(1);
  });

  test("moves an order with a confirmed provider-unknown response into reconciliation review", async () => {
    const harness = makeHarness();

    const adapter = {
      async getOrderBySymbol() {
        throw new BinanceProviderError("Binance order does not exist.", "UNKNOWN_ORDER", { code: -2013 });
      },
      async getFills() {
        return [];
      },
    } as any;

    const reconciler = new BinanceSandboxReconciler(harness.store, adapter, 5_000);
    await reconciler.runOnce();

    expect(harness.current.get("jrv_test_order")?.status).toBe("UNKNOWN_RECONCILIATION");
    expect(harness.transitions.at(-1)?.reason).toContain("does not exist");
  });

  test("does not rewrite local state when the provider response is network-ambiguous", async () => {
    const harness = makeHarness();

    const adapter = {
      async getOrderBySymbol() {
        throw new BinanceProviderError("Binance authenticated request timed out.", "NETWORK");
      },
      async getFills() {
        return [];
      },
    } as any;

    const reconciler = new BinanceSandboxReconciler(harness.store, adapter, 5_000);
    const status = await reconciler.runOnce();

    expect(harness.current.get("jrv_test_order")?.status).toBe("SUBMITTED");
    expect(status.lastErrorAt).toBeNumber();
    expect(status.lastError).toContain("timed out");
  });
});
