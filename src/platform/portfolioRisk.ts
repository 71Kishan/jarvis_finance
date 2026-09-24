import type { OrderSide, OrderType, WalletBalance } from "./types";
import { addDecimals, compareDecimals, multiplyDecimals, normalizeDecimal, subtractDecimals } from "./decimal";

export interface PortfolioRiskPolicy {
  maxGrossExposurePercent: number;
  maxSingleAssetExposurePercent: number;
  minCashReservePercent: number;
  maxOpenOrders: number;
}

export interface PortfolioRiskMark {
  asset: string;
  valueInBaseCurrency: string;
  updatedAt: number;
}

export interface PortfolioRiskOrder {
  side: OrderSide;
  type: OrderType;
  instrumentId: string;
  asset: string;
  quoteAsset: string;
  notionalInBaseCurrency: string;
  reserved: boolean;
}

export interface PortfolioRiskSnapshot {
  baseCurrency: string;
  equity: string;
  cashValue: string;
  holdingsValue: string;
  grossExposure: string;
  openOrderExposure: string;
  complete: boolean;
  unpricedAssets: string[];
  openOrders: number;
  asOf: number;
}

export interface PortfolioRiskRequest {
  baseCurrency: string;
  balances: WalletBalance[];
  marks: PortfolioRiskMark[];
  openOrders?: PortfolioRiskOrder[];
  candidate?: {
    side: OrderSide;
    type: OrderType;
    asset: string;
    quoteAsset: string;
    notionalInBaseCurrency: string;
  };
  policy?: Partial<PortfolioRiskPolicy>;
  asOf?: number;
}

export interface PortfolioRiskResult {
  allowed: boolean;
  reasons: string[];
  snapshot: PortfolioRiskSnapshot;
  projected: {
    equity: string;
    cashValue: string;
    holdingsValue: string;
    grossExposure: string;
    cashReservePercent: string;
    candidateAssetExposurePercent: string;
  };
}

export const DEFAULT_PORTFOLIO_RISK_POLICY: PortfolioRiskPolicy = {
  maxGrossExposurePercent: 100,
  maxSingleAssetExposurePercent: 25,
  minCashReservePercent: 10,
  maxOpenOrders: 5,
};

function mergePolicy(policy?: Partial<PortfolioRiskPolicy>): PortfolioRiskPolicy {
  return {
    ...DEFAULT_PORTFOLIO_RISK_POLICY,
    ...(policy || {}),
  };
}

function safeNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratioPercent(numerator: string, denominator: string): string {
  if (compareDecimals(denominator, "0") <= 0) return "0";
  const value = (safeNumber(numerator) / safeNumber(denominator)) * 100;
  return Number.isFinite(value) ? value.toFixed(2) : "0";
}

function exceedsPercent(numerator: string, denominator: string, percent: number): boolean {
  if (percent < 0) return true;
  if (compareDecimals(denominator, "0") <= 0) return compareDecimals(numerator, "0") > 0;
  return compareDecimals(
    multiplyDecimals(numerator, "100"),
    multiplyDecimals(denominator, normalizeDecimal(String(percent))),
  ) > 0;
}

function valueBalances(
  balances: WalletBalance[],
  baseCurrency: string,
  marks: PortfolioRiskMark[],
): {
  cash: string;
  holdings: string;
  assetValues: Map<string, string>;
  unpricedAssets: string[];
} {
  const base = baseCurrency.toUpperCase();
  const markByAsset = new Map(marks.map((mark) => [mark.asset.toUpperCase(), mark]));
  let cash = "0";
  let holdings = "0";
  const assetValues = new Map<string, string>();
  const unpricedAssets: string[] = [];

  for (const balance of balances) {
    const asset = balance.asset.toUpperCase();
    const total = normalizeDecimal(balance.total);
    if (asset === base) {
      cash = addDecimals(cash, total);
      assetValues.set(asset, addDecimals(assetValues.get(asset) || "0", total));
      continue;
    }

    if (compareDecimals(total, "0") === 0) continue;
    const mark = markByAsset.get(asset);
    if (!mark || compareDecimals(normalizeDecimal(mark.valueInBaseCurrency), "0") <= 0) {
      unpricedAssets.push(asset);
      continue;
    }

    const value = multiplyDecimals(total, normalizeDecimal(mark.valueInBaseCurrency));
    holdings = addDecimals(holdings, value);
    assetValues.set(asset, addDecimals(assetValues.get(asset) || "0", value));
  }

  return { cash, holdings, assetValues, unpricedAssets };
}

