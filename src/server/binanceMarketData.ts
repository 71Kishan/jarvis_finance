import WebSocket from "ws";
import { Candle, LiveExchangeTicker } from "../types/trading";

export type BinanceGatewayState =
  | "STARTING"
  | "CONNECTING"
  | "READY"
  | "RECONNECTING"
  | "STOPPED";

export interface BinanceGatewayHealth {
  state: BinanceGatewayState;
  connected: boolean;
  reconnectAttempts: number;
  lastMessageAt: number | null;
  lastClosedCandleAt: number | null;
  symbolsTracked: number;
}

const SPOT_STREAM_URL = "wss://stream.binance.com:9443/stream";
const REST_BASE_URL = "https://api.binance.com";
const BOOTSTRAP_LIMIT = 100;
const MAX_CANDLES_PER_SYMBOL = 500;
const STALE_AFTER_MS = 15_000;

interface StoredTicker {
  ticker: LiveExchangeTicker;
  lastQuoteAt: number;
}

interface StoredMiniTicker {
  providerSymbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  change24hPercent: number;
  lastUpdated: number;
}

export class BinanceMarketDataService {
  private readonly symbolMap: Record<string, string>;
  private readonly candles = new Map<string, Candle[]>();
  private readonly tickers = new Map<string, StoredTicker>();
  private readonly miniTickers = new Map<string, StoredMiniTicker>();
  private readonly subscribedStreams = new Set<string>();
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private state: BinanceGatewayState = "STARTING";
  private reconnectAttempts = 0;
  private lastMessageAt: number | null = null;
  private lastClosedCandleAt: number | null = null;
  private subscriptionRequestId = 0;
  private static readonly MAX_STREAMS_PER_CONNECTION = 1024;

  constructor(symbolMap: Record<string, string>) {
    this.symbolMap = { ...symbolMap };
  }

  public async start(): Promise<void> {
    if (this.state === "STOPPED") return;

    try {
      await this.bootstrapCandles();
    } catch (error: any) {
      console.warn(
        "Binance market bootstrap failed; websocket will retry independently:",
        error?.message || error,
      );
    }

    this.connect();
  }

