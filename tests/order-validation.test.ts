import { describe, expect, test } from "bun:test";
import { validateSpotOrder } from "../src/platform/orderValidation";
import type { Instrument, OrderIntent, WalletBalance } from "../src/platform/types";

const instrument: Instrument = {
  instrumentId: "BINANCE_SPOT:BINANCE:BTCUSDT",
  symbol: "BTC/USDT",
  displaySymbol: "BTC/USDT",
  name: "BTC / USDT",
  assetClass: "CRYPTO",
  venue: "BINANCE",
  venueKind: "EXCHANGE",
  market: "SPOT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  provider: "BINANCE_SPOT",
  providerSymbol: "BTCUSDT",
  status: "ACTIVE",
  tradable: true,
  tickSize: "0.01",
  lotSize: "0.00001",
  minQuantity: "0.00001",
  minNotional: "10",
  updatedAt: Date.now(),
};

const balance = (asset: string, free: string): WalletBalance => ({
  accountId: "account-1",
  asset,
  free,
  locked: "0",
  total: free,
  updatedAt: Date.now(),
});

function order(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    clientOrderId: "jv_test_123456",
    accountId: "account-1",
    instrumentId: instrument.instrumentId,
    side: "BUY",
    type: "LIMIT",
    quantity: "0.001",
    limitPrice: "10000.00",
    timeInForce: "GTC",
    reduceOnly: false,
    requestedAt: Date.now(),
    ...overrides,
  };
}

describe("spot order validation", () => {
  test("accepts an order that meets venue precision, notional and balance rules", () => {
    const result = validateSpotOrder(
      order(),
      instrument,
      [balance("USDT", "100")],
    );
    expect(result.allowed).toBe(true);
    expect(result.estimatedNotional).toBe("10");
  });

  test("rejects a quantity that violates the venue lot size", () => {
    const result = validateSpotOrder(
      order({ quantity: "0.001001" }),
      instrument,
      [balance("USDT", "100")],
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("lot size");
  });

  test("requires trusted bid/ask data for market orders", () => {
    const result = validateSpotOrder(
      order({ type: "MARKET", limitPrice: undefined, timeInForce: undefined }),
      instrument,
      [balance("USDT", "100")],
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("Trusted bid/ask");
  });

  test("rejects insufficient free quote balance without using float arithmetic", () => {
    const result = validateSpotOrder(
      order({ quantity: "0.00001", limitPrice: "1000000.00" }),
      instrument,
      [balance("USDT", "9.999")],
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("Insufficient free quote");
  });
});
