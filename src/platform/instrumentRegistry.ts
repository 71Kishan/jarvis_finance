import type { AssetClass, Instrument } from "./types";

interface BinanceFilter {
  filterType?: string;
  tickSize?: string;
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
  minNotional?: string;
  maxNotional?: string;
}

interface BinanceSymbol {
  symbol?: string;
  status?: string;
  baseAsset?: string;
  quoteAsset?: string;
  baseAssetPrecision?: number;
  quotePrecision?: number;
  quoteAssetPrecision?: number;
  isSpotTradingAllowed?: boolean;
  filters?: BinanceFilter[];
}

function firstFilter(filters: BinanceFilter[] | undefined, ...types: string[]): BinanceFilter | undefined {
  return filters?.find((filter) => types.includes(String(filter.filterType)));
}

export function instrumentIdFor(provider: string, venue: string, providerSymbol: string): string {
  return provider.toUpperCase() + ":" + venue.toUpperCase() + ":" + providerSymbol.toUpperCase();
}

export function normalizeBinanceSpotSymbol(row: BinanceSymbol, updatedAt = Date.now()): Instrument | null {
  const providerSymbol = String(row.symbol || "").trim().toUpperCase();
  const baseAsset = String(row.baseAsset || "").trim().toUpperCase();
  const quoteAsset = String(row.quoteAsset || "").trim().toUpperCase();
  if (!providerSymbol || !baseAsset || !quoteAsset) return null;

  const priceFilter = firstFilter(row.filters, "PRICE_FILTER");
  const lotFilter = firstFilter(row.filters, "LOT_SIZE", "MARKET_LOT_SIZE");
  const notionalFilter = firstFilter(row.filters, "NOTIONAL", "MIN_NOTIONAL");

  const active = String(row.status || "").toUpperCase() === "TRADING";
  const tradable = active && row.isSpotTradingAllowed !== false;

  return {
    instrumentId: instrumentIdFor("BINANCE_SPOT", "BINANCE", providerSymbol),
    symbol: baseAsset + "/" + quoteAsset,
    displaySymbol: baseAsset + "/" + quoteAsset,
    name: baseAsset + " / " + quoteAsset,
    assetClass: "CRYPTO",
    venue: "BINANCE",
    venueKind: "EXCHANGE",
    market: "SPOT",
    baseAsset,
    quoteAsset,
    provider: "BINANCE_SPOT",
    providerSymbol,
    status: active ? "ACTIVE" : "SUSPENDED",
    tradable,
    shortable: false,
    fractionable: false,
    tickSize: priceFilter?.tickSize,
    lotSize: lotFilter?.stepSize,
    minQuantity: lotFilter?.minQty,
    maxQuantity: lotFilter?.maxQty,
    minNotional: notionalFilter?.minNotional,
    pricePrecision: Number.isInteger(row.quoteAssetPrecision) ? row.quoteAssetPrecision : row.quotePrecision,
    quantityPrecision: Number.isInteger(row.baseAssetPrecision) ? row.baseAssetPrecision : undefined,
    updatedAt,
  };
}

export function normalizeBinanceSpotExchangeInfo(payload: unknown, updatedAt = Date.now()): Instrument[] {
  const symbols = Array.isArray((payload as any)?.symbols) ? (payload as any).symbols as BinanceSymbol[] : [];
  return symbols
    .map((symbol) => normalizeBinanceSpotSymbol(symbol, updatedAt))
    .filter((instrument): instrument is Instrument => Boolean(instrument))
    .sort((a, b) => a.displaySymbol.localeCompare(b.displaySymbol));
}

export class InstrumentRegistry {
  private readonly byId = new Map<string, Instrument>();

  public replace(instruments: Instrument[]): void {
    this.byId.clear();
    for (const instrument of instruments) this.upsert(instrument);
  }

  public upsert(instrument: Instrument): void {
    this.byId.set(instrument.instrumentId, { ...instrument });
  }

  public get(instrumentId: string): Instrument | null {
    const instrument = this.byId.get(instrumentId);
    return instrument ? { ...instrument } : null;
  }

  public getByProviderSymbol(provider: string, providerSymbol: string): Instrument | null {
    const normalizedProvider = provider.toUpperCase();
    const normalizedSymbol = providerSymbol.toUpperCase();
    for (const instrument of this.byId.values()) {
      if (
        instrument.provider.toUpperCase() === normalizedProvider &&
        instrument.providerSymbol.toUpperCase() === normalizedSymbol
      ) {
        return { ...instrument };
      }
    }
    return null;
  }

  public list(options?: {
    assetClass?: AssetClass;
    quoteAsset?: string;
    tradableOnly?: boolean;
    limit?: number;
  }): Instrument[] {
    const quote = options?.quoteAsset?.toUpperCase();
    const limit = Math.min(5000, Math.max(1, options?.limit ?? 100));
    return Array.from(this.byId.values())
      .filter((instrument) => !options?.assetClass || instrument.assetClass === options.assetClass)
      .filter((instrument) => !quote || instrument.quoteAsset?.toUpperCase() === quote)
      .filter((instrument) => options?.tradableOnly ? instrument.tradable : true)
      .sort((a, b) => a.displaySymbol.localeCompare(b.displaySymbol))
      .slice(0, limit)
      .map((instrument) => ({ ...instrument }));
  }

  public search(query: string, options?: {
    assetClass?: AssetClass;
    quoteAsset?: string;
    tradableOnly?: boolean;
    limit?: number;
  }): Instrument[] {
    const needle = query.trim().toUpperCase();
    if (!needle) return this.list(options);

    const limit = Math.min(500, Math.max(1, options?.limit ?? 50));
    return Array.from(this.byId.values())
      .filter((instrument) => !options?.assetClass || instrument.assetClass === options.assetClass)
      .filter((instrument) => !options?.quoteAsset || instrument.quoteAsset?.toUpperCase() === options.quoteAsset.toUpperCase())
      .filter((instrument) => options?.tradableOnly ? instrument.tradable : true)
      .map((instrument) => ({
        instrument,
        rank:
          (instrument.providerSymbol.toUpperCase() === needle ? 0 : 5) +
          (instrument.displaySymbol.toUpperCase().startsWith(needle) ? 0 : 5) +
          (instrument.name.toUpperCase().includes(needle) ? 2 : 8),
      }))
      .sort((a, b) => a.rank - b.rank || a.instrument.displaySymbol.localeCompare(b.instrument.displaySymbol))
      .slice(0, limit)
      .map(({ instrument }) => ({ ...instrument }));
  }

  public size(): number {
    return this.byId.size;
  }
}
