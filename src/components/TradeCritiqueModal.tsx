import React, { useEffect, useState } from "react";
import { Brain, CheckCircle2, Loader2, ShieldAlert, X } from "lucide-react";
import { Trade } from "../types/trading";

interface TradeCritiqueModalProps {
  trade: Trade | null;
  onClose: () => void;
}

export const TradeCritiqueModal: React.FC<TradeCritiqueModalProps> = ({
  trade,
  onClose,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [critique, setCritique] = useState<{
    verdict?: string;
    autopsy?: string;
    lesson?: string;
    survivalHealthImpact?: string;
  } | null>(null);

  useEffect(() => {
    if (!trade) {
      setCritique(null);
      return;
    }

    const fetchCritique = async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/bot/critique-trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trade,
            marketSnapshot: {
              exitPrice: trade.exitPrice,
              entryPrice: trade.entryPrice,
              pnl: trade.pnl,
              pnlPercent: trade.pnlPercent,
              status: trade.status,
            },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setCritique(data);
        }
      } catch (err) {
        console.error("Failed to critique trade:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCritique();
  }, [trade]);

  if (!trade) return null;

  const isWin = trade.pnl >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden font-mono text-xs flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/50">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                isWin
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
              }`}
            >
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-100">
                Quantitative Trade Attribution & Risk Audit
              </h2>
              <p className="text-[11px] text-neutral-400">
                Order {trade.id} &bull; {trade.type} {trade.asset}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 flex items-center justify-center border border-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Trade Quick Card */}
          <div className="grid grid-cols-3 gap-2 bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 text-center">
            <div>
              <span className="text-neutral-500 block text-[10px]">Result</span>
              <strong
                className={`text-sm ${
                  isWin ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {isWin ? "+" : ""}${trade.pnl.toFixed(2)}
              </strong>
            </div>
            <div>
              <span className="text-neutral-500 block text-[10px]">Return</span>
              <strong
                className={`text-sm ${
                  isWin ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {isWin ? "+" : ""}{trade.pnlPercent.toFixed(2)}%
              </strong>
            </div>
            <div>
              <span className="text-neutral-500 block text-[10px]">Confidence</span>
              <strong className="text-sm text-indigo-300">
                {trade.confidence}%
              </strong>
            </div>
          </div>

          {/* Quantitative Analysis State */}
          {isLoading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2 text-neutral-400">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <p>Analyzing execution mechanics and risk parameters...</p>
            </div>
          ) : critique ? (
            <div className="space-y-3">
              <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-neutral-200">
                    {critique.verdict}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      isWin
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                    }`}
                  >
                    {critique.survivalHealthImpact}
                  </span>
                </div>
                <p className="text-neutral-300 text-[11px] leading-relaxed">
                  {critique.autopsy}
                </p>
              </div>

              <div className="bg-indigo-950/20 border border-indigo-500/30 rounded-xl p-3.5 space-y-1">
                <span className="font-bold text-indigo-300 block">
                  Execution Heuristic Absorbed Into Strategy Memory:
                </span>
                <p className="text-neutral-300 text-[11px]">
                  "{critique.lesson}"
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-900/70 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            Close Audit
          </button>
        </div>
      </div>
    </div>
  );
};
