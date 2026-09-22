import { BinanceMarketDataService } from "./binanceMarketData";
import { DEFAULT_STRATEGY, TradingEngine } from "../engine/tradingEngine";
import { Candle, StrategyConfig } from "../types/trading";
import { attachIndicators } from "../engine/indicators";
import { PaperStateStore, PaperStateStoreResult } from "./paperStateStore";

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
  private readonly stateStore: PaperStateStore;
  private restoredFromDisk = false;
  private recoveryNote = "";
  private pollInFlight = false;
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
    this.stateStore = new PaperStateStore();
    const recovery = this.stateStore.loadInto(this.engine);
    this.applyRecoveryResult(recovery);
    this.lastProcessedCandleAt = this.engine.getLastProcessedCandleTimestamp() || null;
  }

  public start(): void {
    if (this.timer) return;

    this.status = "STARTING";
    this.startedAt = Date.now();
    this.message = this.restoredFromDisk
      ? "Recovered durable paper state; waiting for trusted market data to reconcile missed completed candles."
      : "Paper runtime starting; waiting for trusted closed-candle data.";

    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);

    void this.poll();
  }

  public stop(reason = "Paper runtime stopped by operator."): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.stateStore.save(this.engine);
    } catch (error: any) {
      this.status = "ERROR";
      this.message = "Runtime stopped, but durable state could not be saved: " + (error?.message || "unknown storage error");
      return;
    }

    this.status = "STOPPED";
    this.message = this.engine.getActiveTrade()
      ? reason + " An open paper position is durably preserved for restart recovery."
      : reason;
  }

  public getStatus(): PaperRuntimeSnapshot {
    return {
      status: this.status,
      symbol: this.symbol,
      startedAt: this.startedAt,
      lastProcessedCandleAt: this.lastProcessedCandleAt,
      lastPollAt: this.lastPollAt,
      lastDataAt: this.lastDataAt,
      message: this.recoveryNote ? this.message + " " + this.recoveryNote : this.message,
      botState: this.engine.getBotState(),
      vitality: { ...this.engine.getVitality() },
      activeTrade: this.engine.getActiveTrade() ? { ...this.engine.getActiveTrade()! } : null,
      lastSignal: this.engine.getLastSignal(),
    };
  }

  private async poll(): Promise<void> {
    this.lastPollAt = Date.now();
    if (this.pollInFlight) return;
    this.pollInFlight = true;

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

      const candles = attachIndicators(snapshot.candles);
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

      const priorTimestamp = this.engine.getLastProcessedCandleTimestamp();
      const unprocessed = candles.filter((candle) => candle.timestamp > priorTimestamp);
      const hadRestoredPosition = this.restoredFromDisk && Boolean(this.engine.getActiveTrade());

      // Never backfill missed entry opportunities after an outage: an old signal
      // cannot be truthfully filled at a historical open once the server is back.
      // A restored open position is different: every missed completed candle must
      // be replayed when the gateway still contains the full gap so stop/target
      // handling cannot be skipped.
      if (hadRestoredPosition && priorTimestamp > 0 && unprocessed.length > 0) {
        const earliestAvailable = candles[0]?.timestamp || 0;
        const expectedNext = priorTimestamp + 60_000;
        if (earliestAvailable > expectedNext) {
          this.status = "ERROR";
          this.message = "Restart recovery is blocked: completed candles are missing while a paper position is open. Manual reconciliation is required before resuming.";
          this.stateStore.save(this.engine);
          return;
        }
      }

      const toProcess: Candle[] = hadRestoredPosition
        ? unprocessed
        : unprocessed.length > 0
          ? [unprocessed[unprocessed.length - 1]]
          : [];

      for (const candle of toProcess) {
        this.engine.onTick(candle, candles);
        this.lastProcessedCandleAt = this.engine.getLastProcessedCandleTimestamp();
        this.stateStore.save(this.engine);

        if (this.engine.getBotState() === "HALTED_DEAD") break;
      }

      this.restoredFromDisk = true;

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
    } finally {
      this.pollInFlight = false;
    }
  }

  private applyRecoveryResult(result: PaperStateStoreResult): void {
    this.restoredFromDisk = result.restored;
    if (result.recoveredFromCorruptFile) {
      this.recoveryNote = result.error || "Previous paper state was corrupt and was quarantined.";
      this.message = this.recoveryNote;
    }
  }
}
