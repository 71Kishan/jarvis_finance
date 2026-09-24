import type { BinanceMarketDataService } from "./binanceMarketData";
import type { BinanceInstrumentCatalog } from "./binanceInstrumentCatalog";
import { valueSpotBalances, type TrustedAssetMark, type ValuedPortfolio } from "../platform/portfolioValuation";
import type { WalletBalance } from "../platform/types";

export interface ValuedBalanceRow {
  accountId: string;
  asset: string;
  free: string;
  locked: string;
  total: string;
  valueInBaseCurrency?: string;
  markPriceInBaseCurrency?: string;
  markUpdatedAt?: number;
  priced: boolean;
  updatedAt: number;
}

export interface BinanceSpotPortfolioView {
  valuation: ValuedPortfolio;
  balances: ValuedBalanceRow[];
}

export class BinanceSpotPortfolioService {
  private readonly gateway: BinanceMarketDataService;
  private readonly catalog: BinanceInstrumentCatalog;
  private readonly freshnessMs: number;

  constructor(
    gateway: BinanceMarketDataService,
    catalog: BinanceInstrumentCatalog,
    freshnessMs = 15_000,
  ) {
    this.gateway = gateway;
    this.catalog = catalog;
    this.freshnessMs = Math.max(1_000, freshnessMs);
  }

  public valueBalances(
    balances: WalletBalance[],
    baseCurrency = (process.env.JARVIS_PORTFOLIO_BASE_CURRENCY || "USDT").toUpperCase(),
    asOf = Date.now(),
  ): BinanceSpotPortfolioView {
    const base = baseCurrency.toUpperCase();
    const marks: TrustedAssetMark[] = [];
    const markByAsset = new Map<string, TrustedAssetMark>();

    for (const balance of balances) {
      const asset = balance.asset.toUpperCase();
      if (asset === base || balance.total === "0") continue;

      const instrument = this.catalog
        .list({ quoteAsset: base, tradableOnly: true, limit: 5000 })
        .find((candidate) => candidate.baseAsset?.toUpperCase() === asset);

      const ticker = instrument
        ? this.gateway.getMiniTicker(instrument.providerSymbol)
        : null;

      if (
        instrument &&
        ticker &&
        Number.isFinite(ticker.price) &&
        ticker.price > 0 &&
        asOf - ticker.lastUpdated <= this.freshnessMs
      ) {
        const mark: TrustedAssetMark = {
          asset,
          priceInBaseCurrency: String(ticker.price),
          sourceInstrumentId: instrument.instrumentId,
          updatedAt: ticker.lastUpdated,
        };
        marks.push(mark);
        markByAsset.set(asset, mark);
      }
    }

    const valuation = valueSpotBalances(balances, base, marks, asOf);
    const valuedBalances = balances.map((balance): ValuedBalanceRow => {
      const asset = balance.asset.toUpperCase();
      if (asset === base) {
        return {
          ...balance,
          valueInBaseCurrency: balance.total,
          priced: true,
          updatedAt: balance.updatedAt,
        };
      }

      const mark = markByAsset.get(asset);
      return {
        ...balance,
        ...(mark ? {
          markPriceInBaseCurrency: mark.priceInBaseCurrency,
          markUpdatedAt: mark.updatedAt,
        } : {}),
        ...(mark ? {
          valueInBaseCurrency: multiply(balance.total, mark.priceInBaseCurrency),
        } : {}),
        priced: Boolean(mark),
        updatedAt: balance.updatedAt,
      };
    });

    return { valuation, balances: valuedBalances };
  }
}

function multiply(left: string, right: string): string {
  // The portfolio valuation module remains the authority for total equity math.
  // This local helper only formats per-row marked values through its exact decimal
  // primitive, keeping the UI from receiving a floating-point valuation.
  return exactMultiply(left, right);
}

function exactMultiply(left: string, right: string): string {
  const { normalizeDecimal, multiplyDecimals } = require("../platform/decimal") as typeof import("../platform/decimal");
  return multiplyDecimals(normalizeDecimal(left), normalizeDecimal(right));
}
