import React, { useState, useMemo } from "react";
import {
  EquityCurvePoint,
  Trade,
  BotVitality,
} from "../types/trading";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  ShieldAlert,
  BarChart3,
  Percent,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  Maximize2,
} from "lucide-react";

interface AnalyticsChartsProps {
  equityCurve: EquityCurvePoint[];
  tradeHistory: Trade[];
  vitality: BotVitality;
  currentAsset: string;
}

type ChartTab = "EQUITY" | "PNL_DISTRIBUTION" | "DRAWDOWN" | "WIN_LOSS_METRICS";

export const AnalyticsCharts: React.FC<AnalyticsChartsProps> = ({
  equityCurve,
  tradeHistory,
  vitality,
  currentAsset,
}) => {
  const [activeTab, setActiveTab] = useState<ChartTab>("EQUITY");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Derived Performance Metrics
  const metrics = useMemo(() => {
    const closedTrades = tradeHistory.filter((t) => t.status !== "OPEN");
    const wins = closedTrades.filter((t) => t.pnl > 0);
    const losses = closedTrades.filter((t) => t.pnl <= 0);

    const grossProfit = wins.reduce((acc, t) => acc + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? "∞" : "0.00";

    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const winLossRatio = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : "0.00";

    const maxWin = wins.length > 0 ? Math.max(...wins.map((w) => w.pnl)) : 0;
    const maxLoss = losses.length > 0 ? Math.min(...losses.map((l) => l.pnl)) : 0;

    return {
      closedCount: closedTrades.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: closedTrades.length > 0 ? ((wins.length / closedTrades.length) * 100).toFixed(1) : "0.0",
      grossProfit,
      grossLoss,
      profitFactor,
      avgWin,
      avgLoss,
      winLossRatio,
      maxWin,
      maxLoss,
      currentEquity: vitality.currentEquity,
      startingCapital: vitality.startingCapital,
      netPnl: vitality.totalPnl,
      netPnlPercent: vitality.startingCapital > 0 ? ((vitality.totalPnl / vitality.startingCapital) * 100).toFixed(2) : "0.00",
      currentDrawdown: vitality.currentDrawdownPercent,
      maxDrawdown: vitality.maxDrawdownPercent,
    };
  }, [tradeHistory, vitality]);

  // Equity Curve SVG calculation
  const equityPoints = useMemo(() => {
    if (equityCurve.length === 0) return [];
    return equityCurve;
  }, [equityCurve]);

  const eqMinMax = useMemo(() => {
    if (equityPoints.length === 0) {
      return { min: vitality.startingCapital * 0.95, max: vitality.startingCapital * 1.05 };
    }
    let min = Infinity;
    let max = -Infinity;
    equityPoints.forEach((p) => {
      if (p.equity < min) min = p.equity;
      if (p.equity > max) max = p.equity;
    });
    // Add 5% headroom
    const span = Math.max(10, max - min);
    return {
      min: Math.max(0, min - span * 0.1),
      max: max + span * 0.1,
    };
  }, [equityPoints, vitality.startingCapital]);

  const svgWidth = 720;
  const svgHeight = 220;
  const paddingX = 40;
  const paddingY = 24;
  const graphWidth = svgWidth - paddingX * 2;
  const graphHeight = svgHeight - paddingY * 2;

  const getEqX = (index: number) => {
    if (equityPoints.length <= 1) return paddingX + graphWidth / 2;
    return paddingX + (index / (equityPoints.length - 1)) * graphWidth;
  };

  const getEqY = (value: number) => {
    const range = eqMinMax.max - eqMinMax.min || 1;
    return paddingY + graphHeight - ((value - eqMinMax.min) / range) * graphHeight;
  };

  const baselineY = getEqY(vitality.startingCapital);

  // SVG Path for Equity
  const equityPath = useMemo(() => {
    if (equityPoints.length === 0) return "";
    return equityPoints
      .map((p, i) => `${i === 0 ? "M" : "L"} ${getEqX(i).toFixed(1)} ${getEqY(p.equity).toFixed(1)}`)
      .join(" ");
  }, [equityPoints, eqMinMax]);

  const equityFillArea = useMemo(() => {
    if (equityPoints.length === 0) return "";
    const firstX = getEqX(0);
    const lastX = getEqX(equityPoints.length - 1);
    const bottomY = paddingY + graphHeight;
    return `${equityPath} L ${lastX.toFixed(1)} ${bottomY} L ${firstX.toFixed(1)} ${bottomY} Z`;
  }, [equityPath, equityPoints]);

  // Drawdown Points SVG
  const ddPoints = useMemo(() => {
    return equityPoints.map((p, i) => {
      const x = getEqX(i);
      const dd = Math.min(15, p.drawdownPercent);
      const y = paddingY + (dd / 15) * graphHeight;
      return { x, y, dd: p.drawdownPercent, label: p.timeLabel };
    });
  }, [equityPoints]);

  return (
    <div
      id="analytics-charts-panel"
      className="w-full bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-4 shadow-xl backdrop-blur-sm"
    >
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800/80 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide uppercase font-mono">
                Performance & Risk Analytics
              </h2>
              <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-[10px] font-mono text-neutral-300">
                LIVE TELEMETRY
              </span>
            </div>
            <p className="text-xs text-neutral-400 font-sans">
              Real-time equity growth curve, trade distribution, and drawdown protection analysis
            </p>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-xl border border-neutral-800 text-xs font-mono">
          <button
            id="tab-equity-curve"
            type="button"
            onClick={() => setActiveTab("EQUITY")}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "EQUITY"
                ? "bg-emerald-600/90 text-white font-semibold shadow-md"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Equity Growth</span>
          </button>

          <button
            id="tab-pnl-distribution"
            type="button"
            onClick={() => setActiveTab("PNL_DISTRIBUTION")}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "PNL_DISTRIBUTION"
                ? "bg-indigo-600/90 text-white font-semibold shadow-md"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>P&L Ledger</span>
          </button>

          <button
            id="tab-drawdown-chart"
            type="button"
            onClick={() => setActiveTab("DRAWDOWN")}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "DRAWDOWN"
                ? "bg-rose-600/90 text-white font-semibold shadow-md"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Drawdown Wave</span>
          </button>

          <button
            id="tab-metrics-table"
            type="button"
            onClick={() => setActiveTab("WIN_LOSS_METRICS")}
            className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "WIN_LOSS_METRICS"
                ? "bg-amber-600/90 text-white font-semibold shadow-md"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            <span>Quant Ratios</span>
          </button>
        </div>
      </div>

      {/* KPI Quick Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
        <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-2.5">
          <div className="text-[10px] uppercase font-mono text-neutral-400">Total Net PnL</div>
          <div
            className={`text-sm font-bold font-mono mt-0.5 flex items-center gap-1 ${
              metrics.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {metrics.netPnl >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            ${Math.abs(metrics.netPnl).toFixed(2)}
            <span className="text-[10px] text-neutral-400 font-normal">
              ({metrics.netPnlPercent}%)
            </span>
          </div>
        </div>

        <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-2.5">
          <div className="text-[10px] uppercase font-mono text-neutral-400">Win Rate</div>
          <div className="text-sm font-bold font-mono text-sky-400 mt-0.5">
            {metrics.winRate}%
            <span className="text-[10px] text-neutral-400 font-normal ml-1">
              ({metrics.winCount}W / {metrics.lossCount}L)
            </span>
          </div>
        </div>

        <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-2.5">
          <div className="text-[10px] uppercase font-mono text-neutral-400">Profit Factor</div>
          <div className="text-sm font-bold font-mono text-emerald-300 mt-0.5">
            {metrics.profitFactor}x
          </div>
        </div>

        <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-2.5">
          <div className="text-[10px] uppercase font-mono text-neutral-400">Win / Loss Ratio</div>
          <div className="text-sm font-bold font-mono text-amber-300 mt-0.5">
            {metrics.winLossRatio}:1
          </div>
        </div>

        <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-2.5">
          <div className="text-[10px] uppercase font-mono text-neutral-400">Max Drawdown</div>
          <div className="text-sm font-bold font-mono text-rose-400 mt-0.5">
            {metrics.maxDrawdown}%
            <span className="text-[10px] text-neutral-400 font-normal ml-1">
              (Cap: {vitality.circuitBreakerThresholdPercent}%)
            </span>
          </div>
        </div>

        <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-2.5">
          <div className="text-[10px] uppercase font-mono text-neutral-400">Current Equity</div>
          <div className="text-sm font-bold font-mono text-white mt-0.5">
            ${metrics.currentEquity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Main Chart Canvas */}
      <div className="bg-neutral-950 rounded-xl border border-neutral-800/80 p-3 flex flex-col gap-2">
        {activeTab === "EQUITY" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-mono text-neutral-400 px-1">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Portfolio Equity Curve
              </span>
              <span>
                Baseline: ${vitality.startingCapital.toLocaleString()} | Peak: ${vitality.peakEquity.toFixed(2)}
              </span>
            </div>

            <div className="relative w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="w-full h-48 sm:h-56 select-none"
              >
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Grid Lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
                  const y = paddingY + pct * graphHeight;
                  const val = eqMinMax.max - pct * (eqMinMax.max - eqMinMax.min);
                  return (
                    <g key={i}>
                      <line
                        x1={paddingX}
                        y1={y}
                        x2={svgWidth - paddingX}
                        y2={y}
                        stroke="#262626"
                        strokeDasharray="2 3"
                      />
                      <text
                        x={paddingX - 6}
                        y={y + 3}
                        fill="#737373"
                        fontSize="9"
                        textAnchor="end"
                        fontFamily="monospace"
                      >
                        ${val.toFixed(0)}
                      </text>
                    </g>
                  );
                })}

                {/* Baseline capital line */}
                <line
                  x1={paddingX}
                  y1={baselineY}
                  x2={svgWidth - paddingX}
                  y2={baselineY}
                  stroke="#6366f1"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                />
                <text
                  x={svgWidth - paddingX}
                  y={baselineY - 4}
                  fill="#818cf8"
                  fontSize="8"
                  fontFamily="monospace"
                  textAnchor="end"
                >
                  Start Capital (${vitality.startingCapital})
                </text>

                {/* Gradient Fill Area */}
                {equityFillArea && (
                  <path d={equityFillArea} fill="url(#equityGrad)" />
                )}

                {/* Curve Line */}
                {equityPath && (
                  <path
                    d={equityPath}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Data Points */}
                {equityPoints.map((pt, i) => {
                  const cx = getEqX(i);
                  const cy = getEqY(pt.equity);
                  const isHovered = hoveredIndex === i;
                  return (
                    <g key={i}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isHovered ? 5 : pt.tradeEvent ? 3.5 : 2}
                        fill={pt.tradeEvent ? "#fbbf24" : "#10b981"}
                        stroke="#0a0a0a"
                        strokeWidth="1.5"
                        className="cursor-pointer transition-all"
                        onMouseEnter={() => setHoveredIndex(i)}
                        onMouseLeave={() => setHoveredIndex(null)}
                      />
                    </g>
                  );
                })}

                {/* Tooltip Overlay */}
                {hoveredIndex !== null && equityPoints[hoveredIndex] && (
                  <g transform={`translate(${getEqX(hoveredIndex)}, ${getEqY(equityPoints[hoveredIndex].equity)})`}>
                    <rect
                      x="-65"
                      y="-42"
                      width="130"
                      height="36"
                      rx="6"
                      fill="#171717"
                      stroke="#10b981"
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y="-26"
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="bold"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      ${equityPoints[hoveredIndex].equity.toFixed(2)}
                    </text>
                    <text
                      x="0"
                      y="-12"
                      fill="#9ca3af"
                      fontSize="8"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      {equityPoints[hoveredIndex].timeLabel} {equityPoints[hoveredIndex].tradeEvent ? `• ${equityPoints[hoveredIndex].tradeEvent}` : ""}
                    </text>
                  </g>
                )}
              </svg>
            </div>
          </div>
        )}

        {activeTab === "PNL_DISTRIBUTION" && (
          <div className="flex flex-col gap-3 py-1">
            <div className="text-xs font-mono text-neutral-400 flex items-center justify-between">
              <span>Closed Trade P&L Distribution (Last {tradeHistory.length} Trades)</span>
              <span className="text-neutral-500">Green = Wins | Red = Stop Loss Exits</span>
            </div>

            {tradeHistory.length === 0 ? (
              <div className="py-12 text-center text-xs font-mono text-neutral-500">
                No trades completed yet. Run a trade to start populating the P&L ledger.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="h-44 flex items-end gap-1.5 overflow-x-auto pt-4 pb-2 px-2 bg-neutral-900/50 rounded-lg border border-neutral-800/60">
                  {tradeHistory.slice(0, 24).reverse().map((t, idx) => {
                    const isWin = t.pnl >= 0;
                    const maxPnlAbs = Math.max(
                      20,
                      ...tradeHistory.map((tr) => Math.abs(tr.pnl || 0))
                    );
                    const barHeightPct = Math.min(100, Math.max(8, (Math.abs(t.pnl) / maxPnlAbs) * 100));

                    return (
                      <div
                        key={t.id}
                        className="flex-1 min-w-[28px] max-w-[40px] flex flex-col items-center gap-1 group relative cursor-pointer"
                      >
                        <div
                          style={{ height: `${barHeightPct}%` }}
                          className={`w-full rounded-t transition-all ${
                            isWin
                              ? "bg-emerald-500/80 hover:bg-emerald-400 border border-emerald-400/40"
                              : "bg-rose-500/80 hover:bg-rose-400 border border-rose-400/40"
                          }`}
                        />
                        <span className="text-[9px] font-mono text-neutral-400 truncate">
                          #{idx + 1}
                        </span>

                        {/* Hover Details Card */}
                        <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col gap-0.5 p-2 bg-neutral-950 border border-neutral-700 rounded-lg shadow-xl text-[10px] font-mono whitespace-nowrap z-20 pointer-events-none">
                          <span className="font-bold text-white">{t.asset} ({t.type})</span>
                          <span className={isWin ? "text-emerald-400" : "text-rose-400"}>
                            PnL: {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} ({t.pnlPercent}%)
                          </span>
                          <span className="text-neutral-400">Exit: {t.status}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "DRAWDOWN" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs font-mono text-neutral-400 px-1">
              <span className="flex items-center gap-1.5 text-rose-400">
                <ShieldAlert className="w-3.5 h-3.5" />
                Drawdown Stress Wave & Circuit Breaker Ceiling
              </span>
              <span>
                Hard Kill Threshold: {vitality.circuitBreakerThresholdPercent}% Max Loss
              </span>
            </div>

            <div className="relative w-full overflow-x-auto">
              <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-48 sm:h-56 select-none">
                <defs>
                  <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.05" />
                  </linearGradient>
                </defs>

                {/* Circuit Breaker Kill-Line */}
                {(() => {
                  const killY = paddingY + (vitality.circuitBreakerThresholdPercent / 15) * graphHeight;
                  return (
                    <g>
                      <line
                        x1={paddingX}
                        y1={killY}
                        x2={svgWidth - paddingX}
                        y2={killY}
                        stroke="#e11d48"
                        strokeWidth="1.8"
                        strokeDasharray="4 2"
                      />
                      <text
                        x={svgWidth - paddingX}
                        y={killY - 4}
                        fill="#f43f5e"
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight="bold"
                        textAnchor="end"
                      >
                        CIRCUIT BREAKER LIMIT ({vitality.circuitBreakerThresholdPercent}%)
                      </text>
                    </g>
                  );
                })()}

                {/* Grid Lines */}
                {[0, 3, 6, 9, 12, 15].map((val) => {
                  const y = paddingY + (val / 15) * graphHeight;
                  return (
                    <g key={val}>
                      <line
                        x1={paddingX}
                        y1={y}
                        x2={svgWidth - paddingX}
                        y2={y}
                        stroke="#262626"
                        strokeDasharray="2 3"
                      />
                      <text
                        x={paddingX - 6}
                        y={y + 3}
                        fill="#737373"
                        fontSize="9"
                        textAnchor="end"
                        fontFamily="monospace"
                      >
                        -{val}%
                      </text>
                    </g>
                  );
                })}

                {/* Drawdown Curve Area */}
                {ddPoints.length > 1 && (
                  <path
                    d={`${ddPoints
                      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                      .join(" ")} L ${ddPoints[ddPoints.length - 1].x.toFixed(1)} ${paddingY} L ${ddPoints[0].x.toFixed(1)} ${paddingY} Z`}
                    fill="url(#ddGrad)"
                  />
                )}

                {/* Drawdown Stroke */}
                {ddPoints.length > 1 && (
                  <path
                    d={ddPoints
                      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                      .join(" ")}
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="2"
                  />
                )}
              </svg>
            </div>
          </div>
        )}

        {activeTab === "WIN_LOSS_METRICS" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 py-1 font-mono text-xs">
            <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 flex flex-col gap-1">
              <span className="text-neutral-400">Average Winning Trade</span>
              <span className="text-base font-bold text-emerald-400">+${metrics.avgWin.toFixed(2)}</span>
              <span className="text-[10px] text-neutral-500">Across {metrics.winCount} successful executions</span>
            </div>

            <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 flex flex-col gap-1">
              <span className="text-neutral-400">Average Losing Trade</span>
              <span className="text-base font-bold text-rose-400">-${metrics.avgLoss.toFixed(2)}</span>
              <span className="text-[10px] text-neutral-500">Contained by strict stop losses</span>
            </div>

            <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 flex flex-col gap-1">
              <span className="text-neutral-400">Largest Single Gain</span>
              <span className="text-base font-bold text-emerald-300">+${metrics.maxWin.toFixed(2)}</span>
              <span className="text-[10px] text-neutral-500">Peak profit event recorded</span>
            </div>

            <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 flex flex-col gap-1">
              <span className="text-neutral-400">Largest Single Loss</span>
              <span className="text-base font-bold text-rose-300">${metrics.maxLoss.toFixed(2)}</span>
              <span className="text-[10px] text-neutral-500">Hard stop prevented ruin</span>
            </div>

            <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 flex flex-col gap-1">
              <span className="text-neutral-400">Survival Trade Streak</span>
              <span className="text-base font-bold text-sky-300">{vitality.survivalStreak} Consecutive</span>
              <span className="text-[10px] text-neutral-500">Non-losing executions in a row</span>
            </div>

            <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 flex flex-col gap-1">
              <span className="text-neutral-400">Evolution Generation</span>
              <span className="text-base font-bold text-purple-300">Gen #{vitality.generationsLearned}</span>
              <span className="text-[10px] text-neutral-500">Self-calibrating algorithmic model</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
