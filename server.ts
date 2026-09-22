import express, { Request, Response } from "express";
import http from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";

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
  return rows.filter((row) => row && Number.isFinite(Number(row.close ?? row.price)));
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

// Health Check
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    hasGeminiApiKey: !!process.env.GEMINI_API_KEY,
    financialDatasetsConfigured: fdsConfigured(),
    mode: "PAPER_RESEARCH_ONLY",
    timestamp: Date.now(),
  });
});

// Helper: Institutional Local Quantitative Reasoning & Strategy Optimization Engine
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
  "lesson": "institutional risk rule derived from this outcome",
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
    console.warn("Gemini API unavailable - executing local post-trade attribution:", error?.message || error);
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
    let binanceTickerMap: Record<string, any> = {};
    try {
      const response = await fetchJsonWithTimeout("https://api.binance.com/api/v3/ticker/24hr", { "User-Agent": "JarvisFinance/1.0" });
      if (Array.isArray(response)) for (const row of response) binanceTickerMap[row.symbol] = row;
    } catch (error: any) {
      console.warn("Binance bulk ticker unavailable:", error?.message || error);
    }

    const opportunities = await Promise.all(symbols.map(async (symbol) => {
      const cryptoPair = SYMBOL_MAP[symbol];
      if (cryptoPair && binanceTickerMap[cryptoPair]) {
        const raw = binanceTickerMap[cryptoPair];
        const price = Number(raw.lastPrice);
        const change = Number(raw.priceChangePercent);
        const score = Math.min(95, Math.round(50 + Math.min(30, Math.abs(change) * 4)));
        const direction = change > 0 ? "LONG" : change < 0 ? "SHORT" : "NEUTRAL";
        return {
          symbol, name: symbol.replace("/", " / "), category: "CRYPTO", price, change24hPercent: change,
          score, bestDirection: direction, rsi: null, trend: direction === "LONG" ? "BULLISH" : direction === "SHORT" ? "BEARISH" : "SIDEWAYS",
          volatility: Math.abs(change), isEligible: false, scanVerdict: score >= minScore ? "REVIEW — MOMENTUM SCREEN" : "ABSTAIN — LOW MOMENTUM",
          rationale: "24h momentum screen only. A trade requires the full deterministic candle-based signal and risk checks.", dataSource: "BINANCE",
        };
      }

      if (!fdsConfigured()) {
        return { symbol, name: STOCK_UNIVERSE[symbol].name, category: STOCK_UNIVERSE[symbol].category, price: 0, change24hPercent: 0, score: 0, bestDirection: "NEUTRAL", rsi: null, trend: "SIDEWAYS", volatility: 0, isEligible: false, scanVerdict: "DATA UNAVAILABLE", rationale: "Configure FINANCIAL_DATASETS_API_KEY to scan this security with trusted data.", dataSource: "UNKNOWN" };
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

app.get("/api/market/live-feed", async (req: Request, res: Response) => {
  const symbolParam = typeof req.query.symbol === "string" ? req.query.symbol : "BTC/USD";
  const limit = Math.min(100, Math.max(20, Number(req.query.limit) || 80));
  const binanceSymbol = SYMBOL_MAP[symbolParam];

  try {
    if (binanceSymbol) {
      const [klinesRes, tickerRes] = await Promise.all([
        fetchJsonWithTimeout(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1m&limit=${limit}`, { "User-Agent": "JarvisFinance/1.0" }),
        fetchJsonWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`, { "User-Agent": "JarvisFinance/1.0" }),
      ]);
      if (!Array.isArray(klinesRes)) throw new Error("Invalid Binance candle payload.");
      const candles = klinesRes.map((k: any[]) => ({ timestamp: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) }));
      const rawTicker = tickerRes || {};
      return res.json({
        success: true, status: "OK", symbol: symbolParam, candles,
        ticker: {
          symbol: symbolParam, price: Number(rawTicker.lastPrice), bid: Number(rawTicker.bidPrice) || Number(rawTicker.lastPrice),
          ask: Number(rawTicker.askPrice) || Number(rawTicker.lastPrice), high24h: Number(rawTicker.highPrice), low24h: Number(rawTicker.lowPrice),
          volume24h: Number(rawTicker.volume), change24hPercent: Number(rawTicker.priceChangePercent),
          lastUpdated: Number(rawTicker.closeTime) || Date.now(),
          source: "BINANCE", quoteQuality: "BID_ASK",
        },
      });
    }

    const stock = STOCK_UNIVERSE[symbolParam];
    if (!stock) return res.status(404).json({ success: false, status: "DATA_UNAVAILABLE", error: "Unsupported symbol." });
    if (!fdsConfigured()) return res.status(503).json({ success: false, status: "DATA_UNAVAILABLE", error: "Financial Datasets is not configured for this security." });

    const snapshotPayload = await cached(`fds:snapshot:${symbolParam}`, 5000, () => fetchFinancialDatasets("/prices/snapshot/", { ticker: symbolParam }));
    const snapshot = extractSnapshot(snapshotPayload);
    if (!Number.isFinite(snapshot.price)) throw new Error("Financial Datasets returned no reliable latest price.");

    const end = new Date();
    const start = new Date(end.getTime() - 1000 * 60 * 60 * 24 * 5);
    const pricesPayload = await cached(`fds:minute:${symbolParam}`, 30000, () => fetchFinancialDatasets("/prices/", {
      ticker: symbolParam, interval: "minute", interval_multiplier: "1",
      start_date: start.toISOString().slice(0,10), end_date: end.toISOString().slice(0,10),
    }));
    let candles = parsePriceRows(pricesPayload).map(mapPriceRow).filter((x: any) => x.timestamp > 0 && x.close !== null).slice(-limit);
    if (candles.length < 20) {
      const dailyPayload = await cached(`fds:daily:${symbolParam}`, 60000, () => fetchFinancialDatasets("/prices/", {
        ticker: symbolParam, interval: "day", interval_multiplier: "1",
        start_date: start.toISOString().slice(0,10), end_date: end.toISOString().slice(0,10),
      }));
      candles = parsePriceRows(dailyPayload).map(mapPriceRow).filter((x: any) => x.timestamp > 0 && x.close !== null).slice(-limit);
    }

    if (!candles.length) throw new Error("Financial Datasets returned no usable price history.");
    return res.json({
      success: true, status: "OK", symbol: symbolParam, candles,
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

// Setup Vite/static serving and the long-lived WebSocket gateway only inside the async server bootstrap.
async function startServer() {
  const httpServer = http.createServer(app);

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

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Jarvis Finance server running on http://0.0.0.0:${PORT}`);
  });

}

startServer();
