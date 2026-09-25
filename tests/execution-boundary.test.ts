import { describe, expect, test } from "bun:test";
import { PaperBrokerAdapter } from "../src/execution/paperBrokerAdapter";

function createBroker(initial = { USD: 1000, BTC: 1 }) {
  return new PaperBrokerAdapter({
    accountId: "paper-1",
    initialBalances: initial,
    slippageBps: 2,
    feeTierPercent: 0.04,
    resolveInstrument: (instrumentId) =>
      instrumentId === "BINANCE_SPOT:BINANCE:BTCUSD"
        ? { baseAsset: "BTC", quoteAsset: "USD" }
        : null,
    getMarketPrice: (instrumentId) =>
      instrumentId === "BINANCE_SPOT:BINANCE:BTCUSD" ? 100 : null,
  });
}

describe("provider-neutral paper broker adapter", () => {
  test("submits a market buy, creates a fill, and updates balances", async () => {
    const broker = createBroker({ USD: 1000, BTC: 0 });

    const order = await broker.submitOrder({
      clientOrderId: "paper-buy-1",
      accountId: "paper-1",
      instrumentId: "BINANCE_SPOT:BINANCE:BTCUSD",
      side: "BUY",
      type: "MARKET",
      quantity: "2",
      requestedAt: 1,
    });

    expect(order.status).toBe("FILLED");
    expect(order.filledQuantity).toBe("2");
    expect(Number(order.averageFillPrice)).toBeCloseTo(100.02, 8);

    const balances = await broker.getBalances("paper-1");
    const usd = balances.find((b) => b.asset === "USD");
    const btc = balances.find((b) => b.asset === "BTC");

    expect(Number(usd?.free)).toBeCloseTo(799.88, 6);
    expect(Number(btc?.free)).toBeCloseTo(2, 8);

    const fills = broker.getRecordedFills();
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      orderClientId: "paper-buy-1",
      side: "BUY",
      quantity: "2",
      feeAsset: "USD",
    });
  });

  test("replays the exact existing order for an idempotent retry", async () => {
    const broker = createBroker({ USD: 1000, BTC: 0 });
    const intent = {
      clientOrderId: "paper-idempotent",
      accountId: "paper-1",
      instrumentId: "BINANCE_SPOT:BINANCE:BTCUSD",
      side: "BUY" as const,
      type: "MARKET" as const,
      quantity: "1",
      requestedAt: 123,
    };

    const first = await broker.submitOrder(intent);
    const second = await broker.submitOrder(intent);

    expect(second).toEqual(first);
    expect(broker.getRecordedFills()).toHaveLength(1);
  });

  test("rejects an idempotency-key collision with different order parameters", async () => {
    const broker = createBroker({ USD: 1000, BTC: 0 });
    const base = {
      clientOrderId: "paper-conflict",
      accountId: "paper-1",
      instrumentId: "BINANCE_SPOT:BINANCE:BTCUSD",
      side: "BUY" as const,
      type: "MARKET" as const,
      quantity: "1",
      requestedAt: 123,
    };

    await broker.submitOrder(base);

    await expect(
      broker.submitOrder({ ...base, quantity: "2" }),
    ).rejects.toThrow("Idempotency conflict");
  });

  test("reserves and releases a limit order on cancellation", async () => {
    const broker = createBroker({ USD: 1000, BTC: 1 });

    const order = await broker.submitOrder({
      clientOrderId: "paper-limit",
      accountId: "paper-1",
      instrumentId: "BINANCE_SPOT:BINANCE:BTCUSD",
      side: "BUY",
      type: "LIMIT",
      quantity: "2",
      limitPrice: "100",
      timeInForce: "GTC",
      requestedAt: 123,
    });

    expect(order.status).toBe("SUBMITTED");

    const before = await broker.getBalances("paper-1");
    expect(Number(before.find((b) => b.asset === "USD")?.free)).toBeCloseTo(800, 8);
    expect(Number(before.find((b) => b.asset === "USD")?.locked)).toBeCloseTo(200, 8);

    const cancelled = await broker.cancelOrder("paper-1", "paper-limit");
    expect(cancelled.status).toBe("CANCELLED");

    const after = await broker.getBalances("paper-1");
    expect(Number(after.find((b) => b.asset === "USD")?.free)).toBeCloseTo(1000, 8);
    expect(Number(after.find((b) => b.asset === "USD")?.locked)).toBeCloseTo(0, 8);
  });

  test("does not submit a market order without trusted market price", async () => {
    const broker = new PaperBrokerAdapter({
      accountId: "paper-1",
      initialBalances: { USD: 1000 },
      resolveInstrument: () => ({ baseAsset: "BTC", quoteAsset: "USD" }),
      getMarketPrice: () => null,
    });

    const order = await broker.submitOrder({
      clientOrderId: "paper-no-price",
      accountId: "paper-1",
      instrumentId: "BINANCE_SPOT:BINANCE:BTCUSD",
      side: "BUY",
      type: "MARKET",
      quantity: "1",
      requestedAt: 123,
    });

    expect(order.status).toBe("REJECTED");
    expect(broker.getRecordedFills()).toHaveLength(0);
  });
});
