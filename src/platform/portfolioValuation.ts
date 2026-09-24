import type { WalletBalance } from "./types";
import { addDecimals, multiplyDecimals } from "./decimal";

export interface TrustedAssetMark {
  asset: string;
  priceInBaseCurrency: string;
  sourceInstrumentId?: string;
  updatedAt: number;
}

export interface ValuedPortfolio {
  baseCurrency: string;
  cashValue: string;
  holdingsValue: string;
  totalEquity: string;
  complete: boolean;
  asOf: number;
  marks: TrustedAssetMark[];
  unpricedAssets: string[];
}

export function valueSpotBalances(
  balances: WalletBalance[],
  baseCurrency: string,
  marks: TrustedAssetMark[],
  asOf = Date.now(),
): ValuedPortfolio {
  const base = baseCurrency.toUpperCase();
  const markByAsset = new Map(marks.map((mark) => [mark.asset.toUpperCase(), mark]));
  let cashValue = "0";
  let holdingsValue = "0";
  const unpricedAssets: string[] = [];

  for (const balance of balances) {
    const asset = balance.asset.toUpperCase();
    const total = balance.total;
    if (asset === base) {
      cashValue = addDecimals(cashValue, total);
      continue;
    }

    const mark = markByAsset.get(asset);
    if (!mark) {
      if (total !== "0") unpricedAssets.push(asset);
      continue;
    }

    holdingsValue = addDecimals(holdingsValue, multiplyDecimals(total, mark.priceInBaseCurrency));
  }

  return {
    baseCurrency: base,
    cashValue,
    holdingsValue,
    totalEquity: addDecimals(cashValue, holdingsValue),
    complete: unpricedAssets.length === 0,
    asOf,
    marks,
    unpricedAssets,
  };
}
