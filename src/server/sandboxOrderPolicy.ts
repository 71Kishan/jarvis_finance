import { createHash } from "crypto";
import type { AccountConnection, Instrument, OrderIntent, WalletBalance } from "../platform/types";
interface TrustedQuote {
  bid: string;
  ask: string;
  updatedAt: number;
}

function normalizeDecimal(value: string): string {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("Invalid positive decimal.");
  const [integer, fraction = ""] = text.split(".");
  return integer.replace(/^0+(?=\d)/, "") + (fraction ? "." + fraction.replace(/0+$/, "") : "");
}

function compareDecimals(left: string, right: string): number {
  const normalize = (value: string) => {
    const n = normalizeDecimal(value);
    const [i, f = ""] = n.split(".");
    return { i, f };
  };
  const a = normalize(left);
  const b = normalize(right);
  if (a.i.length !== b.i.length) return a.i.length > b.i.length ? 1 : -1;
  if (a.i !== b.i) return a.i > b.i ? 1 : -1;
  const scale = Math.max(a.f.length, b.f.length);
  const af = a.f.padEnd(scale, "0");
  const bf = b.f.padEnd(scale, "0");
  return af === bf ? 0 : af > bf ? 1 : -1;
}

function multiplyDecimals(left: string, right: string): string {
  const a = normalizeDecimal(left);
  const b = normalizeDecimal(right);
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const scale = af.length + bf.length;
  const units = BigInt(ai + af) * BigInt(bi + bf);
  const digits = units.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const point = digits.length - scale;
  return digits.slice(0, point) + "." + digits.slice(point).replace(/0+$/, "");
}

function validateBasicSpotOrder(
  order: OrderIntent,
  instrument: Instrument,
  balances: WalletBalance[],
  quote?: TrustedQuote,
): { allowed: boolean; reasons: string[]; referencePrice?: string; estimatedNotional?: string } {
  const reasons: string[] = [];
  let quantity = "";
  try {
    quantity = normalizeDecimal(order.quantity);
    if (compareDecimals(quantity, "0") <= 0) reasons.push("Order quantity must be positive.");
  } catch {
    reasons.push("Order quantity must be a valid positive decimal.");
  }

  if (!instrument.tradable || instrument.status !== "ACTIVE") {
    reasons.push("Instrument is not active/tradable according to the server catalog.");
  }

  if (instrument.minQuantity && compareDecimals(quantity || "0", normalizeDecimal(instrument.minQuantity)) < 0) {
    reasons.push("Quantity is below the venue minimum.");
  }
  if (instrument.maxQuantity && compareDecimals(quantity || "0", normalizeDecimal(instrument.maxQuantity)) > 0) {
    reasons.push("Quantity exceeds the venue maximum.");
  }
  if (instrument.lotSize) {
    try {
      const q = normalizeDecimal(quantity);
      const step = normalizeDecimal(instrument.lotSize);
      const [qi, qf = ""] = q.split(".");
      const [si, sf = ""] = step.split(".");
      const scale = Math.max(qf.length, sf.length);
      const qu = BigInt(qi + qf.padEnd(scale, "0"));
      const su = BigInt(si + sf.padEnd(scale, "0"));
      if (su > 0n && qu % su !== 0n) reasons.push("Quantity does not conform to the venue lot size.");
    } catch {
      reasons.push("Quantity/lot-size precision could not be validated.");
    }
  }

  let referencePrice: string | undefined;
  if (order.type === "MARKET") {
    referencePrice = order.side === "BUY" ? quote?.ask : quote?.bid;
    if (!referencePrice) reasons.push("A fresh trusted bid/ask is required for a market order.");
  } else if (["LIMIT", "LIMIT_MAKER", "STOP_LIMIT", "TAKE_PROFIT_LIMIT"].includes(order.type)) {
    referencePrice = order.limitPrice;
    if (!referencePrice) reasons.push("Limit-style orders require a limit price.");
  } else if (["STOP", "TAKE_PROFIT"].includes(order.type)) {
    referencePrice = quote?.ask || quote?.bid;
    if (!order.stopPrice) reasons.push("Trigger orders require a stop price.");
  }

  if (referencePrice) {
    try {
      const price = normalizeDecimal(referencePrice);
      if (compareDecimals(price, "0") <= 0) reasons.push("Reference price must be positive.");
      if (instrument.tickSize) {
        const [pi, pf = ""] = price.split(".");
        const [ti, tf = ""] = normalizeDecimal(instrument.tickSize).split(".");
        const scale = Math.max(pf.length, tf.length);
        const pu = BigInt(pi + pf.padEnd(scale, "0"));
        const tu = BigInt(ti + tf.padEnd(scale, "0"));
        if (tu > 0n && pu % tu !== 0n) reasons.push("Price does not conform to the venue tick size.");
      }
      const notional = multiplyDecimals(quantity, price);
      if (instrument.minNotional && compareDecimals(notional, normalizeDecimal(instrument.minNotional)) < 0) {
        reasons.push("Estimated order notional is below the venue minimum.");
      }
      if (order.side === "BUY" && instrument.quoteAsset) {
        const balance = balances.find((item) => item.asset.toUpperCase() === instrument.quoteAsset!.toUpperCase());
        if (!balance || compareDecimals(normalizeDecimal(balance.free), notional) < 0) {
          reasons.push("Insufficient free quote-asset balance for the estimated order notional.");
        }
      }
      if (order.side === "SELL" && instrument.baseAsset) {
        const balance = balances.find((item) => item.asset.toUpperCase() === instrument.baseAsset!.toUpperCase());
        if (!balance || compareDecimals(normalizeDecimal(balance.free), quantity) < 0) {
          reasons.push("Insufficient free base-asset balance for the requested quantity.");
        }
      }
      return { allowed: reasons.length === 0, reasons, referencePrice: price, estimatedNotional: notional };
    } catch {
      reasons.push("Price/notional could not be validated.");
    }
  }

  return { allowed: reasons.length === 0, reasons, referencePrice };
}

