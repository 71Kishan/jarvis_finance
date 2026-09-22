import React from "react";
import { Trade } from "../types/trading";
import {
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  X,
  Crosshair,
  Layers,
} from "lucide-react";

interface TradeVerificationToastProps {
  trade: Trade;
  onClose: () => void;
  onScrollToTable: () => void;
}

export const TradeVerificationToast: React.FC<TradeVerificationToastProps> = ({
  trade,
  onClose,
  onScrollToTable,
}) => {
  const isLong = trade.type === "LONG";

  return (
    <div
      id="trade-verification-toast"
      className="fixed top-16 right-4 z-50 max-w-md w-full bg-neutral-900/95 border-2 border-emerald-500/80 rounded-2xl shadow-2xl backdrop-blur-md p-4 animate-in slide-in-from-top-4 duration-300 font-sans"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/40 animate-pulse">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-400 font-mono tracking-wider uppercase">
                Paper Fill Recorded
              </span>
              <span className="px-1.5 py-0.2 bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-mono rounded">
                LIVE PAPER FILL
              </span>
            </div>
            <div className="text-sm font-bold text-white flex items-center gap-1.5 mt-0.5">
              <span
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-mono font-bold ${
                  isLong
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/20 text-rose-300"
                }`}
              >
                {isLong ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {trade.type}
              </span>
              <span>{trade.asset}</span>
              <span className="text-neutral-400 font-normal">@</span>
              <span className="font-mono text-emerald-300">
                ${trade.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        <button
          id="close-verification-toast-btn"
          type="button"
          onClick={onClose}
          className="p-1 text-neutral-400 hover:text-white rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Execution Telemetry Grid */}
      <div className="mt-3 grid grid-cols-3 gap-2 bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800 text-xs font-mono">
        <div>
          <span className="text-[10px] text-neutral-400 block font-sans">Order Size</span>
          <span className="text-neutral-200 font-bold">${trade.sizeUsd.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-[10px] text-rose-400 block font-sans">Stop Loss</span>
          <span className="text-rose-300 font-bold">${trade.stopLoss.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-[10px] text-emerald-400 block font-sans">Take Profit</span>
          <span className="text-emerald-300 font-bold">${trade.takeProfit.toFixed(2)}</span>
        </div>
      </div>

      {/* Verification Checklist */}
      <div className="mt-3 pt-2.5 border-t border-neutral-800/80 text-[11px] text-neutral-300 flex flex-col gap-1.5">
        <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wide flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>5-Point Live Verification Proof:</span>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-neutral-400">
          <span className="flex items-center gap-1 text-emerald-400">
            ✓ 1. Chart Level Overlays
          </span>
          <span className="flex items-center gap-1 text-emerald-400">
            ✓ 2. Active Position Banner
          </span>
          <span className="flex items-center gap-1 text-emerald-400">
            ✓ 3. AI Thought Log
          </span>
          <span className="flex items-center gap-1 text-emerald-400">
            ✓ 4. Strategy Vault Entry
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-neutral-800">
        <span className="text-[10px] font-mono text-neutral-500 truncate">
          ID: {trade.id}
        </span>
        <button
          id="inspect-verified-trade-btn"
          type="button"
          onClick={() => {
            onScrollToTable();
            onClose();
          }}
          className="text-xs font-semibold text-indigo-300 hover:text-indigo-200 flex items-center gap-1 underline underline-offset-2 transition-colors"
        >
          <span>Inspect in Trade Journal</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
