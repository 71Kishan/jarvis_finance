import { createHmac, randomUUID } from "crypto";
import type {
  AccountConnection,
  AdapterHealth,
  BrokerOrder,
  ExecutionAdapter,
  Fill,
  OrderIntent,
  OrderStatus,
  PortfolioPosition,
  WalletBalance,
} from "./types";

const DEFAULT_TESTNET_BASE_URL = "https://testnet.binance.vision";
const DEFAULT_RECV_WINDOW = 5_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface BinanceBalance {
  asset?: string;
  free?: string;
  locked?: string;
}

interface BinanceAccountResponse {
  accountType?: string;
  canTrade?: boolean;
  canWithdraw?: boolean;
  canDeposit?: boolean;
  updateTime?: number;
  balances?: BinanceBalance[];
  permissions?: string[];
}

interface BinanceOrderFillResponse {
  price?: string;
  qty?: string;
  commission?: string;
  commissionAsset?: string;
  tradeId?: number;
}

interface BinanceOrderResponse {
  symbol?: string;
  orderId?: number;
  clientOrderId?: string;
  price?: string;
  origQty?: string;
  executedQty?: string;
  cummulativeQuoteQty?: string;
  status?: string;
  timeInForce?: string;
  type?: string;
  side?: "BUY" | "SELL";
  time?: number;
  updateTime?: number;
  transactTime?: number;
  stopPrice?: string;
  fills?: BinanceOrderFillResponse[];
}

interface ReadOnlyAccountSnapshot {
  account: BinanceAccountResponse;
  balances: WalletBalance[];
  openOrders: BrokerOrder[];
}

export function buildBinanceSignature(
  secret: string,
  params: Array<[string, string]>,
): string {
  const payload = params
    .map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value))
    .join("&");

  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function requireFiniteTimestamp(value: unknown): number {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error("Binance returned an invalid timestamp.");
  }
  return timestamp;
}

function mapOrderStatus(status: unknown): OrderStatus {
  switch (String(status || "").toUpperCase()) {
    case "NEW":
      return "SUBMITTED";
    case "PARTIALLY_FILLED":
      return "PARTIALLY_FILLED";
    case "FILLED":
      return "FILLED";
    case "CANCELED":
      return "CANCELLED";
    case "REJECTED":
      return "REJECTED";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return "UNKNOWN_RECONCILIATION";
  }
}

export interface BinanceSpotAccountAdapterOptions {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  accountId?: string;
  recvWindowMs?: number;
  testnetOnly?: boolean;
}

export class BinanceSpotAccountAdapter implements ExecutionAdapter {
  public readonly provider = "BINANCE_SPOT_TESTNET";

  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;
  private readonly baseUrl: string;
  private readonly accountId: string;
  private readonly recvWindowMs: number;
  private readonly testnetOnly: boolean;
  private readonly ordersEnabled: boolean;
  private serverTimeOffsetMs = 0;

  private lastSuccessfulSyncAt: number | undefined;
  private lastErrorAt: number | undefined;
  private lastError: string | undefined;

