import { BinanceMarketDataService } from "./binanceMarketData";
import { DEFAULT_STRATEGY, TradingEngine } from "../engine/tradingEngine";
import { StrategyConfig } from "../types/trading";

export type PaperRuntimeStatus =
  | "STOPPED"
  | "STARTING"
  | "RUNNING"
  | "WAITING_FOR_DATA"
  | "HALTED"
  | "ERROR";

export interface PaperRuntimeSnapshot {
  status: PaperRuntimeStatus;
  symbol: string;
  startedAt: number | null;
  lastProcessedCandleAt: number | null;
  lastPollAt: number | null;
  lastDataAt: number | null;
  message: string;
  botState: ReturnType<TradingEngine["getBotState"]>;
  vitality: ReturnType<TradingEngine["getVitality"]>;
  activeTrade: ReturnType<TradingEngine["getActiveTrade"]>;
  lastSignal: ReturnType<TradingEngine["getLastSignal"]>;
}

export class AutonomousPaperRuntime {
  private readonly engine: TradingEngine;
  private readonly symbol: string;
  private readonly gateway: BinanceMarketDataService;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: PaperRuntimeStatus = "STOPPED";
  private startedAt: number | null = null;
  private lastProcessedCandleAt: number | null = null;
  private lastPollAt: number | null = null;
  private lastDataAt: number | null = null;
  private message = "Paper runtime is stopped.";

  constructor(
    gateway: BinanceMarketDataService,
    options?: {
      symbol?: string;
      initialCapital?: number;
      strategy?: StrategyConfig;
      pollIntervalMs?: number;
    },
  ) {
    this.gateway = gateway;
    this.symbol = options?.symbol || DEFAULT_STRATEGY.asset;
    const strategy = options?.strategy || { ...DEFAULT_STRATEGY, asset: this.symbol };
    this.pollIntervalMs = Math.max(500, options?.pollIntervalMs || 1000);
    this.engine = new TradingEngine(
      options?.initialCapital || 10_000,
      6,
      { ...strategy, indicatorWeights: { ...strategy.indicatorWeights } },
    );
  }

  public start(): void {
    if (this.timer) return;

    this.status = "STARTING";
    this.startedAt = Date.now();
    this.message = "Paper runtime starting; waiting for trusted closed-candle data.";

    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);

    void this.poll();
  }

  public stop(reason = "Paper runtime stopped by operator."): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    if (this.engine.getActiveTrade()) {
      this.status = "ERROR";
      this.message = "Runtime stop requested while a paper position is open. Position remains in memory; restart recovery requires durable state.";
      return;
    }

    this.status = "STOPPED";
    this.message = reason;
  }

  public getStatus(): PaperRuntimeSnapshot {
    return {
      status: this.status,
      symbol: this.symbol,
      startedAt: this.startedAt,
      lastProcessedCandleAt: this.lastProcessedCandleAt,
      lastPollAt: this.lastPollAt,
      lastDataAt: this.lastDataAt,
      message: this.message,
      botState: this.engine.getBotState(),
      vitality: { ...this.engine.getVitality() },
      activeTrade: this.engine.getActiveTrade() ? { ...this.engine.getActiveTrade()! } : null,
      lastSignal: this.engine.getLastSignal(),
    };
  }

  private async poll(): Promise<void> {
    this.lastPollAt = Date.now();

    try {
      const snapshot = this.gateway.getSnapshot(this.symbol, 100);

      if (!snapshot) {
        this.status = "WAITING_FOR_DATA";
        this.message = "Trusted Binance data is not ready yet.";
        return;
      }

      if (snapshot.gateway.state !== "READY" || snapshot.gateway.stale) {
        this.status = "WAITING_FOR_DATA";
        this.message = "Trusted Binance data is stale or reconnecting; no new paper decision is processed.";
        return;
      }

      const candles = snapshot.candles;
      const latest = candles[candles.length - 1];

      if (!latest) {
        this.status = "WAITING_FOR_DATA";
        this.message = "No completed candle is available.";
        return;
      }

      const bid = Number(snapshot.ticker.bid);
      const ask = Number(snapshot.ticker.ask);
      const mid = (bid + ask) / 2;
      const spreadBps = bid > 0 && ask > 0 && mid > 0 ? ((ask - bid) / mid) * 10_000 : undefined;

      this.engine.setMarketQuality({
        spreadBps,
        dataTimestamp: snapshot.ticker.lastUpdated,
        marketOpen: true,
      });

      this.lastDataAt = snapshot.ticker.lastUpdated;

      // TradingEngine is already idempotent by candle timestamp. The runtime only
      // feeds completed candles from the server-owned websocket gateway.
      this.engine.onTick(latest, candles);
      this.lastProcessedCandleAt = latest.timestamp;

      const state = this.engine.getBotState();
      if (state === "HALTED_DEAD") {
        this.status = "HALTED";
        this.message = "Paper risk circuit breaker is active. No new entries will be taken.";
      } else {
        this.status = "RUNNING";
        this.message = "Paper runtime is processing trusted completed candles.";
      }
    } catch (error: any) {
      this.status = "ERROR";
      this.message = error?.message || "Paper runtime encountered an unexpected error.";
      console.error("Autonomous paper runtime error:", error);
    }
  }
}
