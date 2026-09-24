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
import { evaluateStrategyValidation } from "../engine/strategyValidation";
import { strategyVaultInstance } from "../engine/strategyVault";

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
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<{
    survivalStatus?: string;
    regimeAssessment?: string;
    thoughtLog?: string;
    riskDisciplineNote?: string;
    keyTakeaway?: string;
    recommendedStrategy?: StrategyConfig;
  } | null>(null);

  const [optimizationData, setOptimizationData] = useState<{
    bestStrategy: StrategyConfig;
    bestResult: BacktestResult;
    candidatesTested: { strategy: StrategyConfig; result: BacktestResult; selectedFolds?: number }[];
    optimizationInsights: string[];
    walkForwardReliable?: boolean;
    walkForwardSummary?: {
      folds: number;
      selectedFolds: number;
      selectedFoldHitRatePercent: number;
      meanOosReturnPercent: number;
      medianOosReturnPercent: number;
      worstOosDrawdownPercent: number;
      oosCalendarDays?: number;
      selectionCounts: Record<string, number>;
    };
    validation?: ReturnType<typeof evaluateStrategyValidation>;
  } | null>(null);

  if (!isOpen) return null;

  const runDeepStudyAndOptimization = async () => {
    setIsLoading(true);
    try {
      // 1. Run historical backtesting & genetic parameter search
      const opt = StrategyOptimizer.runOptimizationStudy(currentStrategy, candles);
      const validation = evaluateStrategyValidation(opt);
      strategyVaultInstance.recordValidationResult(opt.bestStrategy, validation);
      setOptimizationData({ ...opt, validation });

      // The browser result is useful for immediate feedback, but promotion evidence
      // should be recomputed from server-owned market history before it is trusted.
      setPersistenceMessage("Local study complete. Recomputing validation from server-owned market history…");
      try {
        const serverResponse = await fetch("/api/research/strategy-validation/recompute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ strategy: opt.bestStrategy }),
        });

        const serverPayload = await serverResponse.json().catch(() => ({}));
        if (serverResponse.ok && serverPayload?.optimization?.bestStrategy && serverPayload?.optimization?.validation) {
          const serverOptimization = serverPayload.optimization;
          const serverValidation = serverOptimization.validation;
          strategyVaultInstance.recordValidationResult(serverOptimization.bestStrategy, serverValidation);
          setOptimizationData(serverOptimization);
          setPersistenceMessage(
            `Server-recomputed evidence archived (${serverPayload.interval || "server interval"} • ${serverPayload.candlesAnalyzed || 0} candles). Source: live Binance public market data.`,
          );
        } else if (serverResponse.status === 401 || serverResponse.status === 403) {
          setPersistenceMessage("Local study complete. Sign in to archive or server-recompute research evidence.");
        } else {
          const fallbackPayload = {
            result: validation,
          };
          const fallbackResponse = await fetch("/api/research/strategy-validation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(fallbackPayload),
          });
          if (fallbackResponse.ok) {
            setPersistenceMessage("Server recomputation was unavailable; submitted research evidence was archived.");
          } else {
            setPersistenceMessage(serverPayload?.error || "Research ran locally; server evidence archive was unavailable.");
          }
        }
      } catch {
        try {
          const fallbackResponse = await fetch("/api/research/strategy-validation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ result: validation }),
          });
          setPersistenceMessage(
            fallbackResponse.ok
              ? "Server recomputation was unavailable; submitted research evidence was archived."
              : "Research ran locally; server evidence archive was unavailable.",
          );
        } catch {
          setPersistenceMessage("Research ran locally; server evidence archive was unavailable.");
        }
      }

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
    if (optimizationData?.bestStrategy && optimizationData.validation?.status === "PROVISIONALLY_VALIDATED") {
      // The AI is advisory-only. It cannot bypass the deterministic promotion gate.
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
                Continuous optimization via historical market data and quantitative parameter search
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
                <span>Execute Quantitative Strategy Optimization Cycle</span>
              </div>
              <p className="text-[11px] text-neutral-400 max-w-xl">
                Evaluates {candles.length} historical candles, tests a small set of strategy variants against historical data using the configured risk and execution model.
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
                    Status: {aiAnalysis.survivalStatus || "MONITOR"}
                  </span>
                </div>

                <blockquote className="italic text-neutral-300 leading-relaxed border-l-2 border-indigo-500 pl-3 py-0.5">
                  "{aiAnalysis.thoughtLog}"
                </blockquote>

                <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800/80 text-[11px] space-y-1">
                  <div className="text-amber-400 font-semibold">
                    Risk Discipline: "{aiAnalysis.riskDisciplineNote || "Use configured limits; no model output overrides risk controls."}"
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
                  Order shown: validation evidence and held-out test results
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {optimizationData.candidatesTested.map((cand, idx) => {
                  const isTop = cand.strategy.id === optimizationData.bestStrategy.id;
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
                                SELECTED RESEARCH CANDIDATE
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
                        <span>Signal Threshold: {cand.strategy.minConfidence}%</span>
                        <span>SL: {cand.strategy.stopLossPercent}% | TP: +{cand.strategy.takeProfitPercent}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {optimizationData.walkForwardSummary && (
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-neutral-500">Walk-forward evidence</div>
                      <div className="text-xs text-neutral-300 mt-1">
                        {optimizationData.walkForwardSummary.folds} rolling folds • {optimizationData.walkForwardSummary.selectedFolds} selected-candidate folds
                      </div>
                    </div>
                    <span className={optimizationData.walkForwardReliable
                      ? "px-2 py-1 rounded border border-emerald-700/50 bg-emerald-950/20 text-emerald-300 text-[10px] font-mono"
                      : "px-2 py-1 rounded border border-amber-800/50 bg-amber-950/20 text-amber-300 text-[10px] font-mono"}>
                      {optimizationData.walkForwardReliable ? "EVIDENCE SUFFICIENT FOR FORWARD REVIEW" : "INSUFFICIENT FOR VALIDATION DECISION"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[10px]">
                    <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-2">
                      <span className="text-neutral-600 block">OOS positive-fold rate</span>
                      <strong className="text-neutral-200">{optimizationData.walkForwardSummary.selectedFoldHitRatePercent}%</strong>
                    </div>
                    <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-2">
                      <span className="text-neutral-600 block">Mean OOS return</span>
                      <strong className="text-neutral-200">{optimizationData.walkForwardSummary.meanOosReturnPercent}%</strong>
                    </div>
                    <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-2">
                      <span className="text-neutral-600 block">Median OOS return</span>
                      <strong className="text-neutral-200">{optimizationData.walkForwardSummary.medianOosReturnPercent}%</strong>
                    </div>
                    <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-2">
                      <span className="text-neutral-600 block">Worst OOS drawdown</span>
                      <strong className="text-neutral-200">{optimizationData.walkForwardSummary.worstOosDrawdownPercent}%</strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Insights */}
              {optimizationData.validation && (
                <div className={`rounded-xl border p-3 space-y-3 ${
                  optimizationData.validation.status === "PROVISIONALLY_VALIDATED"
                    ? "border-emerald-700/50 bg-emerald-950/10"
                    : optimizationData.validation.status === "FAILED"
                      ? "border-rose-900/50 bg-rose-950/10"
                      : "border-amber-800/50 bg-amber-950/10"
                }`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-neutral-500">Deterministic promotion gate</div>
                      <div className="text-xs text-neutral-200 mt-1">
                        {optimizationData.validation.status === "PROVISIONALLY_VALIDATED"
                          ? "Candidate is eligible for paper automation review."
                          : optimizationData.validation.status === "FAILED"
                            ? "Candidate is rejected by the current validation policy."
                            : "Evidence is not sufficient for promotion yet."}
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded border border-neutral-700 bg-neutral-950 text-[10px] font-mono text-neutral-300">
                      {optimizationData.validation.gates.filter((gate) => gate.passed).length}/{optimizationData.validation.gates.length} GATES
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {optimizationData.validation.gates.map((gate) => (
                      <div key={gate.id} className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-neutral-300">{gate.label}</span>
                          <span className={gate.passed ? "text-emerald-400" : "text-rose-400"}>
                            {gate.passed ? "PASS" : "FAIL"}
                          </span>
                        </div>
                        <div className="text-[9px] text-neutral-600 mt-1">{gate.observed} • {gate.required}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    AI recommendations remain advisory and cannot bypass these deterministic gates. Historical evidence does not guarantee future performance; forward paper/shadow validation is still required.
                  </div>
                </div>
              )}

              {persistenceMessage && (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-[10px] text-neutral-500">
                  {persistenceMessage}
                </div>
              )}

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
            Only candidates that pass every deterministic validation gate can be promoted to paper automation. Forward paper/shadow evidence remains a separate gate.
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
              disabled={optimizationData?.validation?.status !== "PROVISIONALLY_VALIDATED"}
              title={
                optimizationData?.validation?.status === "PROVISIONALLY_VALIDATED"
                  ? "Apply the deterministic validated research candidate to paper automation."
                  : "Candidate must pass every deterministic validation gate before promotion."
              }
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Promote Validated Candidate</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
