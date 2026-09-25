export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  indicators?: IndicatorValues;
}

export interface IndicatorValues {
  ema9: number;
  ema21: number;
  ema50: number;
  rsi: number;
  bbandUpper: number;
  bbandMiddle: number;
  bbandLower: number;
  atr: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  volumeSMA: number;
}

export interface StrategyConfig {
  id: string;
  name: string;
  version: number;
  asset: string;
  description: string;
  rsiOversold: number;
  rsiOverbought: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStop: boolean;
  trailingStopPercent: number;
  minConfidence: number; // Signal score threshold; NOT a calibrated probability.
  maxRiskPerTrade: number; // Maximum intended loss as % of equity.
  indicatorWeights: {
    trendEMA: number;
    rsiReversal: number;
    bollingerMeanReversion: number;
    macdMomentum: number;
    volumeConfirmation: number;
  };
  rules: string[];
}

export interface RiskPolicyConfig {
  maxDailyLossPercent: number;
  maxPeakDrawdownPercent: number;
  maxPositionNotionalPercent: number;
  maxLeverage: number;
  maxOpenPositions: number;
  maxSpreadBps: number;
  maxAtrToPricePercent: number;
  cooldownAfterLosses: number;
  cooldownMinutes: number;
}

export type BotState =
  | "THRIVING"
  | "HUNTING"
  | "STUDYING"
  | "IN_POSITION"
  | "DEFENSIVE"
  | "CRITICAL_HAZARD"
  | "HALTED_DEAD";

export interface Trade {
  id: string;
  asset: string;
  type: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice?: number;
  amount: number;
  sizeUsd: number;
  marginUsd?: number;
  entryTime: number;
  exitTime?: number;
  stopLoss: number;
  takeProfit: number;
  highestPrice?: number;
  lowestPrice?: number;
  pnl: number;
  pnlPercent: number;
  feesUsd?: number;
  slippageUsd?: number;
  status: "OPEN" | "CLOSED_TAKE_PROFIT" | "CLOSED_STOP_LOSS" | "CLOSED_MANUAL" | "EMERGENCY_LIQUIDATED";
  signalScore: number;
  confidence: number; // Backward-compatible alias; treat as signal score, not probability.
  rationale: string;
  learningFeatures?: DecisionFeatureSnapshot;
  botSurvivalNote?: string;
}

export interface BotThoughtLog {
  id: string;
  timestamp: number;
  type: "STUDY" | "SIGNAL" | "EXECUTION" | "DEFENSE" | "OPTIMIZATION" | "PERISH_ALERT";
  headline: string;
  message: string;
  confidence?: number;
  vitalityDelta?: number;
}

export interface BotVitality {
  health: number;
  startingCapital: number;
  currentEquity: number;
  cash: number;
  peakEquity: number;
  dailyStartEquity: number;
  currentDrawdownPercent: number;
  maxDrawdownPercent: number;
  dailyDrawdownPercent: number;
  circuitBreakerThresholdPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  totalFees: number;
  survivalStreak: number;
  consecutiveLosses: number;
  lastLossAt?: number;
  generationsLearned: number;
  securedProfitVault: number;
  totalProfitWithdrawn: number;
  autoWithdrawProfitEnabled: boolean;
  withdrawPercentage: number;
  minProfitThresholdUsd: number;
}

export interface ProfitWithdrawalRecord {
  id: string;
  timestamp: number;
  tradeId?: string;
  asset: string;
  grossProfit: number;
  withdrawnAmount: number;
  retainedCapital: number;
  vaultBalanceAfter: number;
  sha256Proof: string;
  documentationMemo: string;
  status: "COMPLETED" | "SECURED";
  policy: "AUTO_SWEEP_WIN" | "MANUAL_SWEEP" | "MILESTONE_SWEEP";
  proofVerified?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model" | "system";
  content: string;
  timestamp: number;
  modelUsed?: string;
}

