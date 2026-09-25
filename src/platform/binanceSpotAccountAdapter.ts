import { createHmac } from "crypto";
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
  stopPrice?: string;
}

interface ReadOnlyAccountSnapshot {
  account: BinanceAccountResponse;
  balances: WalletBalance[];
  openOrders: BrokerOrder[];
}

interface BinanceTradeResponse {
  symbol?: string;
  id?: number;
  orderId?: number;
  orderListId?: number;
  price?: string;
  qty?: string;
  quoteQty?: string;
  commission?: string;
  commissionAsset?: string;
  time?: number;
  isBuyer?: boolean;
  isMaker?: boolean;
  isBestMatch?: boolean;
}

export type BinanceProviderErrorKind =
  | "AUTHENTICATION"
  | "INVALID_ORDER"
  | "INSUFFICIENT_BALANCE"
  | "DUPLICATE_CLIENT_ORDER"
  | "UNKNOWN_ORDER"
  | "TIMESTAMP"
  | "RATE_LIMIT"
  | "NETWORK"
  | "SERVER"
  | "UNKNOWN";

export class BinanceProviderError extends Error {
  public readonly kind: BinanceProviderErrorKind;
  public readonly code?: number;
  public readonly httpStatus?: number;

  constructor(
    message: string,
    kind: BinanceProviderErrorKind,
    options: { code?: number; httpStatus?: number } = {},
  ) {
    super(message);
    this.name = "BinanceProviderError";
    this.kind = kind;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
  }
}

export function classifyBinanceError(code: number | undefined, httpStatus: number | undefined, message: string, network = false): BinanceProviderErrorKind {
  if (network) return "NETWORK";
  if (code === -2015 || httpStatus === 401 || httpStatus === 403) return "AUTHENTICATION";
  if (code === -2010 || code === -1013 || code === -1100 || code === -1101 || code === -1102 || code === -1111 || code === -1116 || code === -1121) return "INVALID_ORDER";
  if (code === -2019 || /insufficient|balance/i.test(message)) return "INSUFFICIENT_BALANCE";
  if (code === -2013 || /order does not exist|unknown order/i.test(message)) return "UNKNOWN_ORDER";
  if (code === -2018 || /duplicate.*client|client.*order.*id/i.test(message)) return "DUPLICATE_CLIENT_ORDER";
  if (code === -1021 || /timestamp|recvwindow/i.test(message)) return "TIMESTAMP";
  if (httpStatus === 418 || httpStatus === 429 || code === -1003) return "RATE_LIMIT";
  if ((httpStatus !== undefined && httpStatus >= 500) || (code !== undefined && code <= -1000 && code !== -1003)) return "SERVER";
  return "UNKNOWN";
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
  enableOrderSubmission?: boolean;
}

export class BinanceSpotAccountAdapter implements ExecutionAdapter {
  public readonly provider = "BINANCE_SPOT_TESTNET";

  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;
  private readonly baseUrl: string;
  private readonly accountId: string;
  private readonly recvWindowMs: number;
  private readonly testnetOnly: boolean;
  private readonly enableOrderSubmission: boolean;
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
    this.enableOrderSubmission = options.enableOrderSubmission ?? process.env.JARVIS_BINANCE_TESTNET_ENABLE_ORDERS === "true";

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

  public async submitOrder(order: OrderIntent): Promise<BrokerOrder> {
    this.assertAccount(order.accountId);
    this.assertOrderSubmissionAllowed();
    if (!this.isConfigured()) {
      throw new BinanceProviderError(
        "Binance Spot testnet API credentials are not configured on the server.",
        "AUTHENTICATION",
      );
    }

    const symbol = this.extractProviderSymbol(order.instrumentId);
    const params: Array<[string, string]> = [
      ["symbol", symbol],
      ["side", order.side],
      ["type", this.toBinanceOrderType(order.type)],
      ["quantity", order.quantity],
      ["newClientOrderId", order.clientOrderId],
    ];

    if (order.limitPrice) params.push(["price", order.limitPrice]);
    if (order.stopPrice) params.push(["stopPrice", order.stopPrice]);

    const timeInForce = this.toBinanceTimeInForce(order);
    if (timeInForce) params.push(["timeInForce", timeInForce]);

    const response = await this.signedRequest<BinanceOrderResponse>("POST", "/api/v3/order", params);
    return this.mapOrder(response);
  }

  public async cancelOrder(accountId: string, clientOrderId: string): Promise<BrokerOrder> {
    this.assertAccount(accountId);
    this.assertOrderSubmissionAllowed();

    const openOrders = await this.getOpenOrders(accountId);
    const existing = openOrders.find((order) => order.clientOrderId === clientOrderId);
    if (!existing) {
      throw new BinanceProviderError(
        "Binance did not expose an open order for cancellation.",
        "UNKNOWN_ORDER",
        { code: -2013 },
      );
    }

    const symbol = this.extractProviderSymbol(existing.instrumentId);
    const response = await this.signedRequest<BinanceOrderResponse>("DELETE", "/api/v3/order", [
      ["symbol", symbol],
      ["origClientOrderId", clientOrderId],
    ]);
    return this.mapOrder(response);
  }

