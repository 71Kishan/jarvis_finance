import { describe, expect, test } from "bun:test";
import { deriveClientOrderId, evaluateSandboxOrderPolicy, fingerprintOrderIntent, isSandboxOrderSubmissionEnabled } from "../src/server/sandboxOrderPolicy";
import type { AccountConnection, Instrument, OrderIntent, WalletBalance } from "../src/platform/types";

const account: AccountConnection = {
  id: "acct-1",
  provider: "BINANCE_SPOT_TESTNET",
  accountType: "EXCHANGE",
  label: "Binance Spot Testnet",
  externalAccountId: "binance-testnet-local",
  status: "CONNECTED",
  permissions: ["READ", "TRADE"],
  updatedAt: 1,
  createdAt: 1,
};

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
  lotSize: "0.00001",
  minQuantity: "0.00001",
  tickSize: "0.01",
  minNotional: "5",
  updatedAt: 1,
};

const balances: WalletBalance[] = [{
  accountId: "acct-1",
  asset: "USDT",
  free: "1000",
  locked: "0",
  total: "1000",
  updatedAt: 1,
}];

function order(): OrderIntent {
  return {
    clientOrderId: "ignored-by-server",
    accountId: "acct-1",
    instrumentId: instrument.instrumentId,
    side: "BUY",
    type: "LIMIT",
    quantity: "0.001",
    limitPrice: "50000",
    timeInForce: "GTC",
    reduceOnly: false,
    requestedAt: 1,
  };
}

describe("sandbox order policy", () => {
  test("idempotency produces a stable server-owned client order id", () => {
    expect(deriveClientOrderId("u1", "a1", "retry-7")).toBe(deriveClientOrderId("u1", "a1", "retry-7"));
    expect(deriveClientOrderId("u1", "a1", "retry-7").length).toBeLessThanOrEqual(36);
    expect(deriveClientOrderId("u1", "a1", "retry-7")).not.toBe(deriveClientOrderId("u1", "a1", "retry-8"));
  });

  test("fingerprint changes when order intent changes", () => {
    const first = fingerprintOrderIntent(order());
    const changed = { ...order(), quantity: "0.002" };
    expect(fingerprintOrderIntent(order())).toBe(first);
    expect(fingerprintOrderIntent(changed)).not.toBe(first);
  });

  test("policy rejects a connection that also has withdrawal permission", () => {
    const result = evaluateSandboxOrderPolicy({
      order: order(),
      account: { ...account, permissions: ["READ", "TRADE", "WITHDRAW"] },
      instrument,
      balances,
      openOrderCount: 0,
      quote: { bid: "49999", ask: "50001", updatedAt: Date.now() },
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("withdrawal permission"))).toBe(true);
  });

  test("feature gate requires both sandbox and testnet order flags", () => {
    expect(isSandboxOrderSubmissionEnabled({
      JARVIS_SANDBOX_ORDER_SUBMISSION_ENABLED: "true",
      JARVIS_BINANCE_TESTNET_ENABLE_ORDERS: "true",
      JARVIS_BINANCE_TESTNET_ONLY: "true",
    })).toBe(true);
    expect(isSandboxOrderSubmissionEnabled({
      JARVIS_SANDBOX_ORDER_SUBMISSION_ENABLED: "true",
      JARVIS_BINANCE_TESTNET_ENABLE_ORDERS: "false",
      JARVIS_BINANCE_TESTNET_ONLY: "true",
    })).toBe(false);
  });
});