function orderExposure(openOrders: PortfolioRiskOrder[]): string {
  return openOrders.reduce(
    (sum, order) => addDecimals(sum, normalizeDecimal(order.notionalInBaseCurrency)),
    "0",
  );
}

export function evaluateSpotPortfolioRisk(request: PortfolioRiskRequest): PortfolioRiskResult {
  const policy = mergePolicy(request.policy);
  const base = request.baseCurrency.toUpperCase();
  const { cash, holdings, assetValues, unpricedAssets } = valueBalances(request.balances, base, request.marks);
  const openOrders = request.openOrders || [];
  const openOrderExposure = orderExposure(openOrders);
  const equity = addDecimals(cash, holdings);
  const snapshot: PortfolioRiskSnapshot = {
    baseCurrency: base,
    equity,
    cashValue: cash,
    holdingsValue: holdings,
    grossExposure: holdings,
    openOrderExposure,
    complete: unpricedAssets.length === 0,
    unpricedAssets,
    openOrders: openOrders.length,
    asOf: request.asOf ?? Date.now(),
  };

  const projectedNotional = request.candidate
    ? normalizeDecimal(request.candidate.notionalInBaseCurrency)
    : "0";
  let projectedCash = cash;
  let projectedHoldings = holdings;
  let projectedAssetValue = assetValues.get(request.candidate?.asset?.toUpperCase() || "") || "0";

  if (request.candidate) {
    const isBuyLike = request.candidate.side === "BUY";
    const quoteCashChange = projectedNotional;
    if (isBuyLike) {
      if (compareDecimals(projectedCash, quoteCashChange) >= 0) {
        projectedCash = subtractDecimals(projectedCash, quoteCashChange);
      } else {
        projectedCash = "0";
      }
      projectedHoldings = addDecimals(projectedHoldings, projectedNotional);
      projectedAssetValue = addDecimals(projectedAssetValue, projectedNotional);
    } else {
      projectedCash = addDecimals(projectedCash, projectedNotional);
      projectedHoldings = compareDecimals(projectedHoldings, projectedNotional) >= 0
        ? subtractDecimals(projectedHoldings, projectedNotional)
        : "0";
      projectedAssetValue = compareDecimals(projectedAssetValue, projectedNotional) >= 0
        ? subtractDecimals(projectedAssetValue, projectedNotional)
        : "0";
    }
  }

  const projectedEquity = addDecimals(projectedCash, projectedHoldings);
  const reasons: string[] = [];

  if (snapshot.unpricedAssets.length > 0) {
    reasons.push(
      "Portfolio valuation is incomplete because non-zero assets have no trusted base-currency marks: " +
      snapshot.unpricedAssets.join(", ") + ".",
    );
  }

  if (openOrders.length >= policy.maxOpenOrders && request.candidate) {
    reasons.push(`Open-order count ${openOrders.length} is already at the policy limit of ${policy.maxOpenOrders}.`);
  }

  const projectedGrossExposure = projectedHoldings;
  const projectedOpenOrderExposure = addDecimals(openOrderExposure, projectedNotional);
  if (exceedsPercent(projectedGrossExposure, projectedEquity, policy.maxGrossExposurePercent)) {
    reasons.push(
      `Projected gross asset exposure exceeds ${policy.maxGrossExposurePercent}% of equity.`,
    );
  }

  if (request.candidate && exceedsPercent(projectedAssetValue, projectedEquity, policy.maxSingleAssetExposurePercent)) {
    reasons.push(
      `Projected ${request.candidate.asset.toUpperCase()} exposure exceeds ${policy.maxSingleAssetExposurePercent}% of equity.`,
    );
  }

  if (request.candidate && request.candidate.side === "BUY" && exceedsPercent(projectedOpenOrderExposure, projectedEquity, policy.maxGrossExposurePercent)) {
    reasons.push(
      `Projected open-order exposure exceeds ${policy.maxGrossExposurePercent}% of equity.`,
    );
  }

  const reservePercent = ratioPercent(projectedCash, projectedEquity);
  if (request.candidate && Number(reservePercent) + 1e-9 < policy.minCashReservePercent) {
    reasons.push(
      `Projected base-currency cash reserve is ${reservePercent}%, below the policy minimum of ${policy.minCashReservePercent}%.`,
    );
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    snapshot,
    projected: {
      equity: projectedEquity,
      cashValue: projectedCash,
      holdingsValue: projectedHoldings,
      grossExposure: projectedGrossExposure,
      cashReservePercent: reservePercent,
      candidateAssetExposurePercent: request.candidate
        ? ratioPercent(projectedAssetValue, projectedEquity)
        : "0",
    },
  };
}
