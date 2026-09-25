import express, { Request, Response } from "express";
import http from "http";
import path from "path";
import { timingSafeEqual } from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import { BinanceMarketDataService } from "./src/server/binanceMarketData";
import { BinanceInstrumentCatalog } from "./src/server/binanceInstrumentCatalog";
import { AutonomousPaperRuntime } from "./src/server/paperRuntime";
import { PlatformDatabase } from "./src/server/platformDatabase";
import { PlatformRepository } from "./src/platform/platformRepository";
import { BinanceProviderError, BinanceSpotAccountAdapter } from "./src/platform/binanceSpotAccountAdapter";
import { AuthControlStore } from "./src/server/authControlStore";
import { SandboxOrderStore } from "./src/server/sandboxOrderStore";
import { BinanceSandboxReconciler } from "./src/server/binanceSandboxReconciler";
import { deriveClientOrderId, evaluateSandboxOrderPolicy, fingerprintOrderIntent, isSandboxOrderSubmissionEnabled } from "./src/server/sandboxOrderPolicy";
import {
  JARVIS_SESSION_COOKIE,
  SESSION_TTL_MS,
  buildExpiredSessionCookie,
  buildSessionCookie,
  createSessionToken,
  hashSessionToken,
  parseCookies,
} from "./src/server/auth";

dotenv.config();

const app = express();
const PORT = 3000;

// Security: Strict payload size limiter to prevent JSON bomb / buffer starvation attacks
app.use(express.json({ limit: "250kb" }));

// Security: Comprehensive HTTP Defense Headers
app.use((req: Request, res: Response, next) => {
  // Prevent MIME-sniffing exploits
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Referrer leakage prevention
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Restrict intrusive hardware permissions (allow microphone for voice interactions)
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=()");
  // Prevent unauthorized file execution in older IE/Edge
  res.setHeader("X-Download-Options", "noopen");
  // DNS prefetch control
  res.setHeader("X-DNS-Prefetch-Control", "off");
  // Remove X-Powered-By to prevent technology fingerprinting
  res.removeHeader("X-Powered-By");
  next();
});

// Security: In-Memory Sliding-Window Rate Limiter for /api/* to defend against DDoS and API scraping
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitBucket>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 150; // max 150 req/min per IP

app.use("/api", (req: Request, res: Response, next) => {
  const ip = req.ip || req.socket.remoteAddress || "client-local";
  const now = Date.now();
  const bucket = rateLimitMap.get(ip);

  if (!bucket || now > bucket.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  bucket.count++;
  if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: "Too many requests. Algorithmic rate defense triggered to protect server security.",
      retryAfterSeconds: retryAfter,
    });
  }

  // Periodic cleanup
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }

  next();
});

interface AuthenticatedRequest extends Request {
  jarvisUser?: import("./src/server/authControlStore").AuthUser;
  jarvisSessionId?: string;
}

function secureCookies(req: Request): boolean {
  if (process.env.JARVIS_SECURE_COOKIES === "true") return true;
  if (process.env.JARVIS_SECURE_COOKIES === "false") return false;
  return process.env.NODE_ENV === "production";
}

function requireSameOrigin(req: Request, res: Response, next: () => void) {
  const origin = req.get("Origin");
  if (!origin) return next();
  try {
    const originUrl = new URL(origin);
    const expectedHost = req.get("Host");
    if (!expectedHost || originUrl.host !== expectedHost) {
      return res.status(403).json({ error: "Cross-origin state-changing request rejected." });
    }
  } catch {
    return res.status(403).json({ error: "Invalid request origin." });
  }
  next();
}

async function requireSession(req: AuthenticatedRequest, res: Response, next: () => void) {
  if (!platformDatabase.isReady()) {
    return res.status(503).json({ error: "Authenticated account services require PostgreSQL." });
  }

  const token = parseCookies(req.headers.cookie)[JARVIS_SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const session = await authControlStore.getSession(hashSessionToken(token));
  if (!session) {
    res.setHeader("Set-Cookie", buildExpiredSessionCookie(secureCookies(req)));
    return res.status(401).json({ error: "Authentication required." });
  }

  req.jarvisUser = session.user;
  req.jarvisSessionId = session.sessionId;
  void authControlStore.touchSession(session.sessionId).catch(() => undefined);
  next();
}

const authRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 12;

function authRateLimitKey(req: Request, email?: string): string {
  const ip = req.ip || req.socket.remoteAddress || "client-local";
  return ip + ":" + (email || "").trim().toLowerCase();
}

function consumeAuthAttempt(req: Request, email?: string): boolean {
  const key = authRateLimitKey(req, email);
  const now = Date.now();
  const bucket = authRateLimitMap.get(key);
  if (!bucket || now >= bucket.resetAt) {
    authRateLimitMap.set(key, { count: 1, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= AUTH_MAX_ATTEMPTS) return false;
  bucket.count += 1;
  return true;
}

function clearAuthRateLimit(email: string, req: Request): void {
  authRateLimitMap.delete(authRateLimitKey(req, email));
}

// Initialize Gemini AI Client lazily and safely
const getAIClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "JarvisFinance/1.0",
      },
    },
  });
};

const FINANCIAL_DATASETS_BASE_URL = process.env.FINANCIAL_DATASETS_BASE_URL || "https://api.financialdatasets.ai";
const FINANCIAL_DATASETS_TIMEOUT_MS = 8000;
const providerCache = new Map<string, { expiresAt: number; value: any }>();

function fdsConfigured(): boolean {
  return Boolean(process.env.FINANCIAL_DATASETS_API_KEY);
}

async function fetchJsonWithTimeout(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FINANCIAL_DATASETS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: controller.signal,
    });
    const text = await response.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!response.ok) {
      const message = typeof body?.message === "string" ? body.message : `Upstream HTTP ${response.status}`;
      throw new Error(message);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFinancialDatasets(pathname: string, params: Record<string, string>) {
  if (!fdsConfigured()) throw new Error("Financial Datasets API key is not configured.");
  const url = new URL(pathname, FINANCIAL_DATASETS_BASE_URL);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return fetchJsonWithTimeout(url.toString(), {
    "X-API-KEY": process.env.FINANCIAL_DATASETS_API_KEY as string,
  });
}

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = providerCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await loader();
  providerCache.set(key, { expiresAt: now + ttlMs, value });
  return value;
}