  constructor(options: BinanceSpotAccountAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.JARVIS_BINANCE_TESTNET_API_KEY;
    this.apiSecret = options.apiSecret ?? process.env.JARVIS_BINANCE_TESTNET_API_SECRET;
    this.baseUrl = (options.baseUrl ?? process.env.JARVIS_BINANCE_TESTNET_BASE_URL ?? DEFAULT_TESTNET_BASE_URL).replace(/\/$/, "");
    this.accountId = options.accountId ?? process.env.JARVIS_BINANCE_TESTNET_ACCOUNT_ID ?? "binance-testnet-local";
    this.recvWindowMs = Math.min(
      60_000,
      Math.max(1_000, options.recvWindowMs ?? (Number(process.env.JARVIS_BINANCE_RECV_WINDOW_MS) || DEFAULT_RECV_WINDOW)),
    );
    this.testnetOnly = options.testnetOnly ?? process.env.JARVIS_BINANCE_TESTNET_ONLY !== "false";
    this.ordersEnabled = process.env.JARVIS_BINANCE_TESTNET_ENABLE_ORDERS === "true";

    if (this.testnetOnly) {
      const hostname = new URL(this.baseUrl).hostname;
      if (hostname !== "testnet.binance.vision") {
        throw new Error("Binance account adapter is locked to testnet.binance.vision while testnet-only mode is enabled.");
      }
    }
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  public getAccountId(): string {
    return this.accountId;
  }

  public isOrderExecutionEnabled(): boolean {
    return this.testnetOnly && this.ordersEnabled;
  }

  public getHealth(): Promise<AdapterHealth> {
    return Promise.resolve({
      provider: this.provider,
      connected: this.isConfigured(),
      authenticated: Boolean(this.isConfigured() && this.lastSuccessfulSyncAt),
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    });
  }

  public async syncReadOnlyAccount(): Promise<ReadOnlyAccountSnapshot> {
    const account = await this.signedGet<BinanceAccountResponse>("/api/v3/account");
    const balances = (Array.isArray(account.balances) ? account.balances : [])
      .filter((row) => {
        const free = Number(row.free || 0);
        const locked = Number(row.locked || 0);
        return free !== 0 || locked !== 0;
      })
      .map((row) => {
        const asset = String(row.asset || "").trim().toUpperCase();
        if (!asset) throw new Error("Binance returned a balance without an asset.");
        return {
          accountId: this.accountId,
          asset,
          free: String(row.free ?? "0"),
          locked: String(row.locked ?? "0"),
          total: "0",
          updatedAt: requireFiniteTimestamp(account.updateTime ?? Date.now()),
        } satisfies WalletBalance;
      })
      .map((balance) => ({
        ...balance,
        total: addDecimalStrings(balance.free, balance.locked),
      }));

    const openOrders = await this.getOpenOrders(this.accountId);
    this.lastSuccessfulSyncAt = Date.now();
    this.lastError = undefined;

    return { account, balances, openOrders };
  }

  public async getBalances(accountId: string): Promise<WalletBalance[]> {
    this.assertAccount(accountId);
    const snapshot = await this.syncReadOnlyAccount();
    return snapshot.balances;
  }

  public async getPositions(accountId: string): Promise<PortfolioPosition[]> {
    this.assertAccount(accountId);
    // Spot custody is represented by WalletBalance. Leveraged/margin positions
    // require a different account model and adapter and are not inferred here.
    return [];
  }

  public async getOpenOrders(accountId: string): Promise<BrokerOrder[]> {
    this.assertAccount(accountId);
    const payload = await this.signedGet<BinanceOrderResponse[]>("/api/v3/openOrders");
    return (Array.isArray(payload) ? payload : []).map((row) => this.mapOrder(row));
  }

  public async getOrderByClientOrderId(
    accountId: string,
    clientOrderId: string,
    instrumentId?: string,
  ): Promise<BrokerOrder | null> {
    this.assertAccount(accountId);
    const symbol = this.symbolFromInstrumentId(instrumentId);
    if (!symbol) {
      throw new Error("Instrument id is required to reconcile a Binance Spot order by client order id.");
    }

    try {
      const payload = await this.signedGet<BinanceOrderResponse>("/api/v3/order", [
        ["symbol", symbol],
        ["origClientOrderId", clientOrderId],
      ]);
      return this.mapOrder(payload);
    } catch (error: any) {
      if (Number(error?.binanceCode) === -2013 || Number(error?.binanceCode) === -2011) {
        return null;
      }
      throw error;
    }
  }

  public async submitOrder(order: OrderIntent): Promise<BrokerOrder> {
    this.assertOrderExecutionEnabled();
    this.assertAccount(order.accountId);

    const symbol = this.symbolFromInstrumentId(order.instrumentId);
    if (!symbol) throw new Error("Binance Spot order requires a canonical Binance instrument id.");
    if (order.reduceOnly) throw new Error("Binance Spot does not support reduceOnly semantics on this adapter.");

    const params = this.orderParams(order, symbol);
    const response = await this.signedRequest<BinanceOrderResponse>("POST", "/api/v3/order", params);
    return this.mapOrder(response);
  }

  public async cancelOrder(accountId: string, clientOrderId: string, instrumentId?: string): Promise<BrokerOrder> {
    this.assertOrderExecutionEnabled();
    this.assertAccount(accountId);

    const symbol = this.symbolFromInstrumentId(instrumentId);
    if (!symbol) throw new Error("Binance Spot order cancellation requires the canonical instrument id.");

    const existing = await this.getOrderByClientOrderId(accountId, clientOrderId, instrumentId);
    if (!existing) throw new Error("Binance order was not found during cancellation preflight.");

    const response = await this.signedRequest<BinanceOrderResponse>("DELETE", "/api/v3/order", [
      ["symbol", symbol],
      ["origClientOrderId", clientOrderId],
    ]);
    return this.mapOrder(response);
  }

  private async signedGet<T>(pathname: string, extraParams: Array<[string, string]> = []): Promise<T> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Binance Spot testnet API credentials are not configured on the server.");
    }

