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
  minConfidence: number; // e.g. 78% minimum
  maxRiskPerTrade: number; // percentage of equity, e.g. 2.5%
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
  | "THRIVING"       // Profitable, high vitality
  | "HUNTING"        // Actively scanning high-probability setups
  | "STUDYING"       // Analyzing historical data / optimizing
  | "IN_POSITION"    // Actively managing open trade
  | "DEFENSIVE"      // Volatility high or minor drawdown, ultra-strict filters
  | "CRITICAL_HAZARD"// Close to max drawdown limit, on brink of termination
  | "HALTED_DEAD";   // Emergency circuit breaker triggered - trading halted to preserve capital

export interface Trade {
  id: string;
  asset: string;
  type: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice?: number;
  amount: number;
  sizeUsd: number;
  entryTime: number;
  exitTime?: number;
  stopLoss: number;
  takeProfit: number;
  highestPrice?: number; // for trailing stop
  lowestPrice?: number;  // for trailing stop short
  pnl: number;
  pnlPercent: number;
  status: "OPEN" | "CLOSED_TAKE_PROFIT" | "CLOSED_STOP_LOSS" | "CLOSED_MANUAL" | "EMERGENCY_LIQUIDATED";
  confidence: number;
  rationale: string;
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
  health: number; // 0% to 100%
  startingCapital: number;
  currentEquity: number;
  cash: number;
  peakEquity: number;
  currentDrawdownPercent: number;
  maxDrawdownPercent: number;
  circuitBreakerThresholdPercent: number; // e.g. 3.0% loss -> triggers death
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  survivalStreak: number; // consecutive non-losing trades
  generationsLearned: number;
  securedProfitVault: number; // Cumulative profits swept to cold storage vault
  totalProfitWithdrawn: number; // Total amount withdrawn from trading pool
  autoWithdrawProfitEnabled: boolean; // Automatic profit sweep active
  withdrawPercentage: number; // e.g. 50% or 100% of winning trade profit
  minProfitThresholdUsd: number; // minimum profit threshold to trigger auto-sweep
}

export interface ProfitWithdrawalRecord {
  id: string; // e.g. "WDR-842910"
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
  verdict: "SURVIVED_AND_PROFITABLE" | "UNSAFE_HIGH_DRAWDOWN" | "FAILED";
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
  source: "BINANCE" | "COINBASE" | "SYNTHETIC";
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
  slippageBps: number; // basis points (e.g. 2 = 0.02%)
  feeTierPercent: number; // e.g. 0.04%
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
  score: number; // 0 to 100 confluence score
  bestDirection: "LONG" | "SHORT" | "NEUTRAL";
  rsi: number;
  trend: "BULLISH" | "BEARISH" | "SIDEWAYS";
  volatility: number;
  isEligible: boolean; // meets minConfidence threshold
  scanVerdict: string;
  rationale: string;
}

export interface StrategyVaultEntry {
  id: string;
  signature: string; // Hash/fingerprint to prevent duplicate parameter sets
  name: string;
  category: "TREND_FOLLOWING" | "MEAN_REVERSION" | "VOLATILITY_BREAKOUT" | "SCALPING";
  asset: string;
  version: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number; // %
  totalPnlUsd: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  status: "PROVEN_PROFITABLE" | "TESTING_PAPER" | "DISCARDED_FAILED";
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
