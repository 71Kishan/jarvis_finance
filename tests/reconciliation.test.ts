import { describe, expect, test } from "bun:test";
import { canTransitionOrderStatus, isTerminalOrderStatus } from "../src/platform/orderStateMachine";
import {
  mapExecutionReportToBrokerOrder,
  mapOutboundAccountPosition,
} from "../src/server/binanceSpotUserDataStream";

describe("order state machine", () => {
  test("allows forward provider states and rejects terminal regression", () => {
    expect(canTransitionOrderStatus("SUBMITTED", "PARTIALLY_FILLED")).toBe(true);
    expect(canTransitionOrderStatus("PARTIALLY_FILLED", "FILLED")).toBe(true);
    expect(canTransitionOrderStatus("CANCEL_PENDING", "CANCELLED")).toBe(true);
    expect(canTransitionOrderStatus("FILLED", "SUBMITTED")).toBe(false);
    expect(canTransitionOrderStatus("CANCELLED", "PARTIALLY_FILLED")).toBe(false);
    expect(isTerminalOrderStatus("FILLED")).toBe(true);
    expect(isTerminalOrderStatus("SUBMISSION_FAILED")).toBe(true);
  });
});

describe("Binance Spot user-data event mapping", () => {
  test("maps an execution report without converting financial strings to floats", () => {
    const mapped = mapExecutionReportToBrokerOrder(
      {
        e: "executionReport",
        E: 1719467634107,
        s: "BTCUSDT",
        c: "jv_order123456789",
        S: "BUY",
        o: "LIMIT",
        f: "GTC",
        q: "0.01000000",
        p: "100000.12",
        P: "0.00000000",
        x: "TRADE",
        X: "PARTIALLY_FILLED",
        i: 42,
        l: "0.00400000",
        z: "0.00400000",
        L: "99999.90",
        n: "0.00000400",
        N: "BTC",
        T: 1719467634105,
        t: 77,
        I: 62,
        m: true,
        O: 1719467634000,
        Z: "399.99960000",
      },
      "account-1",
    );

    expect(mapped?.clientOrderId).toBe("jv_order123456789");
    expect(mapped?.instrumentId).toBe("BINANCE_SPOT:BINANCE:BTCUSDT");
    expect(mapped?.status).toBe("PARTIALLY_FILLED");
    expect(mapped?.quantity).toBe("0.01000000");
    expect(mapped?.filledQuantity).toBe("0.00400000");
    expect(mapped?.averageFillPrice).toBe("99999.9");
    expect(mapped?.fills?.[0]).toMatchObject({
      externalOrderId: "42",
      externalTradeId: "77",
      quantity: "0.00400000",
      price: "99999.90",
      feeAmount: "0.00000400",
      feeAsset: "BTC",
      liquidity: "MAKER",
    });
  });

  test("maps outbound account-position events using event-time ordering data", () => {
    const balances = mapOutboundAccountPosition(
      {
        e: "outboundAccountPosition",
        E: 1719467634107,
        u: 1719467634105,
        B: [
          { a: "USDT", f: "1000.12345678", l: "2.5" },
          { a: "BTC", f: "0.01000000", l: "0.00050000" },
        ],
      },
      "account-1",
    );

    expect(balances).toEqual([
      {
        accountId: "account-1",
        asset: "USDT",
        free: "1000.12345678",
        locked: "2.5",
        total: "1002.62345678",
        updatedAt: 1719467634105,
      },
      {
        accountId: "account-1",
        asset: "BTC",
        free: "0.01000000",
        locked: "0.00050000",
        total: "0.01050000",
        updatedAt: 1719467634105,
      },
    ]);
  });
});