export interface SandboxOrderPolicyOptions {
  maxNotional?: string;
  maxOpenOrders?: number;
  maxOrderQuantity?: string;
}

export interface SandboxOrderPolicyInput {
  order: OrderIntent;
  account: AccountConnection;
  instrument: Instrument;
  balances: WalletBalance[];
  quote?: TrustedQuote;
  openOrderCount?: number;
  options?: SandboxOrderPolicyOptions;
}

export interface SandboxOrderPolicyResult {
  allowed: boolean;
  reasons: string[];
  referencePrice?: string;
  estimatedNotional?: string;
  risk: {
    maxNotional: string;
    maxOpenOrders: number;
  };
}

export function isSandboxOrderSubmissionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.JARVIS_SANDBOX_ORDER_SUBMISSION_ENABLED === "true" &&
    env.JARVIS_BINANCE_TESTNET_ENABLE_ORDERS === "true" &&
    env.JARVIS_BINANCE_TESTNET_ONLY !== "false"
  );
}

export function fingerprintOrderIntent(order: OrderIntent): string {
  const canonical = [
    order.accountId,
    order.instrumentId,
    order.side,
    order.type,
    normalizeDecimal(order.quantity),
    order.limitPrice ? normalizeDecimal(order.limitPrice) : "",
    order.stopPrice ? normalizeDecimal(order.stopPrice) : "",
    order.timeInForce || "",
    order.reduceOnly ? "1" : "0",
    order.strategyId || "",
    order.strategyVersion == null ? "" : String(order.strategyVersion),
    order.reason || "",
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function deriveClientOrderId(userId: string, accountId: string, idempotencyKey: string): string {
  const digest = createHash("sha256")
    .update(userId + "|" + accountId + "|" + idempotencyKey, "utf8")
    .digest("hex");
  return "jrv_" + digest.slice(0, 28);
}

export function evaluateSandboxOrderPolicy(
  input: SandboxOrderPolicyInput,
): SandboxOrderPolicyResult {
  const maxNotional = input.options?.maxNotional || process.env.JARVIS_SANDBOX_MAX_NOTIONAL_USD || "100";
  const maxOpenOrders = Math.max(
    1,
    Math.min(100, input.options?.maxOpenOrders ?? (Number(process.env.JARVIS_SANDBOX_MAX_OPEN_ORDERS) || 10)),
  );

  const reasons: string[] = [];
  const validation = validateBasicSpotOrder(input.order, input.instrument, input.balances, input.quote);
  reasons.push(...validation.reasons);

  if (input.account.provider !== "BINANCE_SPOT_TESTNET") {
    reasons.push("Sandbox order submission is restricted to the Binance Spot Testnet provider.");
  }
  if (input.account.status !== "CONNECTED") {
    reasons.push("The provider account is not in CONNECTED state.");
  }
  if (!input.account.permissions.includes("READ")) {
    reasons.push("The authenticated account connection has not been confirmed readable.");
  }
  if (!input.account.permissions.includes("TRADE")) {
    reasons.push("The provider has not confirmed trade permission.");
  }
  if (input.account.permissions.includes("WITHDRAW")) {
    reasons.push("Connected provider credentials include withdrawal permission; Jarvis sandbox orders do not require withdrawal authority.");
  }

  const supportedTypes = new Set(["MARKET", "LIMIT", "LIMIT_MAKER", "STOP", "STOP_LIMIT", "TAKE_PROFIT", "TAKE_PROFIT_LIMIT"]);
  if (!supportedTypes.has(input.order.type)) {
    reasons.push("Unsupported order type for the sandbox execution service.");
  }

  if (input.openOrderCount !== undefined && input.openOrderCount >= maxOpenOrders) {
    reasons.push("Sandbox open-order ceiling has been reached.");
  }

  if (validation.estimatedNotional) {
    try {
      if (compareDecimals(validation.estimatedNotional, normalizeDecimal(maxNotional)) > 0) {
        reasons.push("Estimated sandbox order notional exceeds the server safety cap.");
      }
    } catch {
      reasons.push("Configured sandbox notional cap is invalid.");
    }
  }

  if (input.options?.maxOrderQuantity) {
    try {
      if (compareDecimals(normalizeDecimal(input.order.quantity), normalizeDecimal(input.options.maxOrderQuantity)) > 0) {
        reasons.push("Order quantity exceeds the server quantity safety cap.");
      }
    } catch {
      reasons.push("Configured sandbox quantity cap is invalid.");
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    referencePrice: validation.referencePrice,
    estimatedNotional: validation.estimatedNotional,
    risk: { maxNotional, maxOpenOrders },
  };
}
