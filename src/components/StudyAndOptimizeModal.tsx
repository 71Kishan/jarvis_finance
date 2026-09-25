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
import { Candle, StrategyConfig, Trade } from "../types/trading";
import { LearningResearchLoop, LearningResearchResult } from "../learn/researchLoop";
import type { LearningTradeRecord } from "../learn/types";

interface StudyAndOptimizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentStrategy: StrategyConfig;
  candles: Candle[];
  recentTrades: Trade[];
  learningRecords: LearningTradeRecord[];
  drawdownPercent: number;
  onApplyStrategy: (newStrategy: StrategyConfig) => void;
}

export const StudyAndOptimizeModal: React.FC<StudyAndOptimizeModalProps> = ({
  isOpen,
  onClose,
  currentStrategy,
  candles,
  recentTrades,
  learningRecords,
  drawdownPercent,
  onApplyStrategy,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<{
    survivalStatus?: string;
    regimeAssessment?: string;
    thoughtLog?: string;
    riskDisciplineNote?: string;
    keyTakeaway?: string;
    recommendedStrategy?: StrategyConfig;
  } | null>(null);

  const [researchData, setResearchData] = useState<LearningResearchResult | null>(null);

  if (!isOpen) return null;

  const runDeepStudyAndOptimization = async () => {
    setIsLoading(true);
    try {
      // 1. Run deterministic research with an explicit learning-data gate.
      const research = LearningResearchLoop.run(currentStrategy, candles, learningRecords);
      setResearchData(research);

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

  const handleLoadResearchCandidate = () => {
    if (!researchData?.proposedCandidate || researchData.status !== "REVIEW_REQUIRED") return;
    onApplyStrategy(researchData.proposedCandidate);
    onClose();
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
                Deterministic research, walk-forward validation, and learning-data gated candidate generation
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
                Evaluates {candles.length} historical candles and {learningRecords.length} structured trade outcomes. Historical candidates are research evidence; learning-driven proposals require a larger outcome sample.
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

          {researchData && (
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-3 space-y-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-neutral-300">Learning Dataset Readiness</span>
                <span className={researchData.featureResearch.readyForFirstExperiment ? "text-emerald-400" : "text-amber-400"}>
                  {researchData.featureResearch.readyForFirstExperiment ? "READY FOR CONTROLLED EXPERIMENT" : "RESEARCH DATA BUILDING"}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-neutral-400">
                <span>Valid feature rows: <strong className="text-neutral-200">{researchData.featureResearch.audit.rowsValid}</strong></span>
                <span>Required floor: <strong className="text-neutral-200">{90}</strong></span>
                <span>Missing-feature rows: <strong className="text-neutral-200">{researchData.featureResearch.audit.rowsMissingFeatures}</strong></span>
                <span>Leakage issues: <strong className={researchData.featureResearch.audit.leakageIssues.length ? "text-rose-400" : "text-emerald-400"}>{researchData.featureResearch.audit.leakageIssues.length}</strong></span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Chronological 60/20/20 dataset split; no shuffling and no target fields are included in the numeric feature vector.
              </div>
            </div>
          )}

          {researchData && researchData.mlExperiment && (
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-3 space-y-3 text-[11px]">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-neutral-300">First Controlled ML Experiment</span>
                  <div className="text-[10px] text-neutral-500 mt-0.5">Logistic-regression meta-labeler on deterministic signals</div>
                </div>
                <span className={researchData.mlExperiment.status === "READY" ? "text-indigo-300" : "text-amber-400"}>
                  {researchData.mlExperiment.status === "READY" ? "HELD-OUT TESTED" : researchData.mlExperiment.status}
                </span>
              </div>

              {researchData.mlExperiment.status === "READY" ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <span className="text-neutral-400">Features <strong className="text-neutral-200">{researchData.mlExperiment.selectedFeatures.length}</strong></span>
                    <span className="text-neutral-400">Threshold <strong className="text-neutral-200">{(researchData.mlExperiment.selectedThreshold! * 100).toFixed(0)}%</strong></span>
                    <span className="text-neutral-400">Validation log loss <strong className="text-neutral-200">{researchData.mlExperiment.selectedValidationLogLoss}</strong></span>
                    <span className="text-neutral-400">Test AUC <strong className="text-neutral-200">{researchData.mlExperiment.test!.rocAuc === null ? "N/A" : researchData.mlExperiment.test!.rocAuc}</strong></span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                      <div className="text-neutral-500 mb-1.5">Deterministic test baseline</div>
                      <div className="grid grid-cols-2 gap-1.5 text-neutral-300">
                        <span>Trades: {researchData.mlExperiment.deterministicTest!.tradesTaken}/{researchData.mlExperiment.deterministicTest!.rowsConsidered}</span>
                        <span>P&L: {researchData.mlExperiment.deterministicTest!.totalPnlUsd >= 0 ? "+" : ""}${researchData.mlExperiment.deterministicTest!.totalPnlUsd.toFixed(2)}</span>
                        <span>Win rate: {researchData.mlExperiment.deterministicTest!.winRate}%</span>
                        <span>Profit factor: {researchData.mlExperiment.deterministicTest!.profitFactor}</span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/10 p-3">
                      <div className="text-neutral-500 mb-1.5">ML-filtered test overlay</div>
                      <div className="grid grid-cols-2 gap-1.5 text-neutral-300">
                        <span>Trades: {researchData.mlExperiment.modelFilteredTest!.tradesTaken}/{researchData.mlExperiment.modelFilteredTest!.rowsConsidered}</span>
                        <span>P&L: {researchData.mlExperiment.modelFilteredTest!.totalPnlUsd >= 0 ? "+" : ""}${researchData.mlExperiment.modelFilteredTest!.totalPnlUsd.toFixed(2)}</span>
                        <span>Win rate: {researchData.mlExperiment.modelFilteredTest!.winRate}%</span>
                        <span>Max DD: ${researchData.mlExperiment.modelFilteredTest!.maxDrawdownUsd.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-[10px] text-neutral-500">
                    Model inputs are normalized with TRAIN-only statistics. Hyperparameters and threshold are chosen on VALIDATION; the TEST partition is evaluated afterward and does not drive selection.
                  </div>
                </>
              ) : (
                <div className="text-[10px] text-neutral-400">
                  {researchData.mlExperiment.blockedReasons.join(" ") || "Experiment is not ready."}
                </div>
              )}
            </div>
          )}

          {/* Backtest Results of Candidates */}
          {researchData && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-neutral-200 text-xs flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-400" />
                  Research Candidates ({researchData.candidates.length} tested across train / validation / held-out test data)
                </h3>
                <span className="text-[10px] text-neutral-500">
                  Order shown: validation evidence and held-out test results
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {researchData.candidates.map((cand, idx) => {
                  const isTop = researchData.proposedCandidate?.id === cand.strategy.id;
                  const res = cand.test;

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

              {/* Insights */}
              <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-3 space-y-1.5 text-[11px]">
                <div className="font-semibold text-neutral-300">Optimization Takeaways:</div>
                {researchData.notes.map((ins, i) => (
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
            A candidate can only be loaded after the structured learning and research gates are satisfied. AI analysis remains advisory.
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
              onClick={handleLoadResearchCandidate}
              disabled={researchData?.status !== "REVIEW_REQUIRED"}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Load Research Candidate</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
