import React, { useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  Clock,
  ExternalLink,
  Shield,
  ShieldAlert,
  Sliders,
  XCircle,
} from "lucide-react";
import { StrategyConfig, Trade } from "../types/trading";

interface TradeExecutionTableProps {
  activeTrade: Trade | null;
  tradeHistory: Trade[];
  strategy: StrategyConfig;
  onManualCloseActiveTrade: () => void;
  onOpenTradeCritique: (trade: Trade) => void;
}

export const TradeExecutionTable: React.FC<TradeExecutionTableProps> = ({
  activeTrade,
  tradeHistory,
  strategy,
  onManualCloseActiveTrade,
  onOpenTradeCritique,
}) => {
  const [activeTab, setActiveTab] = useState<"HISTORY" | "STRATEGY">("HISTORY");

  const getStatusBadge = (status: Trade["status"]) => {
    switch (status) {
      case "CLOSED_TAKE_PROFIT":
        return {
          label: "Take Profit Target",
          color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
          icon: CheckCircle2,
        };
      case "CLOSED_STOP_LOSS":
        return {
          label: "Hard Stop Defense",
          color: "bg-amber-500/15 text-amber-400 border-amber-500/30",
          icon: ShieldAlert,
        };
      case "EMERGENCY_LIQUIDATED":
        return {
          label: "Circuit Breaker Halt",
          color: "bg-rose-500/20 text-rose-400 border-rose-500/40",
          icon: XCircle,
        };
      case "CLOSED_MANUAL":
        return {
          label: "Manual Exit",
          color: "bg-neutral-800 text-neutral-300 border-neutral-700",
          icon: ExternalLink,
        };
      default:
        return {
          label: "Open",
          color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
          icon: Clock,
        };
    }
  };

  return (
    <div className="bg-neutral-950 border border-neutral-800/90 rounded-xl p-4 flex flex-col gap-4 shadow-lg">
      {/* 1. Active Position Card (if trade is open) */}
      {activeTrade ? (
        <div className="bg-gradient-to-r from-neutral-900 via-neutral-900 to-indigo-950/40 border border-indigo-500/30 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800/80 pb-2.5">
            <div className="flex items-center gap-2.5">
              <span
                className={`px-2 py-0.5 rounded text-xs font-mono font-bold flex items-center gap-1 ${
                  activeTrade.type === "LONG"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                }`}
              >
                {activeTrade.type === "LONG" ? (
                  <ArrowUpRight className="w-3.5 h-3.5" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5" />
                )}
                {activeTrade.type} {activeTrade.asset}
              </span>
              <span className="text-xs font-mono text-neutral-400">
                ID: {activeTrade.id}
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">
                Signal Score: {activeTrade.signalScore}%
              </span>
            </div>

            <button
              id="manual-close-position-btn"
              onClick={onManualCloseActiveTrade}
              className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 text-xs font-mono font-medium transition-colors"
            >
              Manual Early Exit
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div>
              <span className="text-neutral-500 block">Entry Price</span>
              <span className="text-sm font-bold text-neutral-100">
                ${activeTrade.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">Position Size</span>
              <span className="text-sm font-bold text-neutral-100">
                ${activeTrade.sizeUsd.toFixed(2)} ({activeTrade.amount} units)
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">Stop Loss (Defense)</span>
              <span className="text-sm font-bold text-rose-400">
                ${activeTrade.stopLoss.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 block">Take Profit (Target)</span>
              <span className="text-sm font-bold text-emerald-400">
                ${activeTrade.takeProfit.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Current Live PnL & Survival Note */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-2 border-t border-neutral-800/80 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="text-neutral-400">Unrealized PnL:</span>
              <span
                className={`text-sm font-bold ${
                  activeTrade.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {activeTrade.pnl >= 0 ? "+" : ""}${activeTrade.pnl.toFixed(2)} (
                {activeTrade.pnl >= 0 ? "+" : ""}
                {activeTrade.pnlPercent.toFixed(2)}%)
              </span>
            </div>

            <div className="text-[11px] text-indigo-300 bg-indigo-950/40 border border-indigo-900/50 px-2.5 py-1 rounded max-w-lg truncate">
              {activeTrade.botSurvivalNote}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-neutral-900/40 border border-dashed border-neutral-800 rounded-xl p-4 text-center">
          <p className="text-xs font-mono text-neutral-400">
            No active positions. Algorithmic scanner is continuously analyzing indicator confluence and awaiting qualified setups ({strategy.minConfidence}%+ signal score required) to preserve capital.
          </p>
        </div>
      )}

      {/* Tabs: Trade Execution History vs Active Strategy Matrix */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("HISTORY")}
            className={`px-3 py-1 text-xs font-mono rounded font-semibold transition-colors ${
              activeTab === "HISTORY"
                ? "bg-neutral-800 text-white border border-neutral-700"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Executed Trades ({tradeHistory.length})
          </button>
          <button
            onClick={() => setActiveTab("STRATEGY")}
            className={`px-3 py-1 text-xs font-mono rounded font-semibold transition-colors ${
              activeTab === "STRATEGY"
                ? "bg-neutral-800 text-white border border-neutral-700"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            Active Strategy Rules (v{strategy.version})
          </button>
        </div>

        <span className="text-[11px] font-mono text-neutral-500 hidden sm:inline">
          Automatic Risk Containment Active
        </span>
      </div>

      {/* Tab Content 1: Trade History Table */}
      {activeTab === "HISTORY" ? (
        <div className="overflow-x-auto max-h-[300px]">
          {tradeHistory.length === 0 ? (
            <div className="py-10 text-center text-xs font-mono text-neutral-500">
              No completed trades yet. The system logs recorded execution metrics and attribution reports here.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="text-[11px] text-neutral-500 border-b border-neutral-800 bg-neutral-900/30 sticky top-0">
                <tr>
                  <th className="py-2 px-2">Trade ID</th>
                  <th className="py-2 px-2">Side</th>
                  <th className="py-2 px-2">Entry / Exit</th>
                  <th className="py-2 px-2">PnL ($)</th>
                  <th className="py-2 px-2">Outcome</th>
                  <th className="py-2 px-2 text-right">AI Autopsy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {tradeHistory.map((t) => {
                  const badge = getStatusBadge(t.status);
                  const BadgeIcon = badge.icon;
                  const isProfit = t.pnl > 0;

                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-neutral-900/40 transition-colors"
                    >
                      <td className="py-2.5 px-2 text-neutral-300 font-semibold">
                        {t.id}
                      </td>
                      <td className="py-2.5 px-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            t.type === "LONG"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : "bg-rose-500/20 text-rose-400"
                          }`}
                        >
                          {t.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-neutral-300">
                        ${t.entryPrice.toFixed(2)} &rarr; ${t.exitPrice?.toFixed(2) || "---"}
                      </td>
                      <td className="py-2.5 px-2 font-bold">
                        <span
                          className={
                            isProfit ? "text-emerald-400" : "text-rose-400"
                          }
                        >
                          {isProfit ? "+" : ""}${t.pnl.toFixed(2)} (
                          {isProfit ? "+" : ""}
                          {t.pnlPercent.toFixed(2)}%)
                        </span>
                      </td>
                      <td className="py-2.5 px-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${badge.color}`}
                        >
                          <BadgeIcon className="w-3 h-3" />
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <button
                          onClick={() => onOpenTradeCritique(t)}
                          className="px-2 py-1 rounded bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-800/50 text-[10px] transition-colors inline-flex items-center gap-1"
                        >
                          <Brain className="w-3 h-3 text-indigo-400" />
                          <span>Debrief</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        /* Tab Content 2: Active Strategy Parameters & Rules */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3.5 space-y-2.5">
            <h3 className="font-bold text-neutral-200 text-sm flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              {strategy.name}
            </h3>
            <p className="text-neutral-400 leading-relaxed text-[11px]">
              {strategy.description}
            </p>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-neutral-800 text-[11px]">
              <div>
                <span className="text-neutral-500">Minimum Entry Signal Score:</span>{" "}
                <strong className="text-emerald-400">
                  {strategy.minConfidence}%
                </strong>
              </div>
              <div>
                <span className="text-neutral-500">Stop Loss Distance:</span>{" "}
                <strong className="text-rose-400">
                  {strategy.stopLossPercent}%
                </strong>
              </div>
              <div>
                <span className="text-neutral-500">Take Profit Target:</span>{" "}
                <strong className="text-emerald-400">
                  +{strategy.takeProfitPercent}%
                </strong>
              </div>
              <div>
                <span className="text-neutral-500">Trailing Stop:</span>{" "}
                <strong className="text-cyan-400">
                  {strategy.trailingStop ? `${strategy.trailingStopPercent}%` : "Off"}
                </strong>
              </div>
              <div>
                <span className="text-neutral-500">RSI Oversold/Overbought:</span>{" "}
                <strong className="text-neutral-200">
                  {strategy.rsiOversold} / {strategy.rsiOverbought}
                </strong>
              </div>
              <div>
                <span className="text-neutral-500">Max Risk / Trade:</span>{" "}
                <strong className="text-amber-400">
                  {strategy.maxRiskPerTrade}% Equity
                </strong>
              </div>
            </div>
          </div>

          <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3.5 space-y-2">
            <h3 className="font-bold text-neutral-200 text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-400" />
              Preservation & Survival Rules
            </h3>
            <ul className="space-y-1.5 pt-1">
              {strategy.rules.map((rule, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 text-neutral-300 text-[11px] leading-relaxed"
                >
                  <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