  public stop(): void {
    this.stopped = true;
    this.state = "STOPPED";
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      this.socket?.close();
    } catch {}
    this.socket = null;
  }

  public getSnapshot(symbol: string, limit = 80) {
    const mapped = this.symbolMap[symbol];
    if (!mapped) return null;

    const candles = (this.candles.get(symbol) || []).slice(-Math.max(1, Math.min(limit, MAX_CANDLES_PER_SYMBOL)));
    const stored = this.tickers.get(symbol);

    if (!candles.length || !stored) return null;

    return {
      candles,
      ticker: stored.ticker,
      gateway: {
        state: this.state,
        stale: Date.now() - stored.lastQuoteAt > STALE_AFTER_MS,
        lastMessageAt: this.lastMessageAt,
        lastClosedCandleAt: this.lastClosedCandleAt,
      },
    };
  }

  public getTicker(symbol: string): LiveExchangeTicker | null {
    return this.tickers.get(symbol)?.ticker || null;
  }

  public getMiniTicker(providerSymbol: string): StoredMiniTicker | null {
    const ticker = this.miniTickers.get(providerSymbol.toUpperCase());
    return ticker ? { ...ticker } : null;
  }

  public async ensureSymbol(symbol: string, exchangeSymbol: string): Promise<void> {
    const appSymbol = String(symbol || "").trim();
    const providerSymbol = String(exchangeSymbol || "").trim().toUpperCase();
    if (!appSymbol || !providerSymbol) throw new Error("Both application and provider symbols are required.");

    const previous = this.symbolMap[appSymbol];
    this.symbolMap[appSymbol] = providerSymbol;

    if (previous !== providerSymbol) {
      this.candles.delete(appSymbol);
      this.tickers.delete(appSymbol);
    }

    await this.bootstrapSymbol(appSymbol, providerSymbol);
    this.subscribeStreams(this.getSymbolStreams(providerSymbol));
  }

  public getHealth(): BinanceGatewayHealth {
    return {
      state: this.state,
      connected: this.socket?.readyState === WebSocket.OPEN,
      reconnectAttempts: this.reconnectAttempts,
      lastMessageAt: this.lastMessageAt,
      lastClosedCandleAt: this.lastClosedCandleAt,
      symbolsTracked: Object.keys(this.symbolMap).length,
    };
  }

  private getSymbolStreams(exchangeSymbol: string): string[] {
    const symbol = exchangeSymbol.toLowerCase();
    return [
      symbol + "@kline_1m",
      symbol + "@bookTicker",
      symbol + "@miniTicker",
    ];
  }

  private getStreams(): string[] {
    const streams = ["!miniTicker@arr"];
    for (const exchangeSymbol of Object.values(this.symbolMap)) {
      streams.push(...this.getSymbolStreams(exchangeSymbol));
    }
    return Array.from(new Set(streams));
  }

  private connect(): void {
    if (this.stopped) return;

    this.state = this.reconnectAttempts > 0 ? "RECONNECTING" : "CONNECTING";
    const url = SPOT_STREAM_URL;
    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket || this.stopped) return;
      this.reconnectAttempts = 0;
      this.state = "READY";
      this.subscribeStreams(this.getStreams());
      // A connection can be interrupted between the last bootstrap and open.
      // Refresh candles after every reconnect so the decision stream can recover
      // bars missed during the outage instead of silently continuing with a gap.
      void this.bootstrapCandles().catch((error: any) => {
        console.warn("Binance post-connect candle refresh failed:", error?.message || error);
      });
    });

    socket.on("message", (raw) => {
      if (this.socket !== socket || this.stopped) return;
      this.lastMessageAt = Date.now();

      try {
        const envelope = JSON.parse(raw.toString());
        const payload = envelope?.data ?? envelope;
        this.handlePayload(payload);
      } catch (error) {
        console.warn("Ignoring malformed Binance websocket payload:", error);
      }
    });

    socket.on("error", (error) => {
      if (this.socket !== socket || this.stopped) return;
      console.warn("Binance websocket error:", error?.message || error);
    });

    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    this.state = "RECONNECTING";
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(5, this.reconnectAttempts - 1));

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handlePayload(payload: any): void {
    if (Array.isArray(payload)) {
      for (const item of payload) this.handleMiniTicker(item);
      return;
    }
    if (!payload || typeof payload !== "object") return;

    if (payload.e === "kline" && payload.k) {
      this.handleKline(payload.k);
      return;
    }

    if (payload.e === "bookTicker") {
      this.handleBookTicker(payload);
      return;
    }

    if (payload.e === "24hrMiniTicker") {
      this.handleMiniTicker(payload);
    }
  }

  private handleKline(k: any): void {
    if (!k?.x) return; // Only completed candles may enter the decision dataset.

    const exchangeSymbol = String(k.s || "").toUpperCase();
    const symbol = this.toAppSymbol(exchangeSymbol);
    if (!symbol) return;

    const candle: Candle = {
      timestamp: Number(k.t),
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),
      volume: Number(k.v),
    };

    if (![candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)) {
      return;
    }

    const series = this.candles.get(symbol) || [];
    const last = series[series.length - 1];
    if (last?.timestamp === candle.timestamp) {
      series[series.length - 1] = candle;
    } else if (!last || candle.timestamp > last.timestamp) {
      series.push(candle);
    }

    this.candles.set(symbol, series.slice(-MAX_CANDLES_PER_SYMBOL));
    this.lastClosedCandleAt = Math.max(this.lastClosedCandleAt || 0, Number(k.T) || candle.timestamp);
  }

  private handleBookTicker(payload: any): void {
    const exchangeSymbol = String(payload?.s || "").toUpperCase();
    const symbol = this.toAppSymbol(exchangeSymbol);
    if (!symbol) return;

    const bid = Number(payload?.b);
    const ask = Number(payload?.a);
    if (!(bid > 0) || !(ask > 0)) return;

    this.mergeTicker(symbol, {
      bid,
      ask,
      price: Number.isFinite(Number(this.tickers.get(symbol)?.ticker.price))
        ? Number(this.tickers.get(symbol)!.ticker.price)
        : (bid + ask) / 2,
      lastUpdated: Date.now(),
    });
  }

  private handleMiniTicker(payload: any): void {
    const exchangeSymbol = String(payload?.s || "").toUpperCase();
    if (!exchangeSymbol) return;

    const price = Number(payload?.c);
    const open = Number(payload?.o);
    const high = Number(payload?.h);
    const low = Number(payload?.l);
    const volume = Number(payload?.v);
    if (!(price > 0) || !(open > 0)) return;

    const lastUpdated = Number(payload?.E) || Date.now();
    this.miniTickers.set(exchangeSymbol, {
      providerSymbol: exchangeSymbol,
      price,
      open,
      high: Number.isFinite(high) ? high : price,
      low: Number.isFinite(low) ? low : price,
      volume: Number.isFinite(volume) ? volume : 0,
      change24hPercent: (price / open - 1) * 100,
      lastUpdated,
    });

    const symbol = this.toAppSymbol(exchangeSymbol);
    if (!symbol) return;

    this.mergeTicker(symbol, {
      price,
      high24h: Number.isFinite(high) ? high : price,
      low24h: Number.isFinite(low) ? low : price,
      volume24h: Number.isFinite(volume) ? volume : 0,
      change24hPercent: (price / open - 1) * 100,
      lastUpdated,
    });
  }

  private mergeTicker(
    symbol: string,
    patch: Partial<LiveExchangeTicker>,
  ): void {
    const current = this.tickers.get(symbol)?.ticker;
    const now = Number(patch.lastUpdated) || Date.now();
    const bid = Number.isFinite(patch.bid) ? Number(patch.bid) : Number(current?.bid);
    const ask = Number.isFinite(patch.ask) ? Number(patch.ask) : Number(current?.ask);
    const price = Number.isFinite(patch.price)
      ? Number(patch.price)
      : (bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(current?.price));

    if (!(price > 0) || !(bid > 0) || !(ask > 0)) return;

    const ticker: LiveExchangeTicker = {
      symbol,
      price,
      bid,
      ask,
      high24h: Number.isFinite(patch.high24h) ? Number(patch.high24h) : Number(current?.high24h) || price,
      low24h: Number.isFinite(patch.low24h) ? Number(patch.low24h) : Number(current?.low24h) || price,
      volume24h: Number.isFinite(patch.volume24h) ? Number(patch.volume24h) : Number(current?.volume24h) || 0,
      change24hPercent: Number.isFinite(patch.change24hPercent)
        ? Number(patch.change24hPercent)
        : Number(current?.change24hPercent) || 0,
      lastUpdated: now,
      source: "BINANCE",
      quoteQuality: "BID_ASK",
    };

    this.tickers.set(symbol, { ticker, lastQuoteAt: now });
  }

  private async bootstrapCandles(): Promise<void> {
    await Promise.all(
      Object.entries(this.symbolMap).map(async ([symbol, exchangeSymbol]) => {
        await this.bootstrapSymbol(symbol, exchangeSymbol);
      }),
    );
  }

  private async bootstrapSymbol(symbol: string, exchangeSymbol: string): Promise<void> {
    try {
      const endpoint = REST_BASE_URL + "/api/v3/klines?symbol=" + encodeURIComponent(exchangeSymbol) + "&interval=1m&limit=" + BOOTSTRAP_LIMIT;
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json", "User-Agent": "JarvisFinance/1.0" },
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const rows: any = await response.json();
      if (!Array.isArray(rows)) throw new Error("Invalid kline response.");

      const now = Date.now();
      const completed = rows
        .filter((row: any[]) => Array.isArray(row) && Number(row[6]) <= now)
        .map((row: any[]) => ({
          timestamp: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        }))
        .filter((row: Candle) =>
          [row.timestamp, row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite),
        );

      if (completed.length) {
        this.candles.set(symbol, completed.slice(-MAX_CANDLES_PER_SYMBOL));
        this.lastClosedCandleAt = Math.max(
          this.lastClosedCandleAt || 0,
          completed[completed.length - 1].timestamp + 59_999,
        );
      }
    } catch (error: any) {
      console.warn("Binance candle bootstrap failed for " + symbol + ":", error?.message || error);
    }
  }

  private subscribeStreams(streams: string[]): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || this.stopped) return;

    const unique = Array.from(new Set(streams)).filter((stream) => stream && !this.subscribedStreams.has(stream));
    if (!unique.length) return;

    if (this.subscribedStreams.size + unique.length > BinanceMarketDataService.MAX_STREAMS_PER_CONNECTION) {
      console.warn("Binance stream subscription limit reached; detailed market data was not subscribed.");
      return;
    }

    for (let i = 0; i < unique.length; i += 200) {
      const batch = unique.slice(i, i + 200);
      batch.forEach((stream) => this.subscribedStreams.add(stream));
      socket.send(JSON.stringify({
        method: "SUBSCRIBE",
        params: batch,
        id: ++this.subscriptionRequestId,
      }));
    }
  }

  private toAppSymbol(exchangeSymbol: string): string | null {
    for (const [symbol, mapped] of Object.entries(this.symbolMap)) {
      if (mapped === exchangeSymbol) return symbol;
    }
    return null;
  }
}