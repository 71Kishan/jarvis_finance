import { afterEach, describe, expect, test } from "bun:test";
import {
  BinanceProviderError,
  BinanceSpotAccountAdapter,
} from "../src/platform/binanceSpotAccountAdapter";
import type { OrderIntent } from "../src/platform/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockBinanceFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string }> = [];
  let index = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || "GET");
    calls.push({ url, method });

    const response = responses[Math.min(index++, responses.length - 1)];
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
}

const credentials = {
  apiKey: "test-key",
  apiSecret: "test-secret",
  baseUrl: "https://testnet.binance.vision",
  accountId: "binance-testnet-local",
  testnetOnly: true,
  enableOrderSubmission: true,
};

const limitOrder: OrderIntent = {
  clientOrderId: "jrv_1234567890abcdef12345678901234",
  accountId: "binance-testnet-local",
  instrumentId: "BINANCE_SPOT:BINANCE:BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  quantity: "0.001",
  limitPrice: "50000.00",
  timeInForce: "GTC",
  requestedAt: Date.now(),
};

describe("Binance Spot Testnet execution adapter", () => {
  test("keeps order submission disabled unless the provider gate is enabled", async () => {
    const adapter = new BinanceSpotAccountAdapter({
      ...credentials,
      enableOrderSubmission: false,
    });

    await expect(adapter.submitOrder(limitOrder)).rejects.toThrow("order submission is disabled by configuration");
  });

  test("submits a mapped testnet limit order with the deterministic client id", async () => {
    const calls = mockBinanceFetch([
      { body: { serverTime: Date.now() } },
      {
        body: {
          symbol: "BTCUSDT",
          orderId: 123,
          clientOrderId: limitOrder.clientOrderId,
          price: "50000.00",
          origQty: "0.001",
          executedQty: "0",
          cummulativeQuoteQty: "0",
          status: "NEW",
          timeInForce: "GTC",
          type: "LIMIT",
          side: "BUY",
          time: Date.now(),
          updateTime: Date.now(),
        },
      },
    ]);

    const adapter = new BinanceSpotAccountAdapter(credentials);
    const result = await adapter.submitOrder(limitOrder);

    expect(result.externalOrderId).toBe("123");
    expect(result.status).toBe("SUBMITTED");
    expect(result.clientOrderId).toBe(limitOrder.clientOrderId);
    expect(calls[1]?.method).toBe("POST");

    const query = new URL(calls[1]!.url).searchParams;
    expect(query.get("symbol")).toBe("BTCUSDT");
    expect(query.get("side")).toBe("BUY");
    expect(query.get("type")).toBe("LIMIT");
    expect(query.get("quantity")).toBe("0.001");
    expect(query.get("price")).toBe("50000.00");
    expect(query.get("newClientOrderId")).toBe(limitOrder.clientOrderId);
    expect(query.get("signature")).toBeTruthy();
  });

  test("retrieves provider fills for a reconciled order", async () => {
    const calls = mockBinanceFetch([
      { body: { serverTime: Date.now() } },
      {
        body: [{
          symbol: "BTCUSDT",
          id: 77,
          orderId: 123,
          price: "50100.00",
          qty: "0.001",
          quoteQty: "50.10",
          commission: "0.000001",
          commissionAsset: "BTC",
          time: Date.now(),
          isBuyer: true,
          isMaker: false,
        }],
      },
    ]);

    const adapter = new BinanceSpotAccountAdapter(credentials);
    const fills = await adapter.getFills("binance-testnet-local", "BTCUSDT", "123");

    expect(fills).toHaveLength(1);
    expect(fills[0]?.externalOrderId).toBe("123");
    expect(fills[0]?.externalTradeId).toBe("77");
    expect(fills[0]?.price).toBe("50100.00");
    expect(fills[0]?.quantity).toBe("0.001");
    expect(calls[1]?.method).toBe("GET");
    expect(new URL(calls[1]!.url).searchParams.get("orderId")).toBe("123");
  });

  test("classifies provider rejection errors without converting network ambiguity into rejection", async () => {
    const calls = mockBinanceFetch([
      { body: { serverTime: Date.now() } },
      { status: 400, body: { code: -2019, msg: "Margin is insufficient." } },
    ]);

    const adapter = new BinanceSpotAccountAdapter(credentials);

    let caught: unknown;
    try {
      await adapter.submitOrder(limitOrder);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BinanceProviderError);
    expect((caught as BinanceProviderError).kind).toBe("INSUFFICIENT_BALANCE");
    expect(calls[1]?.method).toBe("POST");
  });
});
