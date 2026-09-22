import React, { useState } from "react";
import {
  AlertCircle,
  Award,
  Brain,
  CheckCircle2,
  ChevronRight,
  Flame,
  Loader2,
  Play,
  RotateCcw,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { BacktestResult, Candle, StrategyConfig, Trade } from "../types/trading";
import { StrategyOptimizer } from "../engine/optimizer";

interface StudyAndOptimizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentStrategy: StrategyConfig;
  candles: Candle[];
  recentTrades: Trade[];
  drawdownPercent: number;
  onApplyStrategy: (newStrategy: StrategyConfig) => void;
}

export const StudyAndOptimizeModal: React.FC<StudyAndOptimizeModalProps> = ({
  isOpen,
  onClose,
  currentStrategy,
  candles,
  recentTrades,
  drawdownPercent,
  onApplyStrategy,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<{
    survivalStatus?: string;
    regimeAssessment?: string;
    thoughtLog?: string;
    survivalVow?: string;
    keyTakeaway?: string;
    recommendedStrategy?: StrategyConfig;
  } | null>(null);

  const [optimizationData, setOptimizationData] = useState<{
    bestStrategy: StrategyConfig;
    bestResult: BacktestResult;
    candidatesTested: { strategy: StrategyConfig; result: BacktestResult }[];
    optimizationInsights: string[];
  } | null>(null);

  if (!isOpen) return null;

  const runDeepStudyAndOptimization = async () => {
    setIsLoading(true);
    try {
      // 1. Run historical backtesting & genetic parameter search
      const opt = StrategyOptimizer.runOptimizationStudy(currentStrategy, candles);
      setOptimizationData(opt);

      // 2. Call Gemini AI via server-side endpoint
      const res = await fetch("/api/bot/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketContext: {
            totalCandlesAnalyzed: candles.length,
            currentPrice: candles[candles.length - 1]?.close,
            indicators: candles[candles.length - 1]?.indicators,
          },
          currentStrategy,
          recentTrades: recentTrades.slice(0, 8),
          drawdownPercent,
          equityStats: {
            winRate: recentTrades.length > 0
              ? (recentTrades.filter((t) => t.pnl > 0).length / recentTrades.length) * 100
              : 100,
            totalTrades: recentTrades.length,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAiAnalysis(data);
      }
    } catch (err) {
      console.error("Failed to run AI study:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdoptBestStrategy = () => {
    if (aiAnalysis?.recommendedStrategy) {
      onApplyStrategy({
        ...currentStrategy,
        ...aiAnalysis.recommendedStrategy,
        id: `strat-evolved-v${(currentStrategy.version || 1) + 1}`,
        version: (currentStrategy.version || 1) + 1,
      });
      onClose();
    } else if (optimizationData?.bestStrategy) {
      onApplyStrategy(optimizationData.bestStrategy);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono text-xs">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-wide">
                Quantitative Strategy Evolution & Backtest Lab
              </h2>
              <p className="text-[11px] text-neutral-400">
                Historical testing, holdout validation, and AI-assisted research proposals
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

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Action Trigger Banner */}
          <div className="bg-gradient-to-r from-indigo-950/40 via-neutral-900 to-neutral-900 border border-indigo-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Run Research & Validation Cycle</span>
              </div>
              <p className="text-[11px] text-neutral-400 max-w-xl">
                Evaluates the available history using a chronological holdout, execution-cost assumptions, and conservative stop/target handling. AI output is treated as a proposal, not an execution command.
              </p>
            </div>

            <button
              id="start-study-btn"
              onClick={runDeepStudyAndOptimization}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all shadow-lg flex items-center gap-2 shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Computing Models...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>Run Quantitative Optimization</span>
                </>
              )}
            </button>
          </div>

          {/* Quantitative Risk Engine Section */}
          {aiAnalysis && (
            <div className="space-y-3">
              <div className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                  <span className="font-bold text-neutral-200 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    Quantitative Risk & Regime Assessment
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px]">
                    Research Assessment: {aiAnalysis.survivalStatus || "UNSPECIFIED"}
                  </span>
                </div>

                <blockquote className="italic text-neutral-300 leading-relaxed border-l-2 border-indigo-500 pl-3 py-0.5">
                  "{aiAnalysis.thoughtLog}"
                </blockquote>

                <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800/80 text-[11px] space-y-1">
                  <div className="text-amber-400 font-semibold">
                    Risk Mandate: "{aiAnalysis.survivalVow}"
                  </div>
                  <div className="text-neutral-400">
                    Regime Assessment: <strong className="text-neutral-200">{aiAnalysis.regimeAssessment}</strong>
                  </div>
                  <div className="text-neutral-400">
                    Key Quantitative Takeaway: <strong className="text-indigo-300">{aiAnalysis.keyTakeaway}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Backtest Results of Candidates */}
          {optimizationData && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-neutral-200 text-xs flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-400" />
                  Simulated Strategy Candidates ({optimizationData.candidatesTested.length} tested across historical data)
                </h3>
                <span className="text-[10px] text-neutral-500">
                  Ordered by the validation objective; inspect holdout trades, P&L, drawdown and expectancy before using a candidate.
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {optimizationData.candidatesTested.map((cand, idx) => {
                  const isTop = idx === 0;
                  const res = cand.result;

                  return (
                    <div
                      key={cand.strategy.id}
                      className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 transition-all ${
                        isTop
                          ? "bg-indigo-950/20 border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.1)]"
                          : "bg-neutral-900/40 border-neutral-800"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-neutral-200 text-xs">
                              {cand.strategy.name}
                            </span>
                            {isTop && (
                              <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold border border-emerald-500/40">
                                TOP VALIDATION CANDIDATE
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-neutral-400 mt-0.5">
                            {cand.strategy.description}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 bg-neutral-950/60 p-2 rounded-lg border border-neutral-800/80 text-[10px]">
                        <div>
                          <span className="text-neutral-500 block">Win Rate</span>
                          <strong
                            className={
                              res.winRate >= 85
                                ? "text-emerald-400 text-xs"
                                : "text-neutral-200 text-xs"
                            }
                          >
                            {res.winRate}%
                          </strong>
                        </div>
                        <div>
                          <span className="text-neutral-500 block">Total PnL</span>
                          <strong
                            className={
                              res.totalPnl >= 0
                                ? "text-emerald-400 text-xs"
                                : "text-rose-400 text-xs"
                            }
                          >
                            {res.totalPnl >= 0 ? "+" : ""}${res.totalPnl.toFixed(2)}
                          </strong>
                        </div>
                        <div>
                          <span className="text-neutral-500 block">Max Drawdown</span>
                          <strong
                            className={
                              res.maxDrawdown > 2.0
                                ? "text-rose-400 text-xs"
                                : "text-emerald-400 text-xs"
                            }
                          >
                            {res.maxDrawdown}%
                          </strong>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-neutral-400 pt-1 border-t border-neutral-800/60">
                        <span>Min Confidence: {cand.strategy.minConfidence}%</span>
                        <span>SL: {cand.strategy.stopLossPercent}% | TP: +{cand.strategy.takeProfitPercent}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Insights */}
              <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-3 space-y-1.5 text-[11px]">
                <div className="font-semibold text-neutral-300">Optimization Takeaways:</div>
                {optimizationData.optimizationInsights.map((ins, i) => (
                  <div key={i} className="text-neutral-400 flex items-start gap-2">
                    <span className="text-emerald-400">&bull;</span>
                    <span>{ins}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-900/70 flex items-center justify-between">
          <span className="text-neutral-500 text-[11px]">
            Applying a candidate changes the paper strategy only. It does not approve live trading, and a paper backtest is not evidence of guaranteed future performance.
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold transition-colors"
            >
              Close
            </button>
            <button
              id="adopt-strategy-btn"
              onClick={handleAdoptBestStrategy}
              disabled={!optimizationData && !aiAnalysis}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Use as Paper Candidate</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
