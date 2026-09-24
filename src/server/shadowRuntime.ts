import { BinanceMarketDataService } from "./binanceMarketData";
import { DEFAULT_STRATEGY, TradingEngine } from "../engine/tradingEngine";
import { attachIndicators } from "../engine/indicators";
import { Candle, StrategyConfig } from "../types/trading";
import type { PlatformRepository, ShadowRuntimeRecord } from "../platform/platformRepository";

export type ShadowRuntimeStatus =
  | "STOPPED"
  | "STARTING"
  | "RUNNING"
  | "WAITING_FOR_DATA"
  | "HALTED"
  | "ERROR";

export interface ShadowRuntimeSnapshot {
  status: ShadowRuntimeStatus;
  symbol: string;
  operatorConfigured: boolean;
  strategy: StrategyConfig;
  startedAt: number | null;
  lastProcessedCandleAt: number | null;
  lastPollAt: number | null;
  lastDataAt: number | null;
  message: string;
  researchCapital: number;
  botState: ReturnType<TradingEngine["getBotState"]>;
  vitality: ReturnType<TradingEngine["getVitality"]>;
  activeTrade: ReturnType<TradingEngine["getActiveTrade"]>;
  lastSignal: ReturnType<TradingEngine["getLastSignal"]>;
  tradeHistory: ReturnType<TradingEngine["getTradeHistory"]>;
}

export class AutonomousShadowRuntime {
  private readonly gateway: BinanceMarketDataService;
  private readonly repository: PlatformRepository;
  private readonly symbol: string;
  private readonly pollIntervalMs: number;
  private readonly researchCapital: number;
  private initialStrategy: StrategyConfig;
  private engine: TradingEngine;
  private operatorUserId: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pollInFlight = false;
  private status: ShadowRuntimeStatus = "STOPPED";
  private startedAt: number | null = null;
  private lastProcessedCandleAt: number | null = null;
  private lastPollAt: number | null = null;
  private lastDataAt: number | null = null;
  private message = "Shadow runtime is stopped.";
  private recoveryNote = "";
  private persistedRuntimeId: string | null = null;

  constructor(
    gateway: BinanceMarketDataService,
    repository: PlatformRepository,
    options?: {
      symbol?: string;
      strategy?: StrategyConfig;
      researchCapital?: number;
      pollIntervalMs?: number;
    },
  ) {
    this.gateway = gateway;
    this.repository = repository;
    this.symbol = options?.symbol || DEFAULT_STRATEGY.asset;
    this.initialStrategy = {
      ...(options?.strategy || DEFAULT_STRATEGY),
      asset: options?.symbol || options?.strategy?.asset || DEFAULT_STRATEGY.asset,
      indicatorWeights: {
        ...(options?.strategy || DEFAULT_STRATEGY).indicatorWeights,
      },
    };
    this.researchCapital = Math.max(100, options?.researchCapital || 10_000);
    this.pollIntervalMs = Math.max(500, options?.pollIntervalMs || 1000);
    this.engine = new TradingEngine(this.researchCapital, 6, this.initialStrategy);
  }

  public configureStrategy(strategy: StrategyConfig): void {
    if (this.timer) {
      throw new Error("Shadow strategy cannot be changed while the runtime is running.");
    }

    this.initialStrategy = {
      ...strategy,
      indicatorWeights: { ...strategy.indicatorWeights },
    };
    this.engine = new TradingEngine(this.researchCapital, 6, this.initialStrategy);
    this.lastProcessedCandleAt = null;
    this.startedAt = null;
    this.recoveryNote = "";
    this.message = "Shadow strategy configured; awaiting start.";
  }

  public async start(operatorUserId?: string): Promise<void> {
    if (this.timer) return;

    if (!this.repository.isPersistenceReady()) {
      this.status = "ERROR";
      this.message = "Shadow runtime requires ready PostgreSQL persistence.";
      return;
    }

    this.status = "STARTING";
    this.lastPollAt = Date.now();

    try {
      this.operatorUserId = operatorUserId || await this.resolveOperatorUserId();
      if (!this.operatorUserId) {
        this.status = "ERROR";
        this.message = "No authenticated operator is configured for durable shadow state.";
        return;
      }

      await this.restoreState();
      this.startedAt = Date.now();
      this.status = "STARTING";
      this.message = this.recoveryNote
        ? "Recovered shadow research state; waiting for trusted market data. " + this.recoveryNote
        : "Shadow runtime starting; waiting for trusted completed-candle market data.";

      await this.persist();

      this.timer = setInterval(() => {
        void this.poll();
      }, this.pollIntervalMs);

      await this.poll();
    } catch (error: any) {
      this.status = "ERROR";
      this.message = error?.message || "Shadow runtime could not start.";
      await this.safePersist();
    }
  }

