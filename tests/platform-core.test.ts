import { describe, expect, test } from "bun:test";
import { InstrumentRegistry, normalizeBinanceSpotExchangeInfo } from "../src/platform/instrumentRegistry";

describe("platform instrument registry", () => {
  test("normalizes Binance spot trading rules", () => {
    const instruments = normalizeBinanceSpotExchangeInfo({
      symbols: [{
        symbol: "BTCUSDT",
        status: "TRADING",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        baseAssetPrecision: 8,
        quoteAssetPrecision: 8,
        isSpotTradingAllowed: true,
        filters: [
          { filterType: "PRICE_FILTER", tickSize: "0.01000000" },
          { filterType: "LOT_SIZE", minQty: "0.00001000", maxQty: "9000", stepSize: "0.00001000" },
          { filterType: "MIN_NOTIONAL", minNotional: "5.00" }
        ]
      }]
    }, 123);

    expect(instruments).toHaveLength(1);
    expect(instruments[0]).toMatchObject({
      instrumentId: "BINANCE_SPOT:BINANCE:BTCUSDT",
      symbol: "BTC/USDT",
      providerSymbol: "BTCUSDT",
      tradable: true,
      tickSize: "0.01000000",
      lotSize: "0.00001000",
      minQuantity: "0.00001000",
      minNotional: "5.00",
      shortable: false,
      updatedAt: 123
    });
  });

  test("prioritizes exact symbols in search", () => {
    const registry = new InstrumentRegistry();
    registry.replace(normalizeBinanceSpotExchangeInfo({
      symbols: [
        { symbol: "ETHUSDT", status: "TRADING", baseAsset: "ETH", quoteAsset: "USDT" },
        { symbol: "ETHBTC", status: "TRADING", baseAsset: "ETH", quoteAsset: "BTC" },
        { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" }
      ]
    }, 1));

    expect(registry.search("ETHUSDT", { tradableOnly: true })[0]?.providerSymbol).toBe("ETHUSDT");
    expect(registry.search("", { quoteAsset: "USDT", tradableOnly: true })).toHaveLength(2);
  });

  test("keeps non-trading instruments in inventory but filters them from tradable lists", () => {
    const registry = new InstrumentRegistry();
    registry.replace(normalizeBinanceSpotExchangeInfo({
      symbols: [{ symbol: "BADUSDT", status: "BREAK", baseAsset: "BAD", quoteAsset: "USDT" }]
    }, 1));

    expect(registry.list()).toHaveLength(1);
    expect(registry.list({ tradableOnly: true })).toHaveLength(0);
  });
});


describe("binance display-bar contract", () => {
  test("closed candle domain remains separate from the live forming bar", async () => {
    const { BinanceMarketDataService } = await import("../src/server/binanceMarketData");
    const gateway = new BinanceMarketDataService({ "BTC/USD": "BTCUSDT" });
    const anyGateway = gateway as any;

    anyGateway.handleKline({
        s: "BTCUSDT",
        x: false,
        t: 1_760_000_000_000,
        T: 1_760_000_059_999,
        o: "100",
        h: "101",
        l: "99",
        c: "100.5",
        v: "12",
    });

    expect(anyGateway.candles.get("BTC/USD") ?? []).toHaveLength(0);
    expect(anyGateway.formingCandles.get("BTC/USD")?.close).toBe(100.5);

    anyGateway.handleKline({
        s: "BTCUSDT",
        x: true,
        t: 1_760_000_000_000,
        T: 1_760_000_059_999,
        o: "100",
        h: "101.5",
        l: "99",
        c: "101",
        v: "15",
    });

    expect(anyGateway.candles.get("BTC/USD")).toHaveLength(1);
    expect(anyGateway.formingCandles.get("BTC/USD")).toBeUndefined();
  });
});