export interface BacktestResult {
  strategyName: string;
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio?: number;
  annualizedReturn?: number;
  volatilityAnnualized?: number;
  sampleDays?: number;
  annualizationReliable?: boolean;
  expectancyPerTrade?: number;
  avgWin?: number;
  avgLoss?: number;
  totalFees?: number;
  totalSlippage?: number;
  verdict: "SURVIVED_AND_PROFITABLE" | "UNSAFE_HIGH_DRAWDOWN" | "FAILED";
}

export type MarketDataSource = "SIMULATED" | "LIVE_MARKET_DATA";

export interface LiveExchangeTicker {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  change24hPercent: number;
  lastUpdated: number;
  source: "BINANCE" | "COINBASE" | "FINANCIAL_DATASETS" | "SYNTHETIC";
  quoteQuality?: "BID_ASK" | "LAST_ONLY";
}

export interface PaperOrderRequest {
  type: "LONG" | "SHORT";
  amountUsd: number;
  leverage: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStop: boolean;
  manualNote?: string;
}

export interface PaperTradingSettings {
  slippageBps: number;
  feeTierPercent: number;
  leverage: number;
  soundAlerts: boolean;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export type AssetCategory = "CRYPTO" | "STOCK" | "INDEX" | "FOREX";

export interface MultiAssetOpportunity {
  symbol: string;
  name: string;
  category: AssetCategory;
  price: number;
  change24hPercent: number;
  score: number;
  bestDirection: "LONG" | "SHORT" | "NEUTRAL";
  rsi: number | null;
  trend: "BULLISH" | "BEARISH" | "SIDEWAYS";
  volatility: number;
  isEligible: boolean;
  scanVerdict: string;
  rationale: string;
  dataSource?: "FINANCIAL_DATASETS" | "BINANCE" | "SYNTHETIC" | "UNKNOWN";
}

export interface StrategyVaultEntry {
  id: string;
  signature: string;
  name: string;
  category: "TREND_FOLLOWING" | "MEAN_REVERSION" | "VOLATILITY_BREAKOUT" | "SCALPING";
  asset: string;
  version: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlUsd: number;
  grossProfitUsd?: number;
  grossLossUsd?: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  status: "DRAFT" | "TESTING_PAPER" | "PROVISIONALLY_VALIDATED" | "DISCARDED_FAILED";
  failureReason?: string;
  successNotes?: string;
  lastTestedTime: number;
  config: StrategyConfig;
}

export interface DailyPerformanceGoal {
  dailyTargetUsd: number;
  currentDailyPnlUsd: number;
  tradesCountToday: number;
  targetAchieved: boolean;
  streakDays: number;
  deprecated?: boolean;
}

export type NotificationType =
  | "TRADE_OPENED"
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "MANUAL_CLOSE"
  | "RISK_ALERT"
  | "RADAR_SCAN"
  | "STRATEGY_LEARNED"
  | "CIRCUIT_BREAKER"
  | "PROFIT_WITHDRAWAL";

export interface ActionNotification {
  id: string;
  timestamp: number;
  type: NotificationType;
  title: string;
  message: string;
  badgeText?: string;
  details?: {
    asset?: string;
    pnl?: number;
    pnlPercent?: number;
    price?: number;
    size?: number;
  };
  read?: boolean;
}

export interface EquityCurvePoint {
  timestamp: number;
  timeLabel: string;
  equity: number;
  cash: number;
  drawdownPercent: number;
  pnlDelta: number;
  cumulativePnl: number;
  tradeEvent?: string;
}

import type { DecisionFeatureSnapshot } from "../learn/features";
import type { LearningTradeRecord } from "../learn/types";

export interface TradingEngineRuntimeState {
  version: 1;
  savedAt: number;
  vitality: BotVitality;
  botState: BotState;
  strategy: StrategyConfig;
  activeTrade: Trade | null;
  tradeHistory: Trade[];
  thoughts: BotThoughtLog[];
  notifications: ActionNotification[];
  equityCurve: EquityCurvePoint[];
  profitWithdrawals: ProfitWithdrawalRecord[];
  learningRecords?: LearningTradeRecord[];
  lastProcessedCandleTimestamp: number;
}
