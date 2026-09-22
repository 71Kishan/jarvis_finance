import React, { useState } from "react";
import {
  Trade,
  BotState,
  BotVitality,
  StrategyConfig,
  PaperOrderRequest,
  MarketDataSource,
  LiveExchangeTicker,
  DailyPerformanceGoal,
} from "../types/trading";
import {
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Zap,
  Radio,
  Sliders,
  AlertTriangle,
  PlayCircle,
  XCircle,
  Clock,
  Sparkles,
  ArrowRight,
  Radar,
  BookOpen,
  Target,
} from "lucide-react";

interface PaperTradingDeckProps {
  currentPrice: number;
  asset: string;
  botState: BotState;
  vitality: BotVitality;
  strategy: StrategyConfig;
  activeTrade: Trade | null;
  marketSource: MarketDataSource;
  ticker: LiveExchangeTicker | null;
  isAutoTrading: boolean;
  onToggleAutoTrading: () => void;
  onToggleMarketSource: (source: MarketDataSource) => void;
  onExecutePaperTrade: (request: PaperOrderRequest) => boolean;
  onRunImmediateTrade: () => void;
  onOpenMultiAssetRadar: () => void;
  onOpenStrategyVault: () => void;
  autoRotateAssets: boolean;
  onToggleAutoRotateAssets: () => void;
  dailyGoal: DailyPerformanceGoal;
  onForceBotScan: () => void;
  onCloseActiveTrade: () => void;
  onSimulateEmergencyTest: () => void;
  onOpenSettings: () => void;
}

