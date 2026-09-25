import { BinanceProviderError, BinanceSpotAccountAdapter } from "../platform/binanceSpotAccountAdapter";
import { SandboxOrderStore } from "./sandboxOrderStore";

const ACTIVE_STATUSES = new Set([
  "PENDING_SUBMIT",
  "SUBMITTED",
  "PARTIALLY_FILLED",
  "CANCEL_PENDING",
  "UNKNOWN_RECONCILIATION",
]);

function extractProviderSymbol(instrumentId: string): string | null {
  const match = String(instrumentId || "").match(/^BINANCE_SPOT:BINANCE:([A-Z0-9_]+)$/i);
  return match ? match[1].toUpperCase() : null;
}

export interface BinanceSandboxReconcilerStatus {
  running: boolean;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  lastProcessedCount: number;
  intervalMs: number;
}

export class BinanceSandboxReconciler {
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;
  private lastProcessedCount = 0;

  constructor(
    private readonly store: SandboxOrderStore,
    private readonly adapter: BinanceSpotAccountAdapter,
    intervalMs = Number(process.env.JARVIS_SANDBOX_RECONCILIATION_POLL_MS) || 15_000,
  ) {
    this.intervalMs = Math.max(5_000, intervalMs);
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    void this.runOnce();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public getStatus(): BinanceSandboxReconcilerStatus {
    return {
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      lastProcessedCount: this.lastProcessedCount,
      intervalMs: this.intervalMs,
    };
  }

  public async runOnce(): Promise<BinanceSandboxReconcilerStatus> {
    if (this.running) return this.getStatus();
    this.running = true;
    this.lastRunAt = Date.now();
    let processed = 0;
    let runHadErrors = false;

    try {
      const active = await this.store.listActiveOrders();
      for (const item of active) {
        if (!ACTIVE_STATUSES.has(item.order.status)) continue;
        if (!item.externalAccountId) continue;

        const symbol = extractProviderSymbol(item.order.instrumentId);
        if (!symbol) {
          await this.store.markStatus(
            item.userId,
            item.order.clientOrderId,
            "UNKNOWN_RECONCILIATION",
            { failureReason: "Persisted order has no resolvable Binance provider symbol." },
          );
          processed++;
          continue;
        }

        try {
          const providerOrder = await this.adapter.getOrderBySymbol(
            item.externalAccountId,
            symbol,
            item.order.clientOrderId,
          );

          const reconciled = await this.store.markStatus(
            item.userId,
            item.order.clientOrderId,
            providerOrder.status,
            {
              externalOrderId: providerOrder.externalOrderId,
              filledQuantity: providerOrder.filledQuantity,
              averageFillPrice: providerOrder.averageFillPrice,
              submittedAt: providerOrder.submittedAt,
              failureReason: undefined,
            },
          );

          if (reconciled?.externalOrderId) {
            const fills = await this.adapter.getFills(
              item.externalAccountId,
              symbol,
              reconciled.externalOrderId,
            );
            for (const providerFill of fills) {
              await this.store.recordFill(item.userId, {
                ...providerFill,
                orderClientId: item.order.clientOrderId,
                accountId: item.order.accountId,
              });
            }
          }

          processed++;
        } catch (error: any) {
          const isUnknownOrder =
            error instanceof BinanceProviderError &&
            error.kind === "UNKNOWN_ORDER";

          if (isUnknownOrder) {
            await this.store.markStatus(
              item.userId,
              item.order.clientOrderId,
              "UNKNOWN_RECONCILIATION",
              { failureReason: error.message },
            );
            processed++;
            continue;
          }

          runHadErrors = true;
          this.lastErrorAt = Date.now();
          this.lastError = error?.message || "Sandbox reconciliation failed.";
        }
      }

      this.lastProcessedCount = processed;
      this.lastSuccessAt = Date.now();
      if (!runHadErrors) this.lastError = null;
      return this.getStatus();
    } catch (error: any) {
      this.lastErrorAt = Date.now();
      this.lastError = error?.message || "Sandbox reconciliation run failed.";
      return this.getStatus();
    } finally {
      this.running = false;
    }
  }
}
