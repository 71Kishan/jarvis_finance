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
  ready: boolean;
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
  trailingActivationPercent?: number;
  minConfidence: number;
  maxRiskPerTrade: number;
  indicatorWeights: {
    trendEMA: number;
    rsiReversal: number;
    bollingerMeanReversion: number;
    macdMomentum: number;
    volumeConfirmation: number;
  };
  rules: string[];
}

export type BotState =
  | "THRIVING"
  | "HUNTING"
  | "STUDYING"
  | "IN_POSITION"
  | "DEFENSIVE"
  | "CRITICAL_HAZARD"
  | "HALTED_DEAD";

export type TradeStatus =
  | "OPEN"
  | "CLOSED_TAKE_PROFIT"
  | "CLOSED_STOP_LOSS"
  | "CLOSED_MANUAL"
  | "EMERGENCY_LIQUIDATED";

export interface Trade {
  id: string;
  asset: string;
  type: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice?: number;
  amount: number;
  sizeUsd: number;
  marginUsd?: number;
  leverage?: number;
  entryFeeUsd?: number;
  exitFeeUsd?: number;
  slippageUsd?: number;
  grossPnlUsd?: number;
  netPnlUsd?: number;
  entryTime: number;
  exitTime?: number;
  stopLoss: number;
  takeProfit: number;
  highestPrice?: number;
  lowestPrice?: number;
  pnl: number;
  pnlPercent: number;
  status: TradeStatus;
  confidence: number;
  rationale: string;
  strategyId?: string;
  signalId?: string;
  dataTimestamp?: number;
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
  currentDrawdownPercent: number;
  maxDrawdownPercent: number;
  circuitBreakerThresholdPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  survivalStreak: number;
  generationsLearned: number;
  securedProfitVault: number;
  totalProfitWithdrawn: number;
  autoWithdrawProfitEnabled: boolean;
  withdrawPercentage: number;
  minProfitThresholdUsd: number;
  dayStartEquity?: number;
  dailyPnl?: number;
  dailyLossLimitPercent?: number;
  tradesToday?: number;
  openRiskUsd?: number;
  marginUsedUsd?: number;
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
  expectancyUsd?: number;
  annualizedReturn?: number;
  annualizedVolatility?: number;
  feesPaid?: number;
  slippageCost?: number;
  outOfSampleTrades?: number;
  outOfSamplePnl?: number;
  outOfSampleMaxDrawdown?: number;
  verdict: "SURVIVED_AND_PROFITABLE" | "UNSAFE_HIGH_DRAWDOWN" | "FAILED" | "INSUFFICIENT_DATA";
}

export type MarketDataSource = "SIMULATED" | "LIVE_EXCHANGE";

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
  source: "BINANCE" | "COINBASE" | "FINANCIAL_DATASETS" | "SYNTHETIC" | "UNAVAILABLE";
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
  maxLeverage?: number;
  maxPositionPercent?: number;
  maxDailyLossPercent?: number;
  maxTradesPerDay?: number;
  cooldownAfterLossMinutes?: number;
  maxSpreadBps?: number;
  staleDataMs?: number;
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
  rsi: number;
  trend: "BULLISH" | "BEARISH" | "SIDEWAYS";
  volatility: number;
  isEligible: boolean;
  scanVerdict: string;
  rationale: string;
  dataSource?: LiveExchangeTicker["source"];
  dataTimestamp?: number;
}

export type StrategyEvidenceStatus = "UNTESTED" | "PAPER_TESTING" | "QUALIFIED" | "REJECTED";

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
  profitFactor: number;
  maxDrawdownPercent: number;
  status: "PROVEN_PROFITABLE" | "TESTING_PAPER" | "DISCARDED_FAILED";
  evidenceStatus?: StrategyEvidenceStatus;
  grossProfitUsd?: number;
  grossLossUsd?: number;
  outOfSampleTrades?: number;
  outOfSamplePnlUsd?: number;
  outOfSampleMaxDrawdownPercent?: number;
  expectancyUsd?: number;
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
