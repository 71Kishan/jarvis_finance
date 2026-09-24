import type { Candle } from "../types/trading";

export type BinanceResearchInterval = "15m" | "30m" | "1h" | "2h" | "4h" | "1d";

interface BinanceKlineRow {
  0: number;
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
  6: number;
}

export class BinanceHistoricalDataService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    baseUrl = process.env.JARVIS_BINANCE_MARKET_REST_BASE_URL || "https://api.binance.com",
    timeoutMs = 15_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = Math.max(2_000, timeoutMs);
  }

  public async fetchCompletedCandles(
    providerSymbol: string,
    interval: BinanceResearchInterval = "1h",
    limit = 1800,
  ): Promise<Candle[]> {
    const symbol = String(providerSymbol || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{3,30}$/.test(symbol)) {
      throw new Error("Invalid Binance research symbol.");
    }

    const requested = Math.min(2000, Math.max(120, Math.floor(limit)));
    const rows: BinanceKlineRow[] = [];

    // Binance caps each kline response. Pull backwards in bounded pages so the
    // research service can obtain enough calendar history for walk-forward tests.
    let endTime: number | undefined;
    while (rows.length < requested) {
      const pageLimit = Math.min(1000, requested - rows.length);
      const params = new URLSearchParams({
        symbol,
        interval,
        limit: String(pageLimit),
      });
      if (endTime !== undefined) params.set("endTime", String(endTime));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(
          this.baseUrl + "/api/v3/klines?" + params.toString(),
          { headers: { Accept: "application/json" }, signal: controller.signal },
        );

        const body = await response.text();
        if (!response.ok) {
          throw new Error("Binance historical data HTTP " + response.status + ": " + body.slice(0, 240));
        }

        const parsed = JSON.parse(body);
        if (!Array.isArray(parsed)) throw new Error("Binance historical data returned an unexpected payload.");

        const page = parsed as BinanceKlineRow[];
        if (!page.length) break;

        // Walk backwards by the first open time from this page. Keep pages
        // de-duplicated and leave the result in chronological order.
        for (let i = page.length - 1; i >= 0; i -= 1) {
          const row = page[i];
          if (Number.isFinite(Number(row[0]))) rows.push(row);
        }

        const firstOpenTime = Number(page[0]?.[0]);
        if (!Number.isFinite(firstOpenTime) || firstOpenTime <= 0) break;

        endTime = firstOpenTime - 1;
        if (page.length < pageLimit) break;
      } finally {
        clearTimeout(timer);
      }
    }

    const unique = new Map<number, Candle>();
    for (const row of rows) {
      const timestamp = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      const closeTime = Number(row[6]);

      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(closeTime) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        !Number.isFinite(volume) ||
        high < low ||
        closeTime >= Date.now()
      ) {
        continue;
      }

      unique.set(timestamp, {
        timestamp,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    return Array.from(unique.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-requested);
  }
}