export const PaperTradingDeck: React.FC<PaperTradingDeckProps> = ({
  currentPrice,
  asset,
  botState,
  vitality,
  strategy,
  activeTrade,
  marketSource,
  ticker,
  isAutoTrading,
  onToggleAutoTrading,
  onToggleMarketSource,
  onExecutePaperTrade,
  onRunImmediateTrade,
  onOpenMultiAssetRadar,
  onOpenStrategyVault,
  autoRotateAssets,
  onToggleAutoRotateAssets,
  dailyGoal,
  onForceBotScan,
  onCloseActiveTrade,
  onSimulateEmergencyTest,
  onOpenSettings,
}) => {
  const [orderType, setOrderType] = useState<"LONG" | "SHORT">("LONG");
  const [amountUsd, setAmountUsd] = useState<number>(500);
  const leverage = 1;
  const [stopLossPercent, setStopLossPercent] = useState<number>(strategy.stopLossPercent || 1.0);
  const [takeProfitPercent, setTakeProfitPercent] = useState<number>(strategy.takeProfitPercent || 2.5);
  const [trailingStop, setTrailingStop] = useState<boolean>(true);
  const [executionFeedback, setExecutionFeedback] = useState<string | null>(null);

  const availableCash = vitality.cash;
  const positionSizeUsd = amountUsd;
  const calculatedStopPrice =
    orderType === "LONG"
      ? currentPrice * (1 - stopLossPercent / 100)
      : currentPrice * (1 + stopLossPercent / 100);

  const calculatedTargetPrice =
    orderType === "LONG"
      ? currentPrice * (1 + takeProfitPercent / 100)
      : currentPrice * (1 - takeProfitPercent / 100);

  const riskRewardRatio = (takeProfitPercent / (stopLossPercent || 0.1)).toFixed(1);

  const handleOrderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTrade) {
      setExecutionFeedback("Existing position active! Close it before placing new paper order.");
      setTimeout(() => setExecutionFeedback(null), 3000);
      return;
    }

    if (botState === "HALTED_DEAD") {
      setExecutionFeedback("Execution halted by circuit breaker! Reset account in settings first.");
      setTimeout(() => setExecutionFeedback(null), 3000);
      return;
    }

    const ok = onExecutePaperTrade({
      type: orderType,
      amountUsd,
      leverage,
      stopLossPercent,
      takeProfitPercent,
      trailingStop,
      manualNote: `User Manual Paper Trade: ${orderType} with ${leverage}x leverage.`,
    });

    if (ok) {
      setExecutionFeedback(`✓ Paper ${orderType} filled at $${currentPrice.toFixed(2)}`);
      setTimeout(() => setExecutionFeedback(null), 4000);
    }
  };

  return (
    <div
      id="paper-trading-deck-container"
      className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex flex-col gap-4 text-sm"
    >
      {/* Deck Header: Mode Switcher & Ticker Snapshot */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-950/60 border border-indigo-800/60 text-indigo-400">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-neutral-100 flex items-center gap-2">
              <span>Paper Trading Terminal</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">
                Simulated Capital • Real Market Data
              </span>
            </div>
            <div className="text-[11px] text-neutral-400">
              No real capital is connected. Paper fills use modeled fees and slippage.
            </div>
          </div>
        </div>

        {/* Live Feed Toggle Pills */}
        <div className="flex items-center gap-1.5 bg-neutral-950 p-1 rounded-xl border border-neutral-800">
          <button
            id="feed-toggle-live-exchange"
            type="button"
            onClick={() => onToggleMarketSource("LIVE_MARKET_DATA")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              marketSource === "LIVE_MARKET_DATA"
                ? "bg-emerald-950 text-emerald-300 border border-emerald-700/80 shadow-sm"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                marketSource === "LIVE_MARKET_DATA"
                  ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]"
                  : "bg-neutral-600"
              }`}
            />
            <Radio className="w-3.5 h-3.5" />
            <span>Trusted Live Data</span>
          </button>

          <button
            id="feed-toggle-simulator"
            type="button"
            onClick={() => onToggleMarketSource("SIMULATED")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              marketSource === "SIMULATED"
                ? "bg-amber-950 text-amber-300 border border-amber-700/80 shadow-sm"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>High-Speed Sandbox</span>
          </button>
        </div>
      </div>

      {/* Ticker Telemetry Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-neutral-950/70 p-2.5 rounded-xl border border-neutral-800/80 font-mono text-xs">
        <div>
          <div className="text-[10px] text-neutral-400 font-sans">Asset Price</div>
          <div className="text-neutral-100 font-bold text-sm">
            ${currentPrice.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-neutral-400 font-sans">24h Change</div>
          <div
            className={`font-bold flex items-center gap-1 ${
              (ticker?.change24hPercent || 0) >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {(ticker?.change24hPercent || 0) >= 0 ? "+" : ""}
            {(ticker?.change24hPercent || 0).toFixed(2)}%
          </div>
        </div>
        <div>
          <div className="text-[10px] text-neutral-400 font-sans">24h High / Low</div>
          <div className="text-neutral-300 text-[11px]">
            {ticker?.high24h ? `${ticker.high24h.toFixed(1)}` : "—"} / {ticker?.low24h ? `${ticker.low24h.toFixed(1)}` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-neutral-400 font-sans">Available Cash</div>
          <div className="text-cyan-400 font-bold">
            ${vitality.cash.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Autonomous Action & Verification Command Bar */}
      <div className="bg-gradient-to-r from-neutral-950 via-neutral-900 to-neutral-950 p-3.5 rounded-xl border border-neutral-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-md">
        {/* Daily Process Metrics */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-neutral-200">Daily Process</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                {dailyGoal.tradesCountToday} paper trade{dailyGoal.tradesCountToday === 1 ? "" : "s"} today
              </span>
            </div>
            <div className="text-[11px] text-neutral-400">
              No daily income target. Prioritize data quality, risk limits, trade quality and review.
            </div>
          </div>
        </div>

        {/* Primary Command Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* RUN QUALIFIED PAPER SCAN BUTTON */}
          <button
            id="run-verified-trade-btn"
            type="button"
            onClick={onRunImmediateTrade}
            disabled={botState === "HALTED_DEAD" || !!activeTrade}
            className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-emerald-950/40 disabled:opacity-50"
            title="Runs one fresh rules-based paper scan; it will not enter unless the signal and risk gates both pass"
          >
            <Zap className="w-4 h-4 fill-white" />
            <span>⚡ Run Qualified Scan</span>
          </button>

          {/* MULTI-ASSET RADAR BUTTON */}
          <button
            id="open-multi-asset-radar-btn"
            type="button"
            onClick={onOpenMultiAssetRadar}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors border border-neutral-700"
            title="Review supported assets from trusted market-data sources"
          >
            <Radar className="w-4 h-4 text-indigo-400" />
            <span>Multi-Market Radar</span>
          </button>

          {/* STRATEGY VAULT BUTTON */}
          <button
            id="open-strategy-vault-btn"
            type="button"
            onClick={onOpenStrategyVault}
            className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors border border-neutral-700"
            title="View Strategy Memory Vault and anti-duplication registry"
          >
            <BookOpen className="w-4 h-4 text-emerald-400" />
            <span>Strategy Vault</span>
          </button>
        </div>
      </div>

      {/* Active Position Banner (If In-Position) */}
      {activeTrade && (
        <div
          id="active-paper-trade-banner"
          className="bg-neutral-950 border border-indigo-500/40 rounded-xl p-3.5 flex flex-col gap-2.5 shadow-lg shadow-indigo-950/20"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                  activeTrade.type === "LONG"
                    ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                    : "bg-rose-950 text-rose-300 border border-rose-800"
                }`}
              >
                {activeTrade.type} {activeTrade.asset}
              </span>
              <span className="text-xs text-neutral-400 font-mono">
                Entry: ${activeTrade.entryPrice.toFixed(2)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div
                className={`text-sm font-mono font-bold ${
                  activeTrade.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {activeTrade.pnl >= 0 ? "+" : ""}${activeTrade.pnl.toFixed(2)} (
                {activeTrade.pnlPercent >= 0 ? "+" : ""}
                {activeTrade.pnlPercent.toFixed(2)}%)
              </div>
              <button
                id="close-active-trade-btn"
                onClick={onCloseActiveTrade}
                className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-600/50 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Market Close</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 font-mono text-xs pt-1 border-t border-neutral-800 text-neutral-400">
            <div>
              <span className="text-[10px] font-sans block text-neutral-400">Position Size</span>
              <span className="text-neutral-200 font-bold">${activeTrade.sizeUsd.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-[10px] font-sans block text-rose-400">Stop Loss</span>
              <span className="text-rose-300 font-bold">${activeTrade.stopLoss.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-[10px] font-sans block text-emerald-400">Take Profit</span>
              <span className="text-emerald-300 font-bold">${activeTrade.takeProfit.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Paper Order Controls & Autonomous AI Action Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Manual Paper Trade Order Pad (7 cols) */}
        <form
          onSubmit={handleOrderSubmit}
          className="lg:col-span-7 bg-neutral-950/60 p-3.5 rounded-xl border border-neutral-800/80 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-neutral-300 uppercase tracking-wide flex items-center gap-1.5">
              <span>Paper Order Pad</span>
            </span>

            {/* Direction Selector */}
            <div className="flex p-0.5 bg-neutral-900 rounded-lg border border-neutral-800">
              <button
                id="paper-order-long-btn"
                type="button"
                onClick={() => setOrderType("LONG")}
                className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1 transition-all ${
                  orderType === "LONG"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                BUY / LONG
              </button>
              <button
                id="paper-order-short-btn"
                type="button"
                onClick={() => setOrderType("SHORT")}
                className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1 transition-all ${
                  orderType === "SHORT"
                    ? "bg-rose-600 text-white shadow-sm"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5" />
                SELL / SHORT
              </button>
            </div>
          </div>

          {/* Amount Sizing & Quick Chips */}
          <div>
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
              <span>Order Notional ($ USD)</span>
              <span className="font-mono text-[11px]">
                Max: ${availableCash.toFixed(0)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="paper-order-amount-input"
                type="number"
                min="20"
                max={Math.floor(availableCash)}
                step="50"
                value={amountUsd}
                onChange={(e) => setAmountUsd(Math.max(10, Number(e.target.value)))}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 font-mono text-neutral-100 focus:outline-none focus:border-indigo-500 text-sm"
              />
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              {[100, 250, 500, 1000, 2500].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmountUsd(Math.min(preset, Math.floor(availableCash)))}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                    amountUsd === preset
                      ? "bg-indigo-950 text-indigo-300 border-indigo-700"
                      : "bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200"
                  }`}
                >
                  ${preset}
                </button>
              ))}
            </div>
          </div>

          {/* Leverage Policy */}
          <div className="p-2.5 bg-neutral-900/70 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>Paper Leverage</span>
              <span className="font-mono font-bold text-emerald-400">1x SPOT ONLY</span>
            </div>
            <div className="text-[10px] text-neutral-500 mt-1">
              Leverage is disabled in the current risk policy. Position notional equals the cash reserved for the paper trade.
            </div>
          </div>

          {/* SL & TP Bracket Controls */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
                <span className="text-rose-400 font-semibold">Stop Loss (%)</span>
                <span className="font-mono text-neutral-400">
                  ${calculatedStopPrice.toFixed(2)}
                </span>
              </div>
              <input
                type="number"
                step="0.1"
                min="0.3"
                max="5.0"
                value={stopLossPercent}
                onChange={(e) => setStopLossPercent(Number(e.target.value))}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1 font-mono text-xs text-neutral-200 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
                <span className="text-emerald-400 font-semibold">Take Profit (%)</span>
                <span className="font-mono text-neutral-400">
                  ${calculatedTargetPrice.toFixed(2)}
                </span>
              </div>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="12.0"
                value={takeProfitPercent}
                onChange={(e) => setTakeProfitPercent(Number(e.target.value))}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1 font-mono text-xs text-neutral-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Trailing Stop & Risk:Reward Summary */}
          <div className="flex items-center justify-between text-xs py-1 px-2 bg-neutral-900/80 rounded-lg border border-neutral-800 text-neutral-400">
            <label className="flex items-center gap-2 cursor-pointer text-[11px] text-neutral-300">
              <input
                type="checkbox"
                checked={trailingStop}
                onChange={(e) => setTrailingStop(e.target.checked)}
                className="rounded bg-neutral-800 border-neutral-700 text-indigo-500 focus:ring-0"
              />
              <span>Trailing Stop</span>
            </label>
            <span className="font-mono text-[11px] text-neutral-400">
              R:R <strong className="text-indigo-300">{riskRewardRatio} : 1</strong>
            </span>
          </div>

          {/* Execution Button */}
          <button
            id="submit-paper-order-btn"
            type="submit"
            disabled={!!activeTrade || botState === "HALTED_DEAD"}
            className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md ${
              orderType === "LONG"
                ? "bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white shadow-emerald-950/40"
                : "bg-rose-600 hover:bg-rose-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white shadow-rose-950/40"
            }`}
          >
            <span>Execute Paper {orderType} Order</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {executionFeedback && (
            <div className="text-center font-mono text-xs text-emerald-400 animate-pulse">
              {executionFeedback}
            </div>
          )}
        </form>

        {/* Right Column: Autonomous Algorithmic Execution Controls (5 cols) */}
        <div className="lg:col-span-5 bg-neutral-950/60 p-3.5 rounded-xl border border-neutral-800/80 flex flex-col justify-between gap-3">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wide flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Paper Execution Core</span>
              </span>

              {/* Execution State Badge */}
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  botState === "THRIVING"
                    ? "bg-emerald-950 text-emerald-400 border-emerald-800"
                    : botState === "HUNTING"
                    ? "bg-cyan-950 text-cyan-400 border-cyan-800"
                    : botState === "IN_POSITION"
                    ? "bg-indigo-950 text-indigo-400 border-indigo-800"
                    : botState === "DEFENSIVE"
                    ? "bg-amber-950 text-amber-400 border-amber-800"
                    : botState === "CRITICAL_HAZARD"
                    ? "bg-rose-950 text-rose-400 border-rose-800 animate-pulse"
                    : "bg-red-950 text-red-500 border-red-900"
                }`}
              >
                {botState === "HALTED_DEAD" ? "CIRCUIT_LOCKED" : botState}
              </span>
            </div>

            {/* Auto Trading Switch */}
            <div className="flex items-center justify-between p-2.5 bg-neutral-900/90 rounded-xl border border-neutral-800">
              <div>
                <div className="text-xs font-semibold text-neutral-200">
                  Automated Algorithmic Execution
                </div>
                <div className="text-[11px] text-neutral-400">
                  {isAutoTrading
                    ? "Session-local autopilot: enters only on a fresh eligible signal; unattended operation requires the server worker."
                    : "Automated execution paused"}
                </div>
              </div>
              <button
                id="bot-auto-trading-toggle"
                type="button"
                onClick={onToggleAutoTrading}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  isAutoTrading
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {isAutoTrading ? "ACTIVE" : "PAUSED"}
              </button>
            </div>

            {/* Force Live Signal Scan */}
            <button
              id="force-bot-scan-btn"
              type="button"
              onClick={onForceBotScan}
              disabled={botState === "HALTED_DEAD" || !!activeTrade}
              className="w-full py-2 px-3 bg-indigo-950/70 hover:bg-indigo-900 text-indigo-300 border border-indigo-800/80 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
            >
              <PlayCircle className="w-4 h-4" />
              <span>Trigger Quantitative Confluence Scan</span>
            </button>
            <div className="text-[11px] text-neutral-400 leading-snug px-1">
              Evaluates live RSI, Bollinger Bands, MACD & EMA confluence. If threshold is met, executes order; if not, logs rationale for capital preservation.
            </div>
          </div>

          {/* Emergency Survival Circuit Breaker Drill */}
          <div className="pt-2 border-t border-neutral-800/80 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Max Drawdown Limit:</span>
              </span>
              <span className="font-mono text-rose-400 font-bold">
                {vitality.circuitBreakerThresholdPercent}% ($
                {(
                  (vitality.startingCapital * vitality.circuitBreakerThresholdPercent) /
                  100
                ).toFixed(0)}
                )
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="emergency-drill-test-btn"
                type="button"
                onClick={onSimulateEmergencyTest}
                disabled={botState === "HALTED_DEAD"}
                className="flex-1 py-1.5 px-2 bg-red-950/40 hover:bg-red-950/80 text-rose-400 border border-rose-900/60 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Test Circuit Breaker Drill</span>
              </button>

              <button
                id="risk-settings-open-btn"
                type="button"
                onClick={onOpenSettings}
                className="p-1.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 rounded-lg transition-colors"
                title="Paper Trading Risk & Simulation Settings"
              >
                <Sliders className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