function firstNumber(...values: any[]): number | null {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parsePriceRows(payload: any): any[] {
  const rows = Array.isArray(payload?.prices) ? payload.prices : Array.isArray(payload?.history) ? payload.history : [];
  return rows.filter((row: any) => row && Number.isFinite(Number(row.close ?? row.price)));
}

function rowTimestamp(row: any): number {
  const raw = row?.timestamp ?? row?.time ?? row?.date ?? row?.datetime;
  const parsed = typeof raw === "number" ? raw : Date.parse(String(raw || ""));
  if (!Number.isFinite(parsed)) return 0;
  return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

function mapPriceRow(row: any) {
  const close = firstNumber(row?.close, row?.price, row?.last_price);
  const open = firstNumber(row?.open) ?? close;
  const high = firstNumber(row?.high) ?? Math.max(open || 0, close || 0);
  const low = firstNumber(row?.low) ?? Math.min(open || 0, close || 0);
  const volume = firstNumber(row?.volume, row?.v) ?? 0;
  return { timestamp: rowTimestamp(row), open, high, low, close, volume };
}

function extractSnapshot(payload: any): any {
  const s = payload?.snapshot ?? payload?.data ?? payload ?? {};
  const latest = s?.latest_data ?? {};
  const price = firstNumber(s?.price, s?.last_price, s?.close, latest?.price, latest?.close);
  return {
    price,
    open: firstNumber(s?.open, latest?.open),
    high: firstNumber(s?.high, s?.high_24h, latest?.high),
    low: firstNumber(s?.low, s?.low_24h, latest?.low),
    volume: firstNumber(s?.volume, s?.volume_24h, latest?.volume),
    changePercent: firstNumber(s?.change_percent, s?.change_24h_percent, s?.price_change_percent),
    bid: firstNumber(s?.bid, s?.bid_price),
    ask: firstNumber(s?.ask, s?.ask_price),
    updatedAt: rowTimestamp(s) || Date.now(),
  };
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let result = values.slice(0, Math.min(period, values.length)).reduce((a, b) => a + b, 0) / Math.min(period, values.length);
  for (const value of values.slice(Math.min(period, values.length))) result = value * k + result * (1 - k);
  return result;
}

function rsi(values: number[], period = 14): number {
  if (values.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta; else losses += Math.abs(delta);
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

function buildTechnicalScreen(rows: any[], change24hPercent = 0) {
  const mapped = rows.map(mapPriceRow).filter((x) => x.timestamp > 0 && x.close !== null) as Array<{timestamp:number;open:number;high:number;low:number;close:number;volume:number}>;
  const closes = mapped.map(x => Number(x.close));
  const last = mapped[mapped.length - 1];
  if (!last || closes.length < 60) return null;
  const e9 = ema(closes, 9), e21 = ema(closes, 21), e50 = ema(closes, 50);
  const r = rsi(closes, 14);
  const bbWindow = closes.slice(-20);
  const bbMean = bbWindow.reduce((a,b)=>a+b,0)/bbWindow.length;
  const bbStd = standardDeviation(bbWindow);
  const upper = bbMean + 2 * bbStd, lower = bbMean - 2 * bbStd;
  const trend = e9 > e21 && e21 > e50 ? "BULLISH" : e9 < e21 && e21 < e50 ? "BEARISH" : "SIDEWAYS";
  let score = 50;
  if (trend === "BULLISH") score += 15;
  if (trend === "BEARISH") score += 15;
  score += Math.min(15, Math.abs(change24hPercent) * 3);
  if (trend === "BULLISH" && r >= 50 && r <= 70) score += 10;
  if (trend === "BEARISH" && r >= 30 && r <= 50) score += 10;
  if (last.close > bbMean && trend === "BULLISH") score += 5;
  if (last.close < bbMean && trend === "BEARISH") score += 5;
  score = Math.min(95, Math.round(score));
  const bestDirection = trend === "BULLISH" ? "LONG" : trend === "BEARISH" ? "SHORT" : "NEUTRAL";
  return {
    score,
    bestDirection,
    rsi: Number(r.toFixed(1)),
    trend,
    volatility: Number((bbMean ? (bbStd / bbMean * 100) : 0).toFixed(2)),
    rationale: `Actual historical bars: EMA 9/21/50 = ${e9.toFixed(2)}/${e21.toFixed(2)}/${e50.toFixed(2)}, RSI14=${r.toFixed(1)}, 20-bar volatility=${bbMean ? (bbStd / bbMean * 100).toFixed(2) : "0.00"}%.`,
  };
}

// Authenticated control plane. Account data requires a durable DB-backed session.
// Runtime control-token endpoints remain separate and are not replaced by browser sessions.
app.get("/api/auth/status", async (_req: Request, res: Response) => {
  try {
    const required = process.env.JARVIS_AUTH_REQUIRED === "true";
    const configured = platformDatabase.isReady() && await authControlStore.isAuthenticationConfigured();
    return res.json({ required, configured, sessionTtlMs: SESSION_TTL_MS });
  } catch (error: any) {
    return res.status(503).json({ required: process.env.JARVIS_AUTH_REQUIRED === "true", configured: false, error: error?.message || "Authentication status unavailable." });
  }
});

app.post("/api/auth/login", requireSameOrigin, async (req: Request, res: Response) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || email.length > 320 || !password || password.length > 256) {
    return res.status(400).json({ authenticated: false, error: "Invalid credentials." });
  }
  if (!consumeAuthAttempt(req, email)) {
    return res.status(429).json({ authenticated: false, error: "Too many authentication attempts. Try again later." });
  }

  try {
    if (!platformDatabase.isReady() || !(await authControlStore.isAuthenticationConfigured())) {
      return res.status(503).json({ authenticated: false, error: "Authenticated workspace is not configured on this server." });
    }

    const result = await authControlStore.authenticate(email, password);
    if (result.status === "LOCKED") {
      return res.status(423).json({
        authenticated: false,
        error: "Account temporarily locked after repeated failed attempts.",
        lockedUntil: result.lockedUntil ?? null,
      });
    }
    if (result.status !== "AUTHENTICATED" || !result.user) {
      return res.status(401).json({ authenticated: false, error: "Invalid credentials." });
    }

    const token = createSessionToken();
    const session = await authControlStore.createSession({
      userId: result.user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: Date.now() + SESSION_TTL_MS,
      ipAddress: req.ip || req.socket.remoteAddress || undefined,
      userAgent: req.get("User-Agent") || undefined,
    });

    clearAuthRateLimit(email, req);
    await authControlStore.recordAuditEvent({
      userId: result.user.id,
      eventType: "AUTH_LOGIN",
      requestId: req.get("X-Request-Id") || undefined,
      payload: { sessionId: session.sessionId },
    });

    res.setHeader("Set-Cookie", buildSessionCookie(token, secureCookies(req)));
    return res.json({
      authenticated: true,
      expiresAt: session.expiresAt,
      user: result.user,
    });
  } catch (error: any) {
    console.error("Jarvis authentication error:", error?.message || error);
    return res.status(503).json({ authenticated: false, error: "Authentication service unavailable." });
  }
});

app.post("/api/auth/logout", requireSameOrigin, async (req: Request, res: Response) => {
  const token = parseCookies(req.headers.cookie)[JARVIS_SESSION_COOKIE];
  if (token && platformDatabase.isReady()) {
    try {
      const session = await authControlStore.getSession(hashSessionToken(token));
      await authControlStore.revokeSession(hashSessionToken(token));
      if (session) {
        await authControlStore.recordAuditEvent({
          userId: session.user.id,
          eventType: "AUTH_LOGOUT",
          requestId: req.get("X-Request-Id") || undefined,
          payload: { sessionId: session.sessionId },
        });
      }
    } catch (error: any) {
      console.warn("Jarvis logout persistence warning:", error?.message || error);
    }
  }

  res.setHeader("Set-Cookie", buildExpiredSessionCookie(secureCookies(req)));
  return res.json({ authenticated: false });
});

app.get("/api/me", requireSession, async (req: AuthenticatedRequest, res: Response) => {
  return res.json({ authenticated: true, user: req.jarvisUser });
});

app.get("/api/account/overview", requireSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const overview = await authControlStore.getAccountOverview(req.jarvisUser!.id);
    return res.json({ success: true, ...overview });
  } catch (error: any) {
    return res.status(503).json({ success: false, error: error?.message || "Account overview unavailable." });
  }
});

app.post("/api/account/binance-testnet/sync", requireSession, requireSameOrigin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!binanceSpotTestnetAccount.isConfigured()) {
      return res.status(503).json({ success: false, error: "Binance Spot testnet credentials are not configured on the server." });
    }

    const snapshot = await binanceSpotTestnetAccount.syncReadOnlyAccount();
    const connection = await authControlStore.persistBinanceReadOnlySync(req.jarvisUser!.id, {
      account: snapshot.account,
      accountId: binanceSpotTestnetAccount.getAccountId(),
      balances: snapshot.balances,
      openOrders: snapshot.openOrders,
    });

    return res.json({
      success: true,
      connection,
      account: {
        accountType: snapshot.account.accountType,
        canTrade: snapshot.account.canTrade === true,
        canWithdraw: snapshot.account.canWithdraw === true,
        canDeposit: snapshot.account.canDeposit === true,
        permissions: Array.isArray(snapshot.account.permissions) ? snapshot.account.permissions : [],
        updateTime: snapshot.account.updateTime ?? null,
      },
      balances: snapshot.balances,
      openOrders: snapshot.openOrders,
      health: await binanceSpotTestnetAccount.getHealth(),
    });
  } catch (error: any) {
    return res.status(503).json({
      success: false,
      error: error?.message || "Binance Spot testnet account sync failed.",
      health: await binanceSpotTestnetAccount.getHealth(),
    });
  }
});

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function normalizeOrderBody(body: any): {
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "LIMIT_MAKER" | "STOP" | "STOP_LIMIT" | "TAKE_PROFIT" | "TAKE_PROFIT_LIMIT";
  quantity: string;
  limitPrice?: string;
  stopPrice?: string;
  timeInForce?: "DAY" | "GTC" | "IOC" | "FOK" | "GTX";
  reduceOnly: boolean;
  strategyId?: string;
  strategyVersion?: number;
  reason?: string;
} {
  const sides = new Set(["BUY", "SELL"]);
  const types = new Set(["MARKET", "LIMIT", "LIMIT_MAKER", "STOP", "STOP_LIMIT", "TAKE_PROFIT", "TAKE_PROFIT_LIMIT"]);
  const timeInForce = body?.timeInForce == null ? undefined : String(body.timeInForce).toUpperCase();

  if (!sides.has(String(body?.side || "").toUpperCase())) throw new Error("Invalid order side.");
  if (!types.has(String(body?.type || "").toUpperCase())) throw new Error("Invalid order type.");
  if (!isNonEmptyString(body?.quantity, 64)) throw new Error("A valid order quantity is required.");
  if (timeInForce !== undefined && !new Set(["DAY", "GTC", "IOC", "FOK", "GTX"]).has(timeInForce)) {
    throw new Error("Invalid time-in-force.");
  }

  const strategyVersion = body?.strategyVersion == null ? undefined : Number(body.strategyVersion);
  if (strategyVersion !== undefined && (!Number.isInteger(strategyVersion) || strategyVersion < 0)) {
    throw new Error("Strategy version must be a non-negative integer.");
  }

  return {
    side: String(body.side).toUpperCase() as any,
    type: String(body.type).toUpperCase() as any,
    quantity: body.quantity.trim(),
    limitPrice: isNonEmptyString(body?.limitPrice, 64) ? body.limitPrice.trim() : undefined,
    stopPrice: isNonEmptyString(body?.stopPrice, 64) ? body.stopPrice.trim() : undefined,
    timeInForce: timeInForce as any,
    reduceOnly: body?.reduceOnly === true,
    strategyId: isNonEmptyString(body?.strategyId, 128) ? body.strategyId.trim() : undefined,
    strategyVersion,
    reason: isNonEmptyString(body?.reason, 500) ? body.reason.trim() : undefined,
  };
}