    try {
      await this.refreshServerTime();
      const params: Array<[string, string]> = [
        ...extraParams,
        ["recvWindow", String(this.recvWindowMs)],
        ["timestamp", String(Date.now() + this.serverTimeOffsetMs)],
      ];
      const signature = buildBinanceSignature(this.apiSecret, params);
      params.push(["signature", signature]);

      const query = params
        .map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value))
        .join("&");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(this.baseUrl + pathname + "?" + query, {
          headers: {
            Accept: "application/json",
            "X-MBX-APIKEY": this.apiKey,
            "User-Agent": "JarvisFinance/1.0",
          },
          signal: controller.signal,
        });
        const raw = await response.text();
        let body: any = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          body = { msg: raw };
        }

        if (!response.ok) {
          const code = Number(body?.code);
          const message = typeof body?.msg === "string" ? body.msg : "Binance authenticated request failed.";
          throw new Error(
            Number.isFinite(code) ? "Binance error " + code + ": " + message : message,
          );
        }

        return body as T;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error: any) {
      this.lastErrorAt = Date.now();
      this.lastError = error?.message || "Binance authenticated request failed.";
      throw error;
    }
  }

  private async signedRequest<T>(
    method: "POST" | "DELETE",
    pathname: string,
    extraParams: Array<[string, string]> = [],
  ): Promise<T> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Binance Spot testnet API credentials are not configured on the server.");
    }

    try {
      await this.refreshServerTime();
      const params: Array<[string, string]> = [
        ...extraParams,
        ["recvWindow", String(this.recvWindowMs)],
        ["timestamp", String(Date.now() + this.serverTimeOffsetMs)],
      ];
      const signature = buildBinanceSignature(this.apiSecret, params);
      params.push(["signature", signature]);

      const query = params
        .map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value))
        .join("&");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(this.baseUrl + pathname + "?" + query, {
          method,
          headers: {
            Accept: "application/json",
            "X-MBX-APIKEY": this.apiKey,
            "User-Agent": "JarvisFinance/1.0",
          },
          signal: controller.signal,
        });
        const raw = await response.text();
        let body: any = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          body = { msg: raw };
        }

        if (!response.ok) {
          const code = Number(body?.code);
          const message = typeof body?.msg === "string" ? body.msg : "Binance order request failed.";
          const error: any = new Error(
            Number.isFinite(code) ? "Binance error " + code + ": " + message : message,
          );
          error.binanceCode = Number.isFinite(code) ? code : undefined;
          error.executionUnknown = response.status >= 500 || code === -1000 || code === -1001 || code === -1006 || code === -1007;
          throw error;
        }

        return body as T;
      } catch (error: any) {
        if (error?.name === "AbortError") {
          error.executionUnknown = true;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error: any) {
      this.lastErrorAt = Date.now();
      this.lastError = error?.message || "Binance signed order request failed.";
      throw error;
    }
  }

  private async refreshServerTime(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.baseUrl + "/api/v3/time", {
        headers: { Accept: "application/json", "User-Agent": "JarvisFinance/1.0" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Binance time endpoint HTTP " + response.status);
      const body = await response.json() as { serverTime?: number };
      const serverTime = Number(body?.serverTime);
      if (!Number.isFinite(serverTime)) throw new Error("Binance time endpoint returned an invalid timestamp.");
      this.serverTimeOffsetMs = serverTime - Date.now();
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertOrderExecutionEnabled(): void {
    if (!this.testnetOnly) {
      throw new Error("Binance order execution is blocked unless testnet-only mode is enabled.");
    }
    if (!this.ordersEnabled) {
      throw new Error("Binance Spot testnet order execution is disabled by operator policy.");
    }
  }

  private symbolFromInstrumentId(instrumentId?: string): string | null {
    const value = String(instrumentId || "").trim().toUpperCase();
    const parts = value.split(":");
    if (parts.length !== 3) return null;
    if (parts[0] !== "BINANCE_SPOT" || parts[1] !== "BINANCE") return null;
    return parts[2] || null;
  }

  private orderParams(order: OrderIntent, symbol: string): Array<[string, string]> {
    const type = order.type;
    const side = order.side;
    const params: Array<[string, string]> = [
      ["symbol", symbol],
      ["side", side],
      ["quantity", order.quantity],
      ["newClientOrderId", order.clientOrderId],
    ];

    switch (type) {
      case "MARKET":
        params.push(["type", "MARKET"]);
        break;
      case "LIMIT":
        params.push(["type", "LIMIT"]);
        if (!order.limitPrice || !order.timeInForce) throw new Error("LIMIT orders require limitPrice and timeInForce.");
        params.push(["timeInForce", order.timeInForce], ["price", order.limitPrice]);
        break;
      case "LIMIT_MAKER":
        params.push(["type", "LIMIT_MAKER"]);
        if (!order.limitPrice) throw new Error("LIMIT_MAKER orders require limitPrice.");
        params.push(["price", order.limitPrice]);
        break;
      case "STOP":
        params.push(["type", "STOP_LOSS"]);
        if (!order.stopPrice) throw new Error("STOP orders require stopPrice.");
        params.push(["stopPrice", order.stopPrice]);
        break;
      case "STOP_LIMIT":
        params.push(["type", "STOP_LOSS_LIMIT"]);
        if (!order.stopPrice || !order.limitPrice || !order.timeInForce) {
          throw new Error("STOP_LIMIT orders require stopPrice, limitPrice and timeInForce.");
        }
        params.push(["timeInForce", order.timeInForce], ["price", order.limitPrice], ["stopPrice", order.stopPrice]);
        break;
      case "TAKE_PROFIT":
        params.push(["type", "TAKE_PROFIT"]);
        if (!order.stopPrice) throw new Error("TAKE_PROFIT orders require stopPrice.");
        params.push(["stopPrice", order.stopPrice]);
        break;
      case "TAKE_PROFIT_LIMIT":
        params.push(["type", "TAKE_PROFIT_LIMIT"]);
        if (!order.stopPrice || !order.limitPrice || !order.timeInForce) {
          throw new Error("TAKE_PROFIT_LIMIT orders require stopPrice, limitPrice and timeInForce.");
        }
        params.push(["timeInForce", order.timeInForce], ["price", order.limitPrice], ["stopPrice", order.stopPrice]);
        break;
      default:
        throw new Error("Unsupported Binance Spot order type: " + type);
    }

    return params;
  }

  private assertAccount(accountId: string): void {
    if (accountId !== this.accountId) {
      throw new Error("Unknown Binance Spot testnet account id.");
    }
  }

  private mapOrder(row: BinanceOrderResponse): BrokerOrder {
    const symbol = String(row.symbol || "").trim().toUpperCase();
    const side = row.side === "SELL" ? "SELL" : "BUY";
    const type = String(row.type || "LIMIT").toUpperCase();

    if (!symbol || !row.clientOrderId || !row.orderId) {
      throw new Error("Binance returned an open order missing required identifiers.");
    }

    const fills = (Array.isArray(row.fills) ? row.fills : [])
      .filter((fill) => Number(fill?.qty) > 0 && Number(fill?.price) > 0)
      .map((fill) => ({
        id: randomUUID(),
        accountId: this.accountId,
        orderClientId: row.clientOrderId!,
        externalOrderId: String(row.orderId),
        externalTradeId: Number(fill.tradeId) > 0 ? String(fill.tradeId) : undefined,
        instrumentId: "BINANCE_SPOT:BINANCE:" + symbol,
        side,
        quantity: String(fill.qty),
        price: String(fill.price),
        feeAmount: fill.commission ? String(fill.commission) : undefined,
        feeAsset: fill.commissionAsset ? String(fill.commissionAsset).toUpperCase() : undefined,
        liquidity: "UNKNOWN" as const,
        executedAt: Number(row.transactTime || row.updateTime || row.time) > 0
          ? Number(row.transactTime || row.updateTime || row.time)
          : Date.now(),
      } satisfies Fill));

    return {
      clientOrderId: row.clientOrderId,
      accountId: this.accountId,
      instrumentId: "BINANCE_SPOT:BINANCE:" + symbol,
      side,
      type: normalizeOrderType(type),
      quantity: String(row.origQty ?? "0"),
      limitPrice: row.price && Number(row.price) > 0 ? String(row.price) : undefined,
      stopPrice: row.stopPrice && Number(row.stopPrice) > 0 ? String(row.stopPrice) : undefined,
      timeInForce: normalizeTimeInForce(row.timeInForce),
      status: mapOrderStatus(row.status),
      filledQuantity: String(row.executedQty ?? "0"),
      averageFillPrice:
        Number(row.executedQty ?? 0) > 0 && Number(row.cummulativeQuoteQty ?? 0) > 0
          ? divideDecimalStrings(String(row.cummulativeQuoteQty), String(row.executedQty))
          : undefined,
      requestedAt: Number(row.time) > 0 ? Number(row.time) : Date.now(),
      submittedAt: Number(row.transactTime || row.time) > 0 ? Number(row.transactTime || row.time) : undefined,
      updatedAt: Number(row.updateTime) > 0 ? Number(row.updateTime) : Date.now(),
      externalOrderId: String(row.orderId),
      fills,
    };
  }
}

function normalizeOrderType(type: string): OrderIntent["type"] {
  switch (type) {
    case "MARKET":
    case "LIMIT":
    case "STOP":
    case "STOP_LIMIT":
    case "TAKE_PROFIT":
    case "TAKE_PROFIT_LIMIT":
      return type;
    case "STOP_LOSS":
      return "STOP";
    case "STOP_LOSS_LIMIT":
      return "STOP_LIMIT";
    case "LIMIT_MAKER":
      return "LIMIT_MAKER";
    default:
      throw new Error("Unsupported Binance Spot order type: " + type);
  }
}

function normalizeTimeInForce(value: unknown): OrderIntent["timeInForce"] | undefined {
  switch (String(value || "").toUpperCase()) {
    case "GTC":
      return "GTC";
    case "IOC":
      return "IOC";
    case "FOK":
      return "FOK";
    case "GTX":
      return "GTX";
    case "DAY":
      return "DAY";
    default:
      return undefined;
  }
}

function addDecimalStrings(left: string, right: string): string {
  const [li, lf = ""] = left.split(".");
  const [ri, rf = ""] = right.split(".");
  const scale = Math.max(lf.length, rf.length);
  const leftInt = BigInt((li || "0") + lf.padEnd(scale, "0"));
  const rightInt = BigInt((ri || "0") + rf.padEnd(scale, "0"));
  const total = leftInt + rightInt;
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  if (scale === 0) return (negative ? "-" : "") + digits;
  const point = digits.length - scale;
  return (negative ? "-" : "") + digits.slice(0, point) + "." + digits.slice(point);
}

function divideDecimalStrings(numerator: string, denominator: string): string {
  const [numInt, numFrac = ""] = numerator.split(".");
  const [denInt, denFrac = ""] = denominator.split(".");
  if (!/^\\d+$/.test(numInt || "") || !/^\\d*$/.test(numFrac) || !/^\\d+$/.test(denInt || "") || !/^\\d*$/.test(denFrac)) {
    return "0";
  }

  const scale = 18;
  const numeratorScale = numFrac.length;
  const denominatorScale = denFrac.length;
  const numeratorUnits = BigInt((numInt || "0") + numFrac);
  const denominatorUnits = BigInt((denInt || "0") + denFrac);
  if (denominatorUnits === 0n) return "0";

  const exponent = scale + denominatorScale - numeratorScale;
  const scaledNumerator = exponent >= 0
    ? numeratorUnits * 10n ** BigInt(exponent)
    : numeratorUnits / 10n ** BigInt(-exponent);

  const quotient = scaledNumerator / denominatorUnits;
  const digits = quotient.toString().padStart(scale + 1, "0");
  const point = digits.length - scale;
  return digits.slice(0, point) + "." + digits.slice(point).replace(/0+$/, "") || "0";
}
