import type { Instrument, OrderIntent, WalletBalance } from "./types";
import { compareDecimals, isMultipleOfStep, multiplyDecimals, normalizeDecimal } from "./decimal";

export interface TrustedQuote {
  bid: string;
  ask: string;
  updatedAt: number;
}

export interface OrderValidationResult {
  allowed: boolean;
  reasons: string[];
  referencePrice?: string;
  estimatedNotional?: string;
}

function positive(value: string | undefined): boolean {
  if (value === undefined) return false;
  try { return compareDecimals(normalizeDecimal(value), "0") > 0; } catch { return false; }
}

function minCheck(value: string, minimum?: string): boolean {
  return !minimum || compareDecimals(value, minimum) >= 0;
}

function maxCheck(value: string, maximum?: string): boolean {
  return !maximum || compareDecimals(value, maximum) <= 0;
}

function priceForOrder(order: OrderIntent, quote?: TrustedQuote): string | undefined {
  if (order.type === "MARKET") {
    if (!quote) return undefined;
    return quote.sidePrice;
  }
  if (order.type === "LIMIT" || order.type === "LIMIT_MAKER" || order.type === "STOP_LIMIT" || order.type === "TAKE_PROFIT_LIMIT") {
    return order.limitPrice;
  }
  return order.stopPrice;
}

export function validateSpotOrder(
  order: OrderIntent,
  instrument: Instrument,
  balances: WalletBalance[],
  quote?: (TrustedQuote & { sidePrice?: string }),
): OrderValidationResult {
  const reasons: string[] = [];
  const quantity = (() => {
    try { return normalizeDecimal(order.quantity); } catch { return null; }
  })();
  if (!quantity || compareDecimals(quantity, "0") <= 0) {
    reasons.push("Order quantity must be a positive decimal.");
    return { allowed: false, reasons };
  }

  if (!instrument.tradable || instrument.status !== "ACTIVE") {
    reasons.push("Instrument is not active/tradable according to the server catalog.");
  }

  if (!minCheck(quantity, instrument.minQuantity)) {
    reasons.push("Quantity is below the venue minimum.");
  }
  if (!maxCheck(quantity, instrument.maxQuantity)) {
    reasons.push("Quantity exceeds the venue maximum.");
  }
  if (instrument.lotSize && positive(instrument.lotSize) && !isMultipleOfStep(quantity, instrument.lotSize)) {
    reasons.push("Quantity does not conform to the venue lot size.");
  }

  const price = priceForOrder(order, quote);
  if (!price) {
    reasons.push(order.type === "MARKET"
      ? "Trusted bid/ask data is required before a market order can be submitted."
      : "The selected order type requires a price.");
  } else if (!positive(price)) {
    reasons.push("Order price must be positive.");
  } else if (instrument.tickSize && positive(instrument.tickSize) && !isMultipleOfStep(normalizeDecimal(price), instrument.tickSize)) {
    reasons.push("Price does not conform to the venue tick size.");
  }

  const notional = price ? multiplyDecimals(quantity, normalizeDecimal(price)) : undefined;
  if (notional && instrument.minNotional && compareDecimals(notional, instrument.minNotional) < 0) {
    reasons.push("Estimated order notional is below the venue minimum.");
  }

  const balancesByAsset = new Map(balances.map((balance) => [balance.asset.toUpperCase(), balance]));
  if (order.side === "BUY" && instrument.quoteAsset && notional) {
    const freeQuote = balancesByAsset.get(instrument.quoteAsset.toUpperCase())?.free;
    if (!freeQuote || compareDecimals(normalizeDecimal(freeQuote), notional) < 0) {
      reasons.push("Insufficient free quote-asset balance for the estimated order notional.");
    }
  }
  if (order.side === "SELL" && instrument.baseAsset) {
    const freeBase = balancesByAsset.get(instrument.baseAsset.toUpperCase())?.free;
    if (!freeBase || compareDecimals(normalizeDecimal(freeBase), quantity) < 0) {
      reasons.push("Insufficient free base-asset balance for the requested quantity.");
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    referencePrice: price,
    estimatedNotional: notional,
  };
}