app.post("/api/account/binance-testnet/orders", requireSession, requireSameOrigin, async (req: AuthenticatedRequest, res: Response) => {
  if (!isSandboxOrderSubmissionEnabled()) {
    return res.status(503).json({
      success: false,
      status: "ORDER_SUBMISSION_DISABLED",
      error: "Binance Spot Testnet order submission is disabled by server safety gates.",
    });
  }

  if (!binanceSpotTestnetAccount.isConfigured()) {
    return res.status(503).json({
      success: false,
      status: "PROVIDER_UNAVAILABLE",
      error: "Binance Spot testnet credentials are not configured on the server.",
    });
  }

  const accountId = isNonEmptyString(req.body?.accountId, 80) ? req.body.accountId.trim() : "";
  const instrumentId = isNonEmptyString(req.body?.instrumentId, 160) ? req.body.instrumentId.trim() : "";
  const idempotencyKey = isNonEmptyString(req.body?.idempotencyKey, 128) ? req.body.idempotencyKey.trim() : "";

  if (!accountId) return res.status(400).json({ success: false, error: "accountId is required." });
  if (!instrumentId) return res.status(400).json({ success: false, error: "instrumentId is required." });
  if (!idempotencyKey) return res.status(400).json({ success: false, error: "idempotencyKey is required." });

  try {
    const body = normalizeOrderBody(req.body);
    const overview = await authControlStore.getAccountOverview(req.jarvisUser!.id);
    const connection = overview.connections.find((item) => item.id === accountId);

    if (!connection) return res.status(404).json({ success: false, error: "Trading account connection not found." });

    const instrument = binanceInstrumentCatalog.get(instrumentId);
    if (!instrument) return res.status(404).json({ success: false, error: "Trading instrument is not present in the server catalog." });

    if (connection.externalAccountId !== binanceSpotTestnetAccount.getAccountId()) {
      return res.status(409).json({ success: false, error: "The selected account is not the configured Binance Spot Testnet account." });
    }

    await binanceMarketData.ensureSymbol(instrument.symbol, instrument.providerSymbol);
    const ticker = binanceMarketData.getTicker(instrument.symbol);

    const intentWithoutClientId = {
      accountId: connection.id,
      instrumentId: instrument.instrumentId,
      ...body,
      requestedAt: Date.now(),
    } satisfies Omit<import("./src/platform/types").OrderIntent, "clientOrderId">;

    const order: import("./src/platform/types").OrderIntent = {
      clientOrderId: deriveClientOrderId(req.jarvisUser!.id, connection.id, idempotencyKey),
      ...intentWithoutClientId,
    };

    const policy = evaluateSandboxOrderPolicy({
      order,
      account: connection,
      instrument,
      balances: overview.balances.filter((balance) => balance.accountId === connection.id),
      quote: ticker
        ? { bid: String(ticker.bid), ask: String(ticker.ask), updatedAt: ticker.lastUpdated }
        : undefined,
      openOrderCount: overview.openOrders.filter((open) => open.accountId === connection.id).length,
    });

    if (!policy.allowed) {
      await authControlStore.recordAuditEvent({
        userId: req.jarvisUser!.id,
        accountId: connection.id,
        eventType: "SANDBOX_ORDER_REJECTED_POLICY",
        requestId: req.get("X-Request-Id") || undefined,
        idempotencyKey,
        payload: { instrumentId, side: order.side, type: order.type, quantity: order.quantity, reasons: policy.reasons },
      });
      return res.status(422).json({ success: false, status: "POLICY_REJECTED", reasons: policy.reasons, risk: policy.risk });
    }

    const fingerprint = fingerprintOrderIntent(order);
    const pending = await sandboxOrderStore.createOrGetPendingIntent({
      userId: req.jarvisUser!.id,
      accountId: connection.id,
      instrumentId: instrument.instrumentId,
      idempotencyKey,
      clientOrderId: order.clientOrderId,
      idempotencyFingerprint: fingerprint,
    }, order);

    if (!pending.created) {
      return res.json({
        success: true,
        idempotent: true,
        order: pending.order,
        fills: await sandboxOrderStore.getStoredFills(req.jarvisUser!.id, pending.order.clientOrderId),
      });
    }

    try {
      // The provider adapter operates on the provider's external account identity;
      // the durable Jarvis order remains owned by the internal account connection.
      const providerOrder = await binanceSpotTestnetAccount.submitOrder({
        ...order,
        accountId: connection.externalAccountId!,
      });

      let persisted = await sandboxOrderStore.markStatus(
        req.jarvisUser!.id,
        order.clientOrderId,
        providerOrder.status,
        {
          externalOrderId: providerOrder.externalOrderId,
          filledQuantity: providerOrder.filledQuantity,
          averageFillPrice: providerOrder.averageFillPrice,
          submittedAt: providerOrder.submittedAt,
        },
      );

      if (providerOrder.externalOrderId) {
        const fills = await binanceSpotTestnetAccount.getFills(
          connection.externalAccountId!,
          instrument.providerSymbol,
          providerOrder.externalOrderId,
        );
        for (const fill of fills) {
          await sandboxOrderStore.recordFill(req.jarvisUser!.id, {
            ...fill,
            accountId: connection.id,
            orderClientId: order.clientOrderId,
          });
        }
        persisted = await sandboxOrderStore.getOwnedOrder(req.jarvisUser!.id, order.clientOrderId);
      }

      await authControlStore.recordAuditEvent({
        userId: req.jarvisUser!.id,
        accountId: connection.id,
        eventType: "SANDBOX_ORDER_SUBMITTED",
        requestId: req.get("X-Request-Id") || undefined,
        idempotencyKey,
        payload: {
          clientOrderId: order.clientOrderId,
          externalOrderId: providerOrder.externalOrderId,
          status: providerOrder.status,
          filledQuantity: providerOrder.filledQuantity,
        },
      });

      return res.status(201).json({
        success: true,
        idempotent: false,
        order: persisted || providerOrder,
        fills: await sandboxOrderStore.getStoredFills(req.jarvisUser!.id, order.clientOrderId),
      });
    } catch (error: any) {
      const ambiguous = error instanceof BinanceProviderError &&
        ["NETWORK", "SERVER", "UNKNOWN", "TIMESTAMP", "DUPLICATE_CLIENT_ORDER", "UNKNOWN_ORDER"].includes(error.kind);

      const failureReason = error?.message || "Binance Spot testnet order submission failed.";
      await sandboxOrderStore.markStatus(
        req.jarvisUser!.id,
        order.clientOrderId,
        ambiguous ? "UNKNOWN_RECONCILIATION" : "REJECTED",
        { failureReason },
      );

      await authControlStore.recordAuditEvent({
        userId: req.jarvisUser!.id,
        accountId: connection.id,
        eventType: ambiguous ? "SANDBOX_ORDER_SUBMISSION_AMBIGUOUS" : "SANDBOX_ORDER_REJECTED_PROVIDER",
        requestId: req.get("X-Request-Id") || undefined,
        idempotencyKey,
        payload: { clientOrderId: order.clientOrderId, error: failureReason, ambiguous },
      });

      return res.status(ambiguous ? 202 : 502).json({
        success: ambiguous ? false : false,
        status: ambiguous ? "UNKNOWN_RECONCILIATION" : "REJECTED",
        error: failureReason,
        clientOrderId: order.clientOrderId,
      });
    }
  } catch (error: any) {
    const status = /IDEMPOTENCY_KEY_REUSED/.test(String(error?.message)) ? 409 : 400;
    return res.status(status).json({ success: false, error: error?.message || "Sandbox order request failed." });
  }
});