  public async stop(reason = "Shadow runtime stopped by operator."): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    this.status = "STOPPED";
    this.message = this.engine.getActiveTrade()
      ? reason + " An open research position is preserved for restart recovery."
      : reason;

    await this.safePersist();
  }

  public getStatus(): ShadowRuntimeSnapshot {
    return {
      status: this.status,
      symbol: this.symbol,
      operatorConfigured: Boolean(this.operatorUserId),
      strategy: {
        ...this.engine.getStrategy(),
        indicatorWeights: { ...this.engine.getStrategy().indicatorWeights },
      },
      startedAt: this.startedAt,
      lastProcessedCandleAt: this.lastProcessedCandleAt,
      lastPollAt: this.lastPollAt,
      lastDataAt: this.lastDataAt,
      message: this.recoveryNote ? this.message + " " + this.recoveryNote : this.message,
      researchCapital: this.researchCapital,
      botState: this.engine.getBotState(),
      vitality: { ...this.engine.getVitality() },
      activeTrade: this.engine.getActiveTrade() ? { ...this.engine.getActiveTrade()! } : null,
      lastSignal: this.engine.getLastSignal(),
      tradeHistory: this.engine.getTradeHistory().map((trade) => ({ ...trade })),
    };
  }

  private async resolveOperatorUserId(): Promise<string | null> {
    const email = process.env.JARVIS_ADMIN_EMAIL?.trim().toLowerCase();
    if (!email) return null;
    const user = await this.repository.getAuthUserByEmail(email);
    return user?.id || null;
  }

  private async restoreState(): Promise<void> {
    if (!this.operatorUserId) return;

    const record = await this.repository.loadShadowRuntime(
      this.operatorUserId,
      this.initialStrategy.id,
      this.symbol,
    );

    if (!record) {
      this.engine = new TradingEngine(this.researchCapital, 6, this.initialStrategy);
      this.lastProcessedCandleAt = null;
      this.persistedRuntimeId = null;
      this.recoveryNote = "";
      return;
    }

    this.persistedRuntimeId = record.id;
    const state = record.runtimeState as any;
    if (state?.version !== 1 || !this.engine.hydrateRuntimeState(state)) {
      throw new Error("Persisted shadow runtime state is unsupported or invalid.");
    }

    this.lastProcessedCandleAt = this.engine.getLastProcessedCandleTimestamp() || record.lastProcessedCandleAt || null;
    this.startedAt = record.startedAt ?? null;
    this.recoveryNote = "Durable PostgreSQL state restored.";
  }

  private async persist(statusOverride?: ShadowRuntimeStatus): Promise<ShadowRuntimeRecord | null> {
    if (!this.operatorUserId) return null;

    const record = await this.repository.saveShadowRuntime({
      userId: this.operatorUserId,
      strategyId: this.engine.getStrategy().id,
      strategyVersion: this.engine.getStrategy().version,
      symbol: this.symbol,
      status: statusOverride || this.status,
      runtimeState: this.engine.exportRuntimeState() as unknown as Record<string, unknown>,
      lastProcessedCandleAt: this.engine.getLastProcessedCandleTimestamp() || undefined,
      startedAt: this.startedAt || undefined,
    });

    this.persistedRuntimeId = record.id;
    this.lastProcessedCandleAt = this.engine.getLastProcessedCandleTimestamp() || null;
    return record;
  }

  private async safePersist(): Promise<void> {
    try {
      if (this.operatorUserId) await this.persist();
    } catch (error: any) {
      this.message += " Durable shadow state write failed: " + (error?.message || "unknown error");
    }
  }

  private async poll(): Promise<void> {
    this.lastPollAt = Date.now();
    if (this.pollInFlight || !this.operatorUserId) return;
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
        this.message = "Trusted Binance data is stale or reconnecting; no new shadow decision is processed.";
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
      const hasRestoredPosition = priorTimestamp > 0 && Boolean(this.engine.getActiveTrade());

      if (hasRestoredPosition && unprocessed.length > 0) {
        const earliestAvailable = candles[0]?.timestamp || 0;
        const expectedNext = priorTimestamp + 60_000;
        if (earliestAvailable > expectedNext) {
          this.status = "ERROR";
          this.message =
            "Shadow restart recovery is blocked: completed candles are missing while a research position is open. Manual reconciliation is required before resuming.";
          await this.safePersist();
          return;
        }
      }

      // On a fresh run, only the newest completed bar is evaluated. Historical
      // candles are context for indicators, not retroactive shadow executions.
      const toProcess: Candle[] =
        hasRestoredPosition
          ? unprocessed
          : unprocessed.length > 0
            ? [unprocessed[unprocessed.length - 1]]
            : [];

      for (const candle of toProcess) {
        const beforeActiveTrade = this.engine.getActiveTrade();
        const beforeTradeIds = new Set(this.engine.getTradeHistory().map((trade) => trade.id));

        this.engine.onTick(candle, candles);

        const afterActiveTrade = this.engine.getActiveTrade();
        const afterTradeHistory = this.engine.getTradeHistory();
        const newlyClosedTrades = afterTradeHistory.filter((trade) => !beforeTradeIds.has(trade.id));
        const openedTrade =
          !beforeActiveTrade && afterActiveTrade
            ? afterActiveTrade
            : null;
        const activeTradeChanged =
          Boolean(beforeActiveTrade && afterActiveTrade) &&
          (
            beforeActiveTrade!.stopLoss !== afterActiveTrade!.stopLoss ||
            beforeActiveTrade!.takeProfit !== afterActiveTrade!.takeProfit ||
            beforeActiveTrade!.amount !== afterActiveTrade!.amount ||
            beforeActiveTrade!.pnl !== afterActiveTrade!.pnl
          );

        const runtimeId = this.persistedRuntimeId || (await this.persist())?.id;
        if (!runtimeId) {
          throw new Error("Shadow runtime persistence did not return a runtime identifier.");
        }

        if (openedTrade) {
          await this.repository.upsertShadowTrade(runtimeId, openedTrade);
        } else if (activeTradeChanged && afterActiveTrade) {
          // Keep the live research position current when stop/mark state changes;
          // equity observations remain the high-frequency time series.
          await this.repository.upsertShadowTrade(runtimeId, afterActiveTrade);
        }
        for (const trade of newlyClosedTrades) {
          await this.repository.upsertShadowTrade(runtimeId, trade);
        }

        const eventType =
          newlyClosedTrades.length > 0
            ? "EXIT"
            : !beforeActiveTrade && afterActiveTrade
              ? "ENTRY"
              : this.engine.getBotState() === "HALTED_DEAD"
                ? "HALT"
                : this.engine.getLastSignal()?.eligible
                  ? "SIGNAL"
                  : "HEARTBEAT";

        const tradeEvent =
          newlyClosedTrades[0]
            ? { kind: "TRADE_CLOSED", trade: newlyClosedTrades[0] }
            : !beforeActiveTrade && afterActiveTrade
              ? { kind: "TRADE_OPENED", trade: afterActiveTrade }
              : this.engine.getBotState() === "HALTED_DEAD"
                ? { kind: "RISK_HALT" }
                : null;

        const vitality = this.engine.getVitality();
        await this.repository.recordShadowObservation({
          runtimeId,
          candleTimestamp: candle.timestamp,
          closePrice: String(candle.close),
          equity: String(vitality.currentEquity),
          cash: String(vitality.cash),
          drawdownPercent: String(vitality.currentDrawdownPercent),
          dailyDrawdownPercent: String(vitality.dailyDrawdownPercent),
          botState: this.engine.getBotState(),
          eventType,
          signal: this.engine.getLastSignal() as unknown as Record<string, unknown> | null,
          activeTrade: afterActiveTrade as unknown as Record<string, unknown> | null,
          tradeEvent: tradeEvent as unknown as Record<string, unknown> | null,
        });

        await this.persist();

        if (this.engine.getBotState() === "HALTED_DEAD") break;
      }

      const state = this.engine.getBotState();
      if (state === "HALTED_DEAD") {
        this.status = "HALTED";
        this.message = "Shadow risk circuit breaker is active. No new research entries will be taken.";
      } else {
        this.status = "RUNNING";
        this.message =
          "Shadow runtime is evaluating trusted completed candles with the same deterministic paper strategy/risk model. No provider order is submitted.";
      }
      await this.persist();
    } catch (error: any) {
      this.status = "ERROR";
      this.message = error?.message || "Shadow runtime encountered an unexpected error.";
      console.error("Autonomous shadow runtime error:", error);
      await this.safePersist();
    } finally {
      this.pollInFlight = false;
    }
  }
}
