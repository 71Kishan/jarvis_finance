import { createHash } from "crypto";
import type { AccountConnection, Instrument, OrderIntent, WalletBalance } from "../platform/types";
import { compareDecimals, normalizeDecimal } from "../platform/decimal";
import { validateSpotOrder, type TrustedQuote } from "../platform/orderValidation";

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
  const validation = validateSpotOrder(input.order, input.instrument, input.balances, input.quote);
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