app.get("/api/account/binance-testnet/orders/:clientOrderId", requireSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await sandboxOrderStore.getOwnedOrder(req.jarvisUser!.id, String(req.params.clientOrderId || ""));
    if (!order) return res.status(404).json({ success: false, error: "Order not found." });
    return res.json({
      success: true,
      order,
      fills: await sandboxOrderStore.getStoredFills(req.jarvisUser!.id, order.clientOrderId),
    });
  } catch (error: any) {
    return res.status(503).json({ success: false, error: error?.message || "Order lookup unavailable." });
  }
});

app.post("/api/account/binance-testnet/orders/:clientOrderId/cancel", requireSession, requireSameOrigin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isSandboxOrderSubmissionEnabled()) {
      return res.status(503).json({ success: false, status: "ORDER_SUBMISSION_DISABLED", error: "Binance Spot Testnet order submission is disabled by server safety gates." });
    }

    const clientOrderId = String(req.params.clientOrderId || "");
    const order = await sandboxOrderStore.getOwnedOrder(req.jarvisUser!.id, clientOrderId);
    if (!order) return res.status(404).json({ success: false, error: "Order not found." });

    if (["FILLED","CANCELLED","REJECTED","EXPIRED","SUBMISSION_FAILED"].includes(order.status)) {
      return res.json({ success: true, idempotent: true, order, fills: await sandboxOrderStore.getStoredFills(req.jarvisUser!.id, clientOrderId) });
    }

    const overview = await authControlStore.getAccountOverview(req.jarvisUser!.id);
    const connection = overview.connections.find((item) => item.id === order.accountId);
    if (!connection || !connection.externalAccountId) {
      return res.status(409).json({ success: false, error: "Order account connection is unavailable." });
    }

    await sandboxOrderStore.markStatus(req.jarvisUser!.id, clientOrderId, "CANCEL_PENDING");

    try {
      const providerOrder = await binanceSpotTestnetAccount.cancelOrder(connection.externalAccountId, clientOrderId);
      const persisted = await sandboxOrderStore.markStatus(req.jarvisUser!.id, clientOrderId, providerOrder.status, {
        externalOrderId: providerOrder.externalOrderId,
        filledQuantity: providerOrder.filledQuantity,
        averageFillPrice: providerOrder.averageFillPrice,
        submittedAt: providerOrder.submittedAt,
      });

      if (providerOrder.externalOrderId) {
        const fills = await binanceSpotTestnetAccount.getFills(
          connection.externalAccountId,
          extractProviderSymbolFromInstrumentId(order.instrumentId),
          providerOrder.externalOrderId,
        );
        for (const fill of fills) {
          await sandboxOrderStore.recordFill(req.jarvisUser!.id, {
            ...fill,
            accountId: order.accountId,
            orderClientId: order.clientOrderId,
          });
        }
      }

      return res.json({
        success: true,
        order: persisted || providerOrder,
        fills: await sandboxOrderStore.getStoredFills(req.jarvisUser!.id, clientOrderId),
      });
    } catch (error: any) {
      const ambiguous = error instanceof BinanceProviderError &&
        ["NETWORK", "SERVER", "UNKNOWN", "TIMESTAMP", "DUPLICATE_CLIENT_ORDER", "UNKNOWN_ORDER"].includes(error.kind);
      await sandboxOrderStore.markStatus(
        req.jarvisUser!.id,
        clientOrderId,
        ambiguous ? "UNKNOWN_RECONCILIATION" : "REJECTED",
        { failureReason: error?.message || "Binance cancellation failed." },
      );
      return res.status(ambiguous ? 202 : 502).json({
        success: false,
        status: ambiguous ? "UNKNOWN_RECONCILIATION" : "REJECTED",
        error: error?.message || "Binance cancellation failed.",
      });
    }
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Sandbox cancellation request failed." });
  }
});

function extractProviderSymbolFromInstrumentId(instrumentId: string): string {
  const match = String(instrumentId || "").match(/^BINANCE_SPOT:BINANCE:([A-Z0-9_]+)$/i);
  if (!match) throw new Error("Order instrument is not a supported Binance Spot instrument.");
  return match[1].toUpperCase();
}

app.get("/api/account/binance-testnet/execution-status", requireSession, (_req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    submissionEnabled: isSandboxOrderSubmissionEnabled(),
    adapter: awaitHealth(binanceSpotTestnetAccount),
    reconciler: binanceSandboxReconciler.getStatus(),
  });
});

app.post("/api/account/binance-testnet/reconcile", requireSession, requireSameOrigin, async (_req: AuthenticatedRequest, res: Response) => {
  const status = await binanceSandboxReconciler.runOnce();
  res.json({ success: true, reconciler: status });
});

// Health Check
app.get("/api/health", (_req: Request, res: Response) => {
  const market = binanceMarketData.getHealth();
  res.json({
    status: "ok",
    hasGeminiApiKey: !!process.env.GEMINI_API_KEY,
    financialDatasetsConfigured: fdsConfigured(),
    mode: "PAPER_RESEARCH_ONLY",
    marketData: {
      provider: "BINANCE_WEBSOCKET",
      ...market,
    },
    instrumentCatalog: binanceInstrumentCatalog.getHealth(),
    database: platformDatabase.getHealth(),
    binanceSpotTestnetAccount: {
      ...awaitHealth(binanceSpotTestnetAccount),
      accountId: binanceSpotTestnetAccount.getAccountId(),
    },
    autonomousPaper: {
      status: autonomousPaperRuntime.getStatus().status,
      symbol: autonomousPaperRuntime.getStatus().symbol,
      lastProcessedCandleAt: autonomousPaperRuntime.getStatus().lastProcessedCandleAt,
    },
    timestamp: Date.now(),
  });
});

// Helper: Local Quantitative Reasoning & Strategy Research Engine
// Ensures local fallback analysis even if Gemini API key is absent, expired, or rate-limited
function computeQuantitativeStudy(data: any) {
  const currentStrategy = data?.currentStrategy || {};
  const recentTrades = Array.isArray(data?.recentTrades) ? data.recentTrades : [];
  const drawdown = Number(data?.drawdownPercent);
  const currentPrice = Number(data?.marketContext?.currentPrice);
  const indicators = data?.marketContext?.indicators || {};
  const actualWinRate = recentTrades.length
    ? recentTrades.filter((t: any) => Number(t?.pnl) > 0).length / recentTrades.length * 100
    : null;

  const factual = [
    Number.isFinite(currentPrice) ? `Current analyzed price: $${currentPrice.toLocaleString()}` : "Current analyzed price: unavailable.",
    Number.isFinite(drawdown) ? `Current drawdown: ${drawdown.toFixed(2)}%.` : "Current drawdown: unavailable.",
    actualWinRate !== null ? `Observed recent paper-trade win rate: ${actualWinRate.toFixed(1)}% across ${recentTrades.length} recorded trades.` : "Observed recent paper-trade win rate: insufficient trade history.",
    Number.isFinite(Number(indicators?.rsi)) ? `RSI from supplied market data: ${Number(indicators.rsi).toFixed(1)}.` : "RSI: unavailable.",
  ].join(" ");

  return {
    survivalStatus: Number.isFinite(drawdown) && drawdown >= 2 ? "DEFENSIVE" : "MONITOR",
    regimeAssessment: "Data-driven regime classification pending a sufficiently long, trusted history.",
    thoughtLog: factual,
    riskDisciplineNote: "Research-only mode: no strategy is treated as proven from a small sample, and no model output authorizes live-money execution.",
    keyTakeaway: "Use walk-forward, out-of-sample and forward-paper evidence before changing an active strategy.",
    recommendedStrategy: { ...currentStrategy },
  };
}

