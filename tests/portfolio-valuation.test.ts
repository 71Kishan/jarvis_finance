import { describe, expect, test } from "bun:test";
import { valueSpotBalances } from "../src/platform/portfolioValuation";
import type { WalletBalance } from "../src/platform/types";

const balance = (asset: string, total: string): WalletBalance => ({
  accountId: "account-1",
  asset,
  free: total,
  locked: "0",
  total,
  updatedAt: 1,
});

describe("spot portfolio valuation", () => {
  test("values base cash and directly marked holdings using exact decimals", () => {
    const result = valueSpotBalances(
      [
        balance("USDT", "1000.12345678"),
        balance("BTC", "0.01000000"),
      ],
      "USDT",
      [
        {
          asset: "BTC",
          priceInBaseCurrency: "100000.12",
          sourceInstrumentId: "BINANCE_SPOT:BINANCE:BTCUSDT",
          updatedAt: 10,
        },
      ],
      10,
    );

    expect(result.cashValue).toBe("1000.12345678");
    expect(result.holdingsValue).toBe("1000.0012");
    expect(result.totalEquity).toBe("2000.12465678");
    expect(result.complete).toBe(true);
    expect(result.unpricedAssets).toEqual([]);
  });

  test("does not invent a mark for an unpriced asset", () => {
    const result = valueSpotBalances(
      [balance("USDT", "100"), balance("XYZ", "5")],
      "USDT",
      [],
      10,
    );

    expect(result.totalEquity).toBe("100");
    expect(result.complete).toBe(false);
    expect(result.unpricedAssets).toEqual(["XYZ"]);
  });
});
