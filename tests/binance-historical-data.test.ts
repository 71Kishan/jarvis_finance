import { describe, expect, test } from "bun:test";
import { BinanceHistoricalDataService } from "../src/server/binanceHistoricalData";

describe("Binance historical research data", () => {
  test("fetches backward in bounded pages and excludes the current incomplete candle", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      const u = new URL(url);
      const endTime = u.searchParams.get("endTime");
      const page = endTime
        ? [[4, "103", "105", "102", "104", "10", 4_999]]
        : [
            ...Array.from({ length: 120 }, (_, index) => [
              index + 5,
              "104",
              "106",
              "103",
              "105",
              "11",
              index === 119 ? Date.now() + 60_000 : index + 5_999,
            ]),
          ];

      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const service = new BinanceHistoricalDataService("https://example.test");
      const candles = await service.fetchCompletedCandles("BTCUSDT", "1h", 150);

      expect(calls.length).toBe(2);
      expect(candles[0]?.timestamp).toBe(4);
      expect(candles[candles.length - 1]?.timestamp).toBe(123);
      expect(candles.length).toBe(120);
      expect(candles.every((candle) => candle.close === 105 || candle.close === 104)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