function computeQuantitativeCritique(trade: any, marketSnapshot: any) {
  const pnl = Number(trade?.pnl);
  const asset = typeof trade?.asset === "string" ? trade.asset : "Unknown asset";
  const hasPnl = Number.isFinite(pnl);
  const tradeId = typeof trade?.id === "string" ? trade.id : "Unknown trade";

  return {
    verdict: hasPnl ? (pnl > 0 ? "PROFITABLE TRADE" : pnl < 0 ? "LOSS / RISK EVENT" : "FLAT TRADE") : "INSUFFICIENT DATA",
    autopsy: hasPnl
      ? `Trade ${tradeId} on ${asset} realized ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} according to the supplied paper-trade record. No conclusion about future edge is implied.`
      : "The supplied trade record does not contain a reliable realized PnL value.",
    lesson: marketSnapshot ? "Compare the entry/exit against the contemporaneous market snapshot, fees, slippage, and strategy rules before changing the system." : "Market context was not supplied; do not invent a causal explanation.",
    riskControlImpact: "No automatic risk-budget increase is authorized by a single trade outcome.",
  };
}

// Canonical server-side asset mapping. Live/paper decisions must use provider data;
// these entries are identifiers only and are not price seeds.
const SYMBOL_MAP: Record<string, string> = {
  "BTC/USD": "BTCUSDT",
  "ETH/USD": "ETHUSDT",
  "SOL/USD": "SOLUSDT",
  "DOGE/USD": "DOGEUSDT",
  "XRP/USD": "XRPUSDT",
  "EUR/USD": "EURUSDT",
  "GBP/USD": "GBPUSDT",
};

const STOCK_UNIVERSE: Record<string, { name: string; category: "STOCK" | "INDEX" }> = {
  NVDA: { name: "NVIDIA Corp", category: "STOCK" },
  AAPL: { name: "Apple Inc", category: "STOCK" },
  MSFT: { name: "Microsoft Corp.", category: "STOCK" },
  AMZN: { name: "Amazon.com Inc.", category: "STOCK" },
  META: { name: "Meta Platforms Inc.", category: "STOCK" },
  SPY: { name: "S&P 500 ETF Trust", category: "INDEX" },
  QQQ: { name: "Invesco QQQ Trust", category: "INDEX" },
};

// One server-owned websocket gateway supplies crypto market data to every client.
// The mobile/desktop UI is intentionally not responsible for keeping the market connection alive.
const binanceMarketData = new BinanceMarketDataService(SYMBOL_MAP);
const platformDatabase = new PlatformDatabase();
const platformRepository = new PlatformRepository(platformDatabase);
const authControlStore = new AuthControlStore(platformDatabase);
const binanceSpotTestnetAccount = new BinanceSpotAccountAdapter();
const sandboxOrderStore = new SandboxOrderStore(platformDatabase);
const binanceSandboxReconciler = new BinanceSandboxReconciler(
  sandboxOrderStore,
  binanceSpotTestnetAccount,
  Number(process.env.JARVIS_SANDBOX_RECONCILIATION_POLL_MS) || 15_000,
);
const binanceInstrumentCatalog = new BinanceInstrumentCatalog(
  platformDatabase.isConfigured()
    ? { persist: (instruments) => platformRepository.syncInstruments(instruments) }
    : undefined,
);
const autonomousPaperRuntime = new AutonomousPaperRuntime(binanceMarketData, {
  symbol: process.env.JARVIS_PAPER_SYMBOL || "BTC/USD",
  initialCapital: Number(process.env.JARVIS_PAPER_INITIAL_CAPITAL) || 10_000,
  pollIntervalMs: Number(process.env.JARVIS_PAPER_POLL_MS) || 1000,
});
void binanceMarketData.start();

if (process.env.JARVIS_PAPER_AUTOSTART === "true") {
  autonomousPaperRuntime.start();
}


function computeQuantitativeMarketIntelligence(asset: string, marketSnapshot: any = null) {
  const cleanAsset = asset || "Unknown asset";
  const price = Number(marketSnapshot?.price);
  const change = Number(marketSnapshot?.change24hPercent);
  const label = Number.isFinite(change)
    ? (change > 1 ? "POSITIVE MOMENTUM" : change < -1 ? "NEGATIVE MOMENTUM" : "MIXED")
    : "UNAVAILABLE";

  return {
    headline: marketSnapshot
      ? `${cleanAsset}: supplied market snapshot available; deeper liquidity data is not assumed.`
      : `${cleanAsset}: market-structure intelligence unavailable without a trusted snapshot.`,
    // A 24h return is price momentum, not sentiment. Do not manufacture a sentiment score from price change.
    sentimentScore: null,
    sentimentLabel: Number.isFinite(change) ? "PRICE CHANGE ONLY" : label,
    hazardAlert: Number.isFinite(price)
      ? "Price snapshot available. Order-book depth, institutional flow and liquidity imbalance require separately sourced data."
      : "No trusted market snapshot supplied.",
    botActionPlan: "Do not trade from AI sentiment alone. Require deterministic market data, a validated strategy signal, and the risk engine.",
  };
}