  public async getOrderBySymbol(
    accountId: string,
    providerSymbol: string,
    clientOrderId: string,
  ): Promise<BrokerOrder> {
    this.assertAccount(accountId);
    const symbol = providerSymbol.trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(symbol)) throw new Error("Invalid Binance provider symbol.");
    const response = await this.signedRequest<BinanceOrderResponse>("GET", "/api/v3/order", [
      ["symbol", symbol],
      ["origClientOrderId", clientOrderId],
    ]);
    return this.mapOrder(response);
  }

  public async getFills(accountId: string, providerSymbol: string, orderId: string): Promise<Fill[]> {
    this.assertAccount(accountId);
    const symbol = providerSymbol.trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(symbol)) throw new Error("Invalid Binance provider symbol.");
    const response = await this.signedRequest<BinanceTradeResponse[]>("GET", "/api/v3/myTrades", [
      ["symbol", symbol],
      ["orderId", orderId],
      ["limit", "1000"],
    ]);
    return (Array.isArray(response) ? response : []).map((trade) => this.mapTrade(trade, symbol));
  }

  private async signedGet<T>(pathname: string, extraParams: Array<[string, string]> = []): Promise<T> {
    return this.signedRequest<T>("GET", pathname, extraParams);
  }

  private async signedRequest<T>(
    method: "GET" | "POST" | "DELETE",
    pathname: string,
    extraParams: Array<[string, string]> = [],
  ): Promise<T> {
    if (!this.apiKey || !this.apiSecret) {
      throw new BinanceProviderError(
        "Binance Spot testnet API credentials are not configured on the server.",
        "AUTHENTICATION",
      );
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
          const message = typeof body?.msg === "string"
            ? body.msg
            : "Binance authenticated request failed.";
          const kind = classifyBinanceError(
            Number.isFinite(code) ? code : undefined,
            response.status,
            message,
          );
          throw new BinanceProviderError(
            Number.isFinite(code)
              ? "Binance error " + code + ": " + message
              : message,
            kind,
            { code: Number.isFinite(code) ? code : undefined, httpStatus: response.status },
          );
        }

        return body as T;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error: any) {
      this.lastErrorAt = Date.now();
      this.lastError = error?.message || "Binance authenticated request failed.";
      if (error instanceof BinanceProviderError) throw error;
      if (error?.name === "AbortError") {
        throw new BinanceProviderError(
          "Binance authenticated request timed out.",
          "NETWORK",
        );
      }
      throw new BinanceProviderError(
        error?.message || "Binance authenticated request failed.",
        classifyBinanceError(undefined, undefined, error?.message || "", true),
      );
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

  private assertAccount(accountId: string): void {
    if (accountId !== this.accountId) {
      throw new Error("Unknown Binance Spot testnet account id.");
    }
  }

  private assertOrderSubmissionAllowed(): void {
    if (!this.testnetOnly || this.baseUrl !== "https://testnet.binance.vision") {
      throw new Error("Binance order submission is locked to the Spot Testnet endpoint.");
    }
    if (!this.enableOrderSubmission) {
      throw new Error("Binance Spot testnet order submission is disabled by configuration.");
    }
  }

  private extractProviderSymbol(instrumentId: string): string {
    const match = String(instrumentId || "").match(/^BINANCE_SPOT:BINANCE:([A-Z0-9_]+)$/i);
    if (!match) throw new Error("Order instrument is not a supported Binance Spot instrument.");
    return match[1].toUpperCase();
  }

  private toBinanceOrderType(type: OrderIntent["type"]): string {
    switch (type) {
      case "MARKET": return "MARKET";
      case "LIMIT": return "LIMIT";
      case "LIMIT_MAKER": return "LIMIT_MAKER";
      case "STOP": return "STOP_LOSS";
      case "STOP_LIMIT": return "STOP_LOSS_LIMIT";
      case "TAKE_PROFIT": return "TAKE_PROFIT";
      case "TAKE_PROFIT_LIMIT": return "TAKE_PROFIT_LIMIT";
      default: throw new Error("Unsupported Binance Spot order type: " + type);
    }
  }

  private toBinanceTimeInForce(order: OrderIntent): string | undefined {
    if (order.type === "LIMIT_MAKER") return "GTX";
    if (["LIMIT", "STOP_LIMIT", "TAKE_PROFIT_LIMIT"].includes(order.type)) {
      return order.timeInForce || "GTC";
    }
    return undefined;
  }

  private mapOrder(row: BinanceOrderResponse): BrokerOrder {
    const symbol = String(row.symbol || "").trim().toUpperCase();
    const side = row.side === "SELL" ? "SELL" : "BUY";
    const type = String(row.type || "LIMIT").toUpperCase();

    if (!symbol || !row.clientOrderId || !row.orderId) {
      throw new Error("Binance returned an open order missing required identifiers.");
    }

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
      submittedAt: Number(row.time) > 0 ? Number(row.time) : undefined,
      updatedAt: Number(row.updateTime) > 0 ? Number(row.updateTime) : Date.now(),
      externalOrderId: String(row.orderId),
    };
  }

  private mapTrade(trade: BinanceTradeResponse, symbol: string): Fill {
    const tradeId = String(trade.id ?? "");
    const orderId = String(trade.orderId ?? "");
    const quantity = String(trade.qty ?? "0");
    const price = String(trade.price ?? "0");
    const executedAt = Number(trade.time);
    if (!tradeId || !orderId || !Number.isFinite(executedAt) || executedAt <= 0) {
      throw new Error("Binance returned a trade missing required identifiers/timestamp.");
    }

    return {
      id: "binance-testnet:" + symbol + ":" + tradeId,
      accountId: this.accountId,
      orderClientId: "",
      externalOrderId: orderId,
      externalTradeId: tradeId,
      instrumentId: "BINANCE_SPOT:BINANCE:" + symbol,
      side: trade.isBuyer ? "BUY" : "SELL",
      quantity,
      price,
      feeAmount: trade.commission,
      feeAsset: trade.commissionAsset,
      liquidity: trade.isMaker ? "MAKER" : "TAKER",
      executedAt,
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
