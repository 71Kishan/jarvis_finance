import type { Instrument } from "../platform/types";
import { InstrumentRegistry, normalizeBinanceSpotExchangeInfo } from "../platform/instrumentRegistry";

const REST_BASE_URL = "https://api.binance.com";
const REFRESH_INTERVAL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface BinanceInstrumentCatalogHealth {
  state: "STARTING" | "READY" | "STALE" | "ERROR" | "STOPPED";
  instrumentCount: number;
  lastRefreshAt: number | null;
  lastError: string | null;
  persistenceState: "DISABLED" | "READY" | "ERROR";
  lastPersistAt: number | null;
  persistenceError: string | null;
}

export class BinanceInstrumentCatalog {
  private readonly registry = new InstrumentRegistry();
  private readonly persist?: (instruments: Instrument[]) => Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private refreshing = false;
  private state: BinanceInstrumentCatalogHealth["state"] = "STARTING";
  private lastRefreshAt: number | null = null;
  private lastError: string | null = null;
  private persistenceState: BinanceInstrumentCatalogHealth["persistenceState"] = "DISABLED";
  private lastPersistAt: number | null = null;
  private persistenceError: string | null = null;

  constructor(options?: {
    persist?: (instruments: Instrument[]) => Promise<void>;
  }) {
    this.persist = options?.persist;
    this.persistenceState = this.persist ? "ERROR" : "DISABLED";
  }

  public async start(): Promise<void> {
    this.stopped = false;
    await this.refresh();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.refresh();
    }, REFRESH_INTERVAL_MS);
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = "STOPPED";
  }

  public async refresh(): Promise<void> {
    if (this.stopped || this.refreshing) return;
    this.refreshing = true;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(REST_BASE_URL + "/api/v3/exchangeInfo", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error("Binance exchangeInfo HTTP " + response.status);
      }

      const payload = await response.json();
      const instruments = normalizeBinanceSpotExchangeInfo(payload);
      if (!instruments.length) {
        throw new Error("Binance exchangeInfo contained no symbols.");
      }

      this.registry.replace(instruments);
      this.lastRefreshAt = Date.now();
      this.lastError = null;

      if (this.persist) {
        try {
          await this.persist(instruments);
          this.persistenceState = "READY";
          this.lastPersistAt = Date.now();
          this.persistenceError = null;
        } catch (persistError: any) {
          this.persistenceState = "ERROR";
          this.persistenceError = persistError?.message || "Instrument persistence failed.";
        }
      }

      this.state = "READY";
    } catch (error: any) {
      this.lastError = error?.message || "Unknown catalog refresh error";
      this.state = this.registry.size() > 0 ? "STALE" : "ERROR";
    } finally {
      this.refreshing = false;
    }
  }

  public get(instrumentId: string): Instrument | null {
    return this.registry.get(instrumentId);
  }

  public getByProviderSymbol(provider: string, providerSymbol: string): Instrument | null {
    return this.registry.getByProviderSymbol(provider, providerSymbol);
  }

  public list(options?: Parameters<InstrumentRegistry["list"]>[0]): Instrument[] {
    return this.registry.list(options);
  }

  public search(query: string, options?: Parameters<InstrumentRegistry["search"]>[1]): Instrument[] {
    return this.registry.search(query, options);
  }

  public getHealth(): BinanceInstrumentCatalogHealth {
    return {
      state: this.state,
      instrumentCount: this.registry.size(),
      lastRefreshAt: this.lastRefreshAt,
      lastError: this.lastError,
      persistenceState: this.persistenceState,
      lastPersistAt: this.lastPersistAt,
      persistenceError: this.persistenceError,
    };
  }
}