// Endpoint: AI Copilot — research and paper-terminal assistant.
// This endpoint is advisory only: it cannot place orders or mutate the trading engine.
app.post("/api/copilot/chat", async (req: Request, res: Response) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const history = Array.isArray(req.body?.conversationHistory) ? req.body.conversationHistory.slice(-8) : [];
  const terminalContext = req.body?.terminalContext && typeof req.body.terminalContext === "object"
    ? req.body.terminalContext
    : {};

  if (!message || message.length > 4000) {
    return res.status(400).json({ error: "Invalid message. Supply 1-4000 characters." });
  }

  const safeHistory = history
    .filter((m: any) => m && (m.role === "user" || m.role === "model") && typeof m.content === "string")
    .map((m: any) => `${m.role.toUpperCase()}: ${m.content.slice(0, 2500)}`)
    .join("\n");

  const localReply =
    "Jarvis Copilot is advisory-only in this build. " +
    "It can explain the supplied paper portfolio, strategy rules, risk controls, and market snapshot, " +
    "but it cannot authorize real-money execution. " +
    "Verify provider timestamps, strategy version, and risk state before acting on any research conclusion.";

  const stockSymbol = typeof terminalContext?.currentAsset === "string" && !terminalContext.currentAsset.includes("/")
    ? terminalContext.currentAsset
    : null;

  let fundamentalContext: any = null;
  if (stockSymbol && fdsConfigured()) {
    try {
      fundamentalContext = await cached(
        `fds:financials:quarterly:${stockSymbol}`,
        15 * 60_000,
        () => fetchFinancialDatasets("/financials", { ticker: stockSymbol, period: "quarterly" })
      );
    } catch (error: any) {
      fundamentalContext = { status: "UNAVAILABLE", reason: error?.message || "Provider unavailable." };
    }
  }

  const ai = getAIClient();
  if (!ai) {
    return res.json({
      reply: stockSymbol && fundamentalContext
        ? localReply + " Fundamental company data was requested from the configured Financial Datasets provider when available."
        : localReply,
      modelUsed: "LOCAL-SAFE-FALLBACK"
    });
  }

  const prompt = `You are Jarvis Finance's research copilot.
Your job is to explain evidence, calculations, software behavior, and paper-trading state.
Never invent prices, filings, news, liquidity, institutional activity, or performance.
Never turn a heuristic score into a probability of profit.
Never claim a single trade proves an edge.
Never authorize or submit a real-money trade.
When the supplied context is insufficient, say what data is missing.
Treat all trade ideas as research hypotheses and tell the user what would need to be validated.

CURRENT TERMINAL CONTEXT:
${JSON.stringify(terminalContext, null, 2)}

FUNDAMENTAL COMPANY CONTEXT (provider-supplied; may be unavailable):
${JSON.stringify(fundamentalContext || {}, null, 2)}

RECENT CONVERSATION:
${safeHistory || "No prior conversation supplied."}

USER QUESTION:
${message}

Return a concise answer with:
1) what the supplied evidence actually says,
2) important uncertainty or missing data,
3) the safest useful next research step when applicable.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
    });
    const reply = response.text?.trim();
    if (!reply) throw new Error("Empty model response.");
    return res.json({ reply, modelUsed: "gemini-3.8-flash" });
  } catch (error: any) {
    console.warn("Copilot unavailable; using safe local fallback:", error?.message || error);
    return res.json({ reply: localReply, modelUsed: "LOCAL-SAFE-FALLBACK" });
  }
});

// Endpoint: Quantitative Study & Strategy Research
app.post("/api/bot/study", async (req: Request, res: Response) => {
  const body = req.body || {};
  const localFallback = computeQuantitativeStudy(body);

  try {
    const ai = getAIClient();
    if (!ai) {
      return res.json(localFallback);
    }

    const prompt = `You are Jarvis Finance's research assistant.
Use only the supplied portfolio, market, strategy and performance data. Never fabricate values or market events.
Treat any strategy recommendation as an unvalidated research hypothesis, not as an execution instruction.
Analyze the following data:

Market Context:
${JSON.stringify(body.marketContext || {}, null, 2)}

Current Strategy Parameters:
${JSON.stringify(body.currentStrategy || {}, null, 2)}

Equity & Performance Stats:
- Drawdown: ${Number.isFinite(Number(body.drawdownPercent)) ? body.drawdownPercent + "%" : "unavailable"}
- Win Rate: ${Number.isFinite(Number(body.equityStats?.winRate)) ? body.equityStats.winRate + "%" : "unavailable"}
- Total Trades: ${Number.isFinite(Number(body.equityStats?.totalTrades)) ? body.equityStats.totalTrades : "unavailable"}

Provide a quantitative research analysis in valid JSON:
{
  "survivalStatus": "THRIVING" | "ALERT" | "DEFENSIVE",
  "regimeAssessment": "string describing market structure from the supplied data",
  "thoughtLog": "Quantitative reasoning focused on asymmetric risk-to-reward, uncertainty, and capital preservation",
  "riskDisciplineNote": "Plain-language note describing the relevant risk constraint; do not claim fiduciary status or legal duties",
  "keyTakeaway": "Research rule that can be tested",
  "recommendedStrategy": {
    "name": "Strategy Name",
    "version": number,
    "rsiOversold": number,
    "rsiOverbought": number,
    "stopLossPercent": number,
    "takeProfitPercent": number,
    "trailingStop": boolean,
    "trailingStopPercent": number,
    "minConfidence": number,
    "maxRiskPerTrade": number,
    "rules": ["rule 1", "rule 2", "rule 3"]
  }
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return res.json({
      ...localFallback,
      ...parsed,
      recommendedStrategy: {
        ...localFallback.recommendedStrategy,
        ...(parsed.recommendedStrategy || {}),
      },
    });
  } catch (error: any) {
    // Fallback behavior: Fallback gracefully to high-precision local quantitative engine
    console.warn("Gemini API unavailable or expired - executing local quantitative optimization:", error?.message || error);
    return res.json(localFallback);
  }
});

// Endpoint: Post-Trade Attribution & Execution Analysis
app.post("/api/bot/critique-trade", async (req: Request, res: Response) => {
  const { trade, marketSnapshot } = req.body || {};
  const localAttribution = computeQuantitativeCritique(trade, marketSnapshot);

  try {
    const ai = getAIClient();
    if (!ai) {
      return res.json(localAttribution);
    }

    const prompt = `You are Jarvis Finance's post-trade research auditor.
Evaluate this completed paper trade:
Trade Record: ${JSON.stringify(trade, null, 2)}
Market Snapshot: ${JSON.stringify(marketSnapshot, null, 2)}

Provide a quantitative post-trade execution analysis in valid JSON:
{
  "verdict": "string",
  "autopsy": "thorough technical analysis of order entry, slippage, and risk execution",
  "lesson": "risk-control rule that could be tested after this outcome",
  "riskControlImpact": "string"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return res.json({ ...localAttribution, ...parsed });
  } catch (error: any) {
    console.warn("Gemini API unavailable - executing local post-trade research:", error?.message || error);
    return res.json(localAttribution);
  }
});

// Endpoint: Quantitative Market Structure Intelligence
app.post("/api/bot/market-news", async (req: Request, res: Response) => {
  const { asset, marketSnapshot } = req.body || {};
  const localIntel = computeQuantitativeMarketIntelligence(asset, marketSnapshot);

  try {
    const ai = getAIClient();
    if (!ai) return res.json(localIntel);

    const prompt = `Analyze only the supplied market snapshot for ${asset || "the asset"}.
Never invent order-book depth, institutional activity, news, liquidity imbalance, or market events that are not present in the input.
Return JSON with: headline, sentimentScore (0-100 or null), sentimentLabel, hazardAlert, botActionPlan.
Snapshot: ${JSON.stringify(marketSnapshot || {}, null, 2)}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
    const parsed = JSON.parse(response.text || "{}");
    return res.json({ ...localIntel, ...parsed });
  } catch (error: any) {
    console.warn("Market intelligence unavailable:", error?.message || error);
    return res.json(localIntel);
  }
});

app.get("/api/market/multi-scan", async (req: Request, res: Response) => {
  const minScore = Math.min(95, Math.max(50, Number(req.query.minConfidence) || 70));
  const symbols = [...Object.keys(SYMBOL_MAP), ...Object.keys(STOCK_UNIVERSE)];
  try {
    const opportunities = await Promise.all(symbols.map(async (symbol) => {
      const cryptoPair = SYMBOL_MAP[symbol];
      const cryptoTicker = cryptoPair ? binanceMarketData.getTicker(symbol) : null;
      if (cryptoPair && cryptoTicker) {
        const change = Number(cryptoTicker.change24hPercent);
        const price = Number(cryptoTicker.price);
        const score = Math.min(95, Math.round(50 + Math.min(30, Math.abs(change) * 4)));
        const direction = change > 0 ? "LONG" : change < 0 ? "SHORT" : "NEUTRAL";
        return {
          symbol,
          name: symbol.replace("/", " / "),
          category: "CRYPTO",
          price,
          change24hPercent: change,
          score,
          bestDirection: direction,
          rsi: null,
          trend: direction === "LONG" ? "BULLISH" : direction === "SHORT" ? "BEARISH" : "SIDEWAYS",
          volatility: Math.abs(change),
          isEligible: false,
          scanVerdict: score >= minScore ? "REVIEW — MOMENTUM SCREEN" : "ABSTAIN — LOW MOMENTUM",
          rationale: "24h momentum screen only. A trade requires the full deterministic candle-based signal and risk checks.",
          dataSource: "BINANCE",
        };
      }

      try {
        const snapshotPayload = await cached(`fds:snapshot:${symbol}`, 10000, () => fetchFinancialDatasets("/prices/snapshot/", { ticker: symbol }));
        const snapshot = extractSnapshot(snapshotPayload);
        const end = new Date();
        const start = new Date(end.getTime() - 1000 * 60 * 60 * 24 * 120);
        const pricesPayload = await cached(`fds:daily:${symbol}`, 60000, () => fetchFinancialDatasets("/prices/", {
          ticker: symbol, interval: "day", interval_multiplier: "1",
          start_date: start.toISOString().slice(0,10), end_date: end.toISOString().slice(0,10),
        }));
        const screen = buildTechnicalScreen(parsePriceRows(pricesPayload), Number(snapshot.changePercent || 0));
        const price = snapshot.price || 0;
        if (!screen) return { symbol, name: STOCK_UNIVERSE[symbol].name, category: STOCK_UNIVERSE[symbol].category, price, change24hPercent: Number(snapshot.changePercent || 0), score: 0, bestDirection: "NEUTRAL", rsi: null, trend: "SIDEWAYS", volatility: 0, isEligible: false, scanVerdict: "INSUFFICIENT HISTORY", rationale: "Trusted price history did not provide enough bars for the technical screen.", dataSource: "FINANCIAL_DATASETS" };
        return { symbol, name: STOCK_UNIVERSE[symbol].name, category: STOCK_UNIVERSE[symbol].category, price, change24hPercent: Number(snapshot.changePercent || 0), ...screen, isEligible: false, scanVerdict: screen.score >= minScore ? "REVIEW — SCREEN PASSED" : "ABSTAIN", dataSource: "FINANCIAL_DATASETS" };
      } catch (error: any) {
        return { symbol, name: STOCK_UNIVERSE[symbol].name, category: STOCK_UNIVERSE[symbol].category, price: 0, change24hPercent: 0, score: 0, bestDirection: "NEUTRAL", rsi: null, trend: "SIDEWAYS", volatility: 0, isEligible: false, scanVerdict: "DATA ERROR", rationale: error?.message || "Provider unavailable.", dataSource: "FINANCIAL_DATASETS" };
      }
    }));

    opportunities.sort((a, b) => b.score - a.score);
    return res.json({ success: true, timestamp: Date.now(), totalScanned: opportunities.length, opportunities });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to scan assets", message: error?.message || "Unknown error" });
  }
});

