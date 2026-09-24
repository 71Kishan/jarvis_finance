import { randomUUID } from "crypto";
import { WebSocket } from "ws";
import { buildBinanceSignature } from "../platform/binanceSpotAccountAdapter";
import type { BrokerOrder, Fill, OrderStatus, WalletBalance } from "../platform/types";

const DEFAULT_TESTNET_WS_URL = "wss://ws-api.testnet.binance.vision/ws-api/v3";
const DEFAULT_LIVE_WS_URL = "wss://ws-api.binance.com:443/ws-api/v3";
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

export interface BinanceExecutionReport {
  e?: string;
  E?: number;
  s?: string;
  c?: string;
  S?: "BUY" | "SELL";
  o?: string;
  f?: string;
  q?: string;
  p?: string;
  P?: string;
  x?: string;
  X?: string;
  i?: number;
  l?: string;
  z?: string;
  L?: string;
  n?: string;
  N?: string | null;
  T?: number;
  t?: number;
  I?: number;
  m?: boolean;
  O?: number;
  Z?: string;
  Y?: string;
  [key: string]: unknown;
}

export interface BinanceAccountEvent {
  e?: string;
  E?: number;
  u?: number;
  B?: Array<{ a?: string; f?: string; l?: string }>;
}

export interface BinanceUserDataStreamHealth {
  connected: boolean;
  subscribed: boolean;
  lastConnectedAt?: number;
  lastEventAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  reconnectCount: number;
}

export interface BinanceSpotUserDataStreamOptions {
  apiKey?: string;
  apiSecret?: string;
  accountId: string;
  testnetOnly?: boolean;
  wsUrl?: string;
  recvWindowMs?: number;
  onOrderUpdate?: (order: BrokerOrder) => void | Promise<void>;
  onBalanceUpdate?: (balances: WalletBalance[]) => void | Promise<void>;
  onHealthChange?: (health: BinanceUserDataStreamHealth) => void;
}

export function mapExecutionReportToBrokerOrder(
  event: BinanceExecutionReport,
  accountId: string,
): BrokerOrder | null {
  const symbol = String(event.s || "").trim().toUpperCase();
  const clientOrderId = String(event.c || "").trim();
  if (!symbol || !clientOrderId || (event.S !== "BUY" && event.S !== "SELL")) return null;

  const status = mapProviderOrderStatus(event.X);
  const quantity = String(event.q ?? "0");
  const filledQuantity = String(event.z ?? "0");
  const avgPrice =
    Number(filledQuantity) > 0 && Number(event.Z ?? "0") > 0
      ? divideDecimalStrings(String(event.Z), filledQuantity)
      : undefined;

  const fills: Fill[] = [];
  const lastQty = String(event.l ?? "0");
  const tradeId = Number(event.t ?? -1);
  const tradePrice = String(event.L ?? "0");
  if (Number(lastQty) > 0 && Number(tradePrice) > 0 && tradeId >= 0) {
    fills.push({
      id: randomUUID(),
      accountId,
      orderClientId: clientOrderId,
      externalOrderId: Number(event.i) > 0 ? String(event.i) : undefined,
      externalTradeId: String(tradeId),
      instrumentId: "BINANCE_SPOT:BINANCE:" + symbol,
      side: event.S,
      quantity: lastQty,
      price: tradePrice,
      feeAmount: event.n ? String(event.n) : undefined,
      feeAsset: event.N ? String(event.N).toUpperCase() : undefined,
      liquidity: typeof event.m === "boolean" ? (event.m ? "MAKER" : "TAKER") : "UNKNOWN",
      executedAt: Number(event.T) > 0 ? Number(event.T) : Number(event.E) > 0 ? Number(event.E) : Date.now(),
    });
  }

  return {
    clientOrderId,
    accountId,
    instrumentId: "BINANCE_SPOT:BINANCE:" + symbol,
    side: event.S,
    type: normalizeOrderType(event.o),
    quantity,
    limitPrice: Number(event.p) > 0 ? String(event.p) : undefined,
    stopPrice: Number(event.P) > 0 ? String(event.P) : undefined,
    timeInForce: normalizeTimeInForce(event.f),
    status,
    filledQuantity,
    averageFillPrice: avgPrice,
    requestedAt: Number(event.O) > 0 ? Number(event.O) : Number(event.E) > 0 ? Number(event.E) : Date.now(),
    submittedAt: Number(event.O) > 0 ? Number(event.O) : undefined,
    updatedAt: Number(event.T || event.E) > 0 ? Number(event.T || event.E) : Date.now(),
    lastProviderEventAt: Number(event.E) > 0 ? Number(event.E) : undefined,
    fills,
  };
}

export function mapOutboundAccountPosition(
  event: BinanceAccountEvent,
  accountId: string,
): WalletBalance[] {
  const updatedAt = Number(event.u || event.E);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return [];

  return (Array.isArray(event.B) ? event.B : [])
    .map((row) => ({
      accountId,
      asset: String(row.a || "").trim().toUpperCase(),
      free: String(row.f ?? "0"),
      locked: String(row.l ?? "0"),
      total: addDecimalStrings(String(row.f ?? "0"), String(row.l ?? "0")),
      updatedAt,
    }))
    .filter((row) => row.asset);
}

function mapProviderOrderStatus(value: unknown): OrderStatus {
  switch (String(value || "").toUpperCase()) {
    case "NEW":
    case "PENDING_NEW":
      return "SUBMITTED";
    case "PARTIALLY_FILLED":
      return "PARTIALLY_FILLED";
    case "FILLED":
      return "FILLED";
    case "CANCELED":
    case "EXPIRED_IN_MATCH":
      return "CANCELLED";
    case "REJECTED":
      return "REJECTED";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return "UNKNOWN_RECONCILIATION";
  }
}

function normalizeOrderType(value: unknown): BrokerOrder["type"] {
  switch (String(value || "").toUpperCase()) {
    case "MARKET":
      return "MARKET";
    case "LIMIT":
      return "LIMIT";
    case "LIMIT_MAKER":
      return "LIMIT_MAKER";
    case "STOP_LOSS":
      return "STOP";
    case "STOP_LOSS_LIMIT":
      return "STOP_LIMIT";
    case "TAKE_PROFIT":
      return "TAKE_PROFIT";
    case "TAKE_PROFIT_LIMIT":
      return "TAKE_PROFIT_LIMIT";
    default:
      return "MARKET";
  }
}

function normalizeTimeInForce(value: unknown): BrokerOrder["timeInForce"] {
  switch (String(value || "").toUpperCase()) {
    case "GTC":
      return "GTC";
    case "IOC":
      return "IOC";
    case "FOK":
      return "FOK";
    case "DAY":
      return "DAY";
    case "GTX":
      return "GTX";
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
  const digits = total.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const point = digits.length - scale;
  return digits.slice(0, point) + "." + digits.slice(point);
}

function divideDecimalStrings(numerator: string, denominator: string): string {
  const [numInt, numFrac = ""] = numerator.split(".");
  const [denInt, denFrac = ""] = denominator.split(".");
  if (!/^\d+$/.test(numInt || "") || !/^\d*$/.test(numFrac) || !/^\d+$/.test(denInt || "") || !/^\d*$/.test(denFrac)) {
    return "0";
  }
  const denUnits = BigInt((denInt || "0") + denFrac);
  if (denUnits === 0n) return "0";
  const scale = 18;
  const numUnits = BigInt((numInt || "0") + numFrac);
  const exponent = scale + denFrac.length - numFrac.length;
  const scaled = exponent >= 0
    ? numUnits * 10n ** BigInt(exponent)
    : numUnits / 10n ** BigInt(-exponent);
  const quotient = scaled / denUnits;
  const digits = quotient.toString().padStart(scale + 1, "0");
  const point = digits.length - scale;
  const result = digits.slice(0, point) + "." + digits.slice(point).replace(/0+$/, "");
  return result.endsWith(".") ? result.slice(0, -1) : result;
}

export class BinanceSpotUserDataStream {
  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;
  private readonly accountId: string;
  private readonly testnetOnly: boolean;
  private readonly wsUrl: string;
  private readonly recvWindowMs: number;
  private readonly onOrderUpdate?: BinanceSpotUserDataStreamOptions["onOrderUpdate"];
  private readonly onBalanceUpdate?: BinanceSpotUserDataStreamOptions["onBalanceUpdate"];
  private readonly onHealthChange?: BinanceSpotUserDataStreamOptions["onHealthChange"];

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private reconnectDelayMs = INITIAL_RECONNECT_MS;
  private lastConnectedAt?: number;
  private lastEventAt?: number;
  private lastErrorAt?: number;
  private lastError?: string;
  private reconnectCount = 0;
  private subscribed = false;

  constructor(options: BinanceSpotUserDataStreamOptions = {} as BinanceSpotUserDataStreamOptions) {
    this.apiKey = options.apiKey ?? process.env.JARVIS_BINANCE_TESTNET_API_KEY;
    this.apiSecret = options.apiSecret ?? process.env.JARVIS_BINANCE_TESTNET_API_SECRET;
    this.accountId = options.accountId ?? process.env.JARVIS_BINANCE_TESTNET_ACCOUNT_ID ?? "binance-testnet-local";
    this.testnetOnly = options.testnetOnly ?? process.env.JARVIS_BINANCE_TESTNET_ONLY !== "false";
    this.recvWindowMs = Math.min(
      60_000,
      Math.max(1_000, options.recvWindowMs ?? (Number(process.env.JARVIS_BINANCE_RECV_WINDOW_MS) || 5_000)),
    );
    this.wsUrl = options.wsUrl ?? (this.testnetOnly ? DEFAULT_TESTNET_WS_URL : DEFAULT_LIVE_WS_URL);
    this.onOrderUpdate = options.onOrderUpdate;
    this.onBalanceUpdate = options.onBalanceUpdate;
    this.onHealthChange = options.onHealthChange;

    const hostname = new URL(this.wsUrl).hostname;
    if (this.testnetOnly && hostname !== "ws-api.testnet.binance.vision") {
      throw new Error("Binance user-data stream is locked to ws-api.testnet.binance.vision in testnet-only mode.");
    }
  }

  public start(): void {
    if (!this.stopped) return;
    if (!this.apiKey || !this.apiSecret) return;
    this.stopped = false;
    this.connect();
  }

  public stop(): void {
    this.stopped = true;
    this.subscribed = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const socket = this.ws;
    this.ws = null;
    try { socket?.close(); } catch {}
    this.emitHealth();
  }

  public getHealth(): BinanceUserDataStreamHealth {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      subscribed: this.subscribed,
      lastConnectedAt: this.lastConnectedAt,
      lastEventAt: this.lastEventAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      reconnectCount: this.reconnectCount,
    };
  }

  private connect(): void {
    if (this.stopped || !this.apiKey || !this.apiSecret) return;

    const socket = new WebSocket(this.wsUrl, {
      handshakeTimeout: 10_000,
      headers: { "User-Agent": "JarvisFinance/1.0" },
    });
    this.ws = socket;
    this.subscribed = false;
    this.emitHealth();

    socket.on("open", () => {
      if (this.stopped || this.ws !== socket) return;
      this.lastConnectedAt = Date.now();
      this.lastError = undefined;
      this.reconnectDelayMs = INITIAL_RECONNECT_MS;
      this.sendSignedSubscribe();
      this.emitHealth();
    });

    socket.on("message", (data) => {
      if (this.ws !== socket) return;
      this.handleMessage(String(data));
    });

    socket.on("error", (error: Error) => {
      this.lastErrorAt = Date.now();
      this.lastError = error?.message || "Binance user-data WebSocket error.";
      this.emitHealth();
    });

    socket.on("close", () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.subscribed = false;
      this.emitHealth();
      if (this.stopped) return;
      this.reconnectCount += 1;
      const delay = this.reconnectDelayMs;
      this.reconnectDelayMs = Math.min(MAX_RECONNECT_MS, this.reconnectDelayMs * 2);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.connect();
      }, delay);
    });
  }

  private sendSignedSubscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.apiKey || !this.apiSecret) return;
    const params: Record<string, string> = {
      apiKey: this.apiKey,
      recvWindow: String(this.recvWindowMs),
      timestamp: String(Date.now()),
    };
    const signature = buildBinanceSignature(
      this.apiSecret,
      [["apiKey", params.apiKey], ["recvWindow", params.recvWindow], ["timestamp", params.timestamp]],
    );
    params.signature = signature;

    this.ws.send(JSON.stringify({
      id: randomUUID(),
      method: "userDataStream.subscribe.signature",
      params,
    }));
  }

  private handleMessage(raw: string): void {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      this.lastErrorAt = Date.now();
      this.lastError = "Binance user-data stream emitted invalid JSON.";
      this.emitHealth();
      return;
    }

    if (message?.status !== undefined && message?.result?.subscriptionId !== undefined) {
      if (Number(message.status) === 200) {
        this.subscribed = true;
      } else {
        this.lastErrorAt = Date.now();
        this.lastError = "Binance user-data subscription was rejected.";
      }
      this.emitHealth();
      return;
    }

    const event = message?.data && typeof message.data === "object" ? message.data : message;
    if (!event?.e) return;

    this.lastEventAt = Date.now();

    if (event.e === "executionReport") {
      const mapped = mapExecutionReportToBrokerOrder(event as BinanceExecutionReport, this.accountId);
      if (mapped && this.onOrderUpdate) {
        Promise.resolve(this.onOrderUpdate(mapped)).catch((error: any) => {
          this.lastErrorAt = Date.now();
          this.lastError = error?.message || "Order event handler failed.";
          this.emitHealth();
        });
      }
    } else if (event.e === "outboundAccountPosition") {
      const balances = mapOutboundAccountPosition(event as BinanceAccountEvent, this.accountId);
      if (balances.length && this.onBalanceUpdate) {
        Promise.resolve(this.onBalanceUpdate(balances)).catch((error: any) => {
          this.lastErrorAt = Date.now();
          this.lastError = error?.message || "Balance event handler failed.";
          this.emitHealth();
        });
      }
    }
    this.emitHealth();
  }

  private emitHealth(): void {
    this.onHealthChange?.(this.getHealth());
  }
}