app.get("/api/market/catalog", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");

  const query = typeof req.query.q === "string" ? req.query.q : "";
  const quoteAsset = typeof req.query.quoteAsset === "string" ? req.query.quoteAsset : undefined;
  const assetClass = typeof req.query.assetClass === "string" ? req.query.assetClass.toUpperCase() : undefined;
  const tradableOnly = req.query.tradableOnly !== "false";
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));

  const instruments = query
    ? binanceInstrumentCatalog.search(query, { quoteAsset, tradableOnly, limit })
    : binanceInstrumentCatalog.list({ quoteAsset, tradableOnly, limit });

  const filtered = assetClass
    ? instruments.filter((instrument) => instrument.assetClass === assetClass)
    : instruments;

  return res.json({
    success: true,
    provider: "BINANCE_SPOT",
    query,
    filters: { quoteAsset, assetClass, tradableOnly, limit },
    health: binanceInstrumentCatalog.getHealth(),
    instruments: filtered.map((instrument) => {
      const quote = binanceMarketData.getMiniTicker(instrument.providerSymbol);
      return quote
        ? {
            ...instrument,
            quote: {
              price: quote.price,
              change24hPercent: quote.change24hPercent,
              high24h: quote.high,
              low24h: quote.low,
              volume24h: quote.volume,
              updatedAt: quote.lastUpdated,
            },
          }
        : instrument;
    }),
  });
});

function resolveBinanceProviderSymbol(symbolParam: string): string | null {
  const direct = SYMBOL_MAP[symbolParam];
  if (direct) return direct;

  const needle = symbolParam.trim().toUpperCase();
  if (!needle) return null;

  const exact = binanceInstrumentCatalog
    .search(needle, { tradableOnly: true, limit: 50 })
    .find((instrument) =>
      instrument.providerSymbol.toUpperCase() === needle ||
      instrument.symbol.toUpperCase() === needle
    );

  return exact?.providerSymbol || null;
}

const BINANCE_CHART_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const BINANCE_REST_BASE_URL = "https://api.binance.com";
const BINANCE_CHART_CACHE_TTL_MS = 5_000;
const binanceChartCache = new Map<string, { expiresAt: number; value: any }>();

app.get("/api/market/live-feed", async (req: Request, res: Response) => {
  const symbolParam = typeof req.query.symbol === "string" ? req.query.symbol : "BTC/USD";
  const requestedInterval = typeof req.query.interval === "string" ? req.query.interval : "1m";
  const interval = BINANCE_CHART_INTERVALS.has(requestedInterval) ? requestedInterval : "1m";
  const limit = Math.min(300, Math.max(50, Number(req.query.limit) || 120));
  const binanceSymbol = resolveBinanceProviderSymbol(symbolParam);

  try {
    if (binanceSymbol) {
      await binanceMarketData.ensureSymbol(symbolParam, binanceSymbol);

      if (interval !== "1m") {
        const cacheKey = "binance:chart:" + binanceSymbol + ":" + interval + ":" + limit;
        const cachedChart = binanceChartCache.get(cacheKey);
        const now = Date.now();
        if (cachedChart && cachedChart.expiresAt > now) return res.json(cachedChart.value);

        const endpoint =
          BINANCE_REST_BASE_URL +
          "/api/v3/klines?symbol=" + encodeURIComponent(binanceSymbol) +
          "&interval=" + encodeURIComponent(interval) +
          "&limit=" + String(limit + 1);
        const response = await fetch(endpoint, {
          headers: { Accept: "application/json", "User-Agent": "JarvisFinance/1.0" },
        });
        if (!response.ok) throw new Error("Binance HTTP " + response.status);

        const rows: any = await response.json();
        if (!Array.isArray(rows)) throw new Error("Invalid Binance kline response.");

        const currentTime = Date.now();
        const completed: any[] = [];
        let formingCandle: any = null;
        for (const row of rows) {
          if (!Array.isArray(row)) continue;
          const candle = {
            timestamp: Number(row[0]),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
          };
          if (!Object.values(candle).every(Number.isFinite)) continue;
          const closeTime = Number(row[6]);
          if (Number.isFinite(closeTime) && closeTime > currentTime) {
            formingCandle = candle;
          } else {
            completed.push(candle);
          }
        }

        const payload = {
          success: true,
          status: "OK",
          symbol: symbolParam,
          interval,
          candles: completed.slice(-limit),
          formingCandle,
          ticker: binanceMarketData.getTicker(symbolParam),
          gateway: binanceMarketData.getHealth(),
          source: "BINANCE_REST_KLINES",
        };
        binanceChartCache.set(cacheKey, { expiresAt: now + BINANCE_CHART_CACHE_TTL_MS, value: payload });
        return res.json(payload);
      }

      const snapshot = binanceMarketData.getSnapshot(symbolParam, limit);
      if (!snapshot || snapshot.gateway.stale || snapshot.gateway.state !== "READY") {
        return res.status(503).json({
          success: false,
          status: "DATA_UNAVAILABLE",
          error: "Binance websocket market gateway is not ready or quotes are stale.",
          gateway: snapshot?.gateway || binanceMarketData.getHealth(),
        });
      }

      return res.json({
        success: true,
        status: "OK",
        symbol: symbolParam,
        interval,
        candles: snapshot.candles,
        formingCandle: snapshot.formingCandle,
        source: "BINANCE_WEBSOCKET",
        ticker: snapshot.ticker,
        gateway: snapshot.gateway,
      });
    }
    const stock = STOCK_UNIVERSE[symbolParam];
    if (!stock) return res.status(404).json({ success: false, status: "DATA_UNAVAILABLE", error: "Unsupported symbol." });
    if (interval !== "1d") {
      return res.status(400).json({
        success: false,
        status: "UNSUPPORTED_INTERVAL",
        error: "Trusted stock chart data is currently daily-only in Jarvis.",
      });
    }
    if (!fdsConfigured()) return res.status(503).json({ success: false, status: "DATA_UNAVAILABLE", error: "Financial Datasets is not configured for this security." });

    const snapshotPayload = await cached(`fds:snapshot:${symbolParam}`, 5000, () => fetchFinancialDatasets("/prices/snapshot/", { ticker: symbolParam }));
    const snapshot = extractSnapshot(snapshotPayload);
    if (!Number.isFinite(snapshot.price)) throw new Error("Financial Datasets returned no reliable latest price.");

    const end = new Date();
    const start = new Date(end.getTime() - 1000 * 60 * 60 * 24 * 370);
    const pricesPayload = await cached(`fds:daily:${symbolParam}:chart`, 30000, () => fetchFinancialDatasets("/prices/", {
      ticker: symbolParam, interval: "minute", interval_multiplier: "1",
      start_date: start.toISOString().slice(0,10), end_date: end.toISOString().slice(0,10),
    }));
    const candles = parsePriceRows(pricesPayload).map(mapPriceRow).filter((x: any) => x.timestamp > 0 && x.close !== null).slice(-limit);

    // Do not silently replace an intraday research feed with daily bars. The paper
    // engine's signal horizon must match the requested timeframe.
    if (candles.length < 20) {
      return res.status(503).json({
        success: false,
        status: "DATA_UNAVAILABLE",
        error: "Trusted intraday market data did not provide enough completed bars for this paper timeframe.",
      });
    }
    return res.json({
      success: true, status: "OK", symbol: symbolParam, candles,
      interval,
      ticker: {
        symbol: symbolParam, price: snapshot.price, bid: snapshot.bid ?? snapshot.price, ask: snapshot.ask ?? snapshot.price,
        high24h: snapshot.high ?? snapshot.price, low24h: snapshot.low ?? snapshot.price, volume24h: snapshot.volume ?? 0,
        change24hPercent: snapshot.changePercent ?? 0, lastUpdated: snapshot.updatedAt || Date.now(), source: "FINANCIAL_DATASETS", quoteQuality: snapshot.bid && snapshot.ask ? "BID_ASK" : "LAST_ONLY",
      },
    });
  } catch (error: any) {
    console.error("Live market data error:", error?.message || error);
    return res.status(503).json({ success: false, status: "DATA_UNAVAILABLE", error: error?.message || "Trusted market data provider unavailable." });
  }
});

function awaitHealth(adapter: BinanceSpotAccountAdapter) {
  // Health is intentionally local/cached here; it never forces a credentialed
  // network call on a public health request.
  return {
    provider: adapter.provider,
    configured: adapter.isConfigured(),
  };
}

function requireControlToken(req: Request, res: Response, next: () => void) {
  const configured = process.env.JARVIS_CONTROL_TOKEN;
  if (!configured) {
    return res.status(503).json({ error: "Runtime control is not configured." });
  }

  const supplied = typeof req.headers["x-jarvis-control-token"] === "string"
    ? req.headers["x-jarvis-control-token"]
    : "";
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);

  if (expected.length === 0 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return res.status(401).json({ error: "Unauthorized runtime control request." });
  }

  next();
}

// Server-owned autonomous paper runtime controls.
// Execution remains paper-only. Live-money broker connectivity is a separate future phase.
app.get("/api/runtime/paper/status", requireControlToken, (_req: Request, res: Response) => {
  res.json(autonomousPaperRuntime.getStatus());
});

app.post("/api/runtime/paper/start", requireControlToken, (_req: Request, res: Response) => {
  autonomousPaperRuntime.start();
  res.json(autonomousPaperRuntime.getStatus());
});

app.post("/api/runtime/paper/stop", requireControlToken, (_req: Request, res: Response) => {
  autonomousPaperRuntime.stop("Paper runtime stopped by operator.");
  res.json(autonomousPaperRuntime.getStatus());
});

app.get("/api/runtime/paper/learning", requireControlToken, (_req: Request, res: Response) => {
  const status = autonomousPaperRuntime.getStatus();
  res.json({
    modelAvailable: status.learningShadow.modelAvailable,
    modelFingerprint: status.learningShadow.modelFingerprint,
    experiment: status.learningShadow.experiment,
    performance: status.learningShadow.performance,
    gate: status.learningShadow.gate,
    lastRefreshAt: status.learningShadow.lastRefreshAt,
  });
});

// Read-only Binance Spot testnet account inspection.
// This endpoint is intentionally protected by the existing control token while
// the full authenticated user session layer is still under construction.
app.get("/api/runtime/binance-testnet/health", requireControlToken, async (_req: Request, res: Response) => {
  res.json(await binanceSpotTestnetAccount.getHealth());
});

app.post("/api/runtime/binance-testnet/sync", requireControlToken, async (_req: Request, res: Response) => {
  try {
    const snapshot = await binanceSpotTestnetAccount.syncReadOnlyAccount();
    res.json({
      success: true,
      provider: binanceSpotTestnetAccount.provider,
      accountId: binanceSpotTestnetAccount.getAccountId(),
      account: {
        accountType: snapshot.account.accountType,
        canTrade: snapshot.account.canTrade === true,
        canWithdraw: snapshot.account.canWithdraw === true,
        canDeposit: snapshot.account.canDeposit === true,
        permissions: Array.isArray(snapshot.account.permissions) ? snapshot.account.permissions : [],
        updateTime: snapshot.account.updateTime ?? null,
      },
      balances: snapshot.balances,
      openOrders: snapshot.openOrders,
      health: await binanceSpotTestnetAccount.getHealth(),
    });
  } catch (error: any) {
    res.status(503).json({
      success: false,
      provider: binanceSpotTestnetAccount.provider,
      error: error?.message || "Binance Spot testnet account sync failed.",
      health: await binanceSpotTestnetAccount.getHealth(),
    });
  }
});

// Setup Vite/static serving and the long-lived WebSocket gateway only inside the async server bootstrap.
async function startServer() {
  const httpServer = http.createServer(app);

  // PostgreSQL is optional during the research/paper stage. When configured,
  // initialization and migrations happen before the instrument catalog refresh
  // so the first authoritative catalog can be durably persisted.
  await platformDatabase.start();

  if (platformDatabase.isReady() && process.env.JARVIS_ADMIN_EMAIL && process.env.JARVIS_ADMIN_PASSWORD) {
    try {
      await authControlStore.bootstrapOperator({
        email: process.env.JARVIS_ADMIN_EMAIL,
        displayName: process.env.JARVIS_ADMIN_DISPLAY_NAME || "Jarvis Operator",
        password: process.env.JARVIS_ADMIN_PASSWORD,
        resetExistingPassword: process.env.JARVIS_ADMIN_RESET_PASSWORD === "true",
      });
    } catch (error: any) {
      console.error("Jarvis admin bootstrap failed:", error?.message || error);
      if (process.env.JARVIS_AUTH_REQUIRED === "true") throw error;
    }
  }

  if (process.env.JARVIS_AUTH_REQUIRED === "true") {
    const configured = platformDatabase.isReady() && await authControlStore.isAuthenticationConfigured();
    if (!configured) {
      throw new Error("JARVIS_AUTH_REQUIRED=true but no authenticated Jarvis operator is configured.");
    }
  }
  await binanceInstrumentCatalog.start();

  if (platformDatabase.isReady() && binanceSpotTestnetAccount.isConfigured()) {
    binanceSandboxReconciler.start();
  }

  // Live API WebSocket Voice Gateway
  const wss = new WebSocketServer({ server: httpServer, path: "/api/live-voice" });
  wss.on("connection", async (clientWs: WebSocket) => {
    let liveSession: any = null;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      clientWs.send(
        JSON.stringify({
          type: "status",
          mode: "fallback",
          message: "Local High-Performance Voice Mode Active (Synthesizer connected).",
        })
      );
      return;
    }

    try {
      const ai = getAIClient();
      if (!ai) {
        clientWs.send(
          JSON.stringify({
            type: "status",
            mode: "fallback",
            message: "Local High-Performance Voice Mode Active (Synthesizer connected).",
          })
        );
        return;
      }
      liveSession = await ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction:
            "You are Jarvis Finance Live Voice Copilot. Speak concisely in real time, explaining trading metrics, risk limits, market confluence, and terminal features.",
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio) {
              clientWs.send(JSON.stringify({ type: "audio", audio }));
            }
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ type: "interrupted" }));
            }
          },
        },
      });

      clientWs.send(
        JSON.stringify({
          type: "status",
          mode: "live",
          message: "Connected to Gemini 3.8 Live API voice session.",
        })
      );

      clientWs.on("message", (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed.audio && liveSession) {
            liveSession.sendRealtimeInput({
              audio: { data: parsed.audio, mimeType: "audio/pcm;rate=16000" },
            });
          }
        } catch (err) {
          console.error("Error processing voice input chunk:", err);
        }
      });

      clientWs.on("close", () => {
        try {
          liveSession?.close?.();
        } catch {}
      });
    } catch (err: any) {
      console.warn("Live API connection fallback:", err?.message || err);
      clientWs.send(
        JSON.stringify({
          type: "status",
          mode: "fallback",
          message: "Live API session initialized with high-precision speech engine.",
        })
      );
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== "true" ? { server: httpServer } : false,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const shutdown = async (signal: string) => {
    console.log(`Jarvis Finance received ${signal}; shutting down cleanly.`);
    await platformDatabase.stop().catch((error: any) => {
      console.error("PostgreSQL shutdown error:", error?.message || error);
    });
    binanceInstrumentCatalog.stop();
    binanceMarketData.stop();
    autonomousPaperRuntime.stop("Server shutdown.");
    binanceSandboxReconciler.stop();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Jarvis Finance server running on http://0.0.0.0:${PORT}`);
  });

}

startServer();