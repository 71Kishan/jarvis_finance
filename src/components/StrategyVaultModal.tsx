import React, { useState } from "react";
import {
  StrategyConfig,
  StrategyVaultEntry,
  DailyPerformanceGoal,
} from "../types/trading";
import {
  strategyVaultInstance,
} from "../engine/strategyVault";
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
  Target,
  X,
  Layers,
  Award,
} from "lucide-react";

interface StrategyVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentStrategy: StrategyConfig;
  onApplyStrategy: (strategy: StrategyConfig) => void;
}

export const StrategyVaultModal: React.FC<StrategyVaultModalProps> = ({
  isOpen,
  onClose,
  currentStrategy,
  onApplyStrategy,
}) => {
  const [activeTab, setActiveTab] = useState<"PROVEN" | "ALL" | "TESTING" | "DISCARDED">("PROVEN");
  const [strategies, setStrategies] = useState<StrategyVaultEntry[]>(() =>
    strategyVaultInstance.getAllStrategies()
  );
  const [dailyGoal, setDailyGoal] = useState<DailyPerformanceGoal>(() =>
    strategyVaultInstance.getDailyGoal()
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const refreshVault = () => {
    setStrategies(strategyVaultInstance.getAllStrategies());
    setDailyGoal(strategyVaultInstance.getDailyGoal());
  };

  const filteredStrategies = strategies.filter((s) => {
    if (activeTab === "PROVEN") return s.status === "PROVISIONALLY_VALIDATED";
    if (activeTab === "TESTING") return s.status === "TESTING_PAPER";
    if (activeTab === "DISCARDED") return s.status === "DISCARDED_FAILED";
    return true;
  });

  const handleActivate = (strat: StrategyVaultEntry) => {
    onApplyStrategy({ ...strat.config });
    setFeedback(`Activated "${strat.name}" as live paper strategy!`);
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleScanBestModel = () => {
    setFeedback("Jarvis does not auto-select or auto-deploy a 'best' strategy. Review the validation evidence and activate a candidate manually.");
    setTimeout(() => setFeedback(null), 4000);
  };

  const progressPercent = Math.min(
    100,
    Math.max(0, (dailyGoal.currentDailyPnlUsd / dailyGoal.dailyTargetUsd) * 100)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        id="strategy-vault-modal"
        className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-neutral-100">
                  Strategy Memory Vault & Anti-Duplication Engine
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-emerald-950 text-emerald-300 border border-emerald-800">
                  Evidence-Driven
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Maintains systematic logs of all tested models. Records candidates, test results and failures. A strategy is not treated as validated without sufficient out-of-sample and forward-paper evidence.
              </p>
            </div>
          </div>

          <button
            id="close-strategy-vault-btn"
            type="button"
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Daily Process Metrics */}
        <div className="bg-gradient-to-r from-neutral-950 via-emerald-950/20 to-neutral-950 p-4 border-b border-neutral-800">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-2.5">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">
                Daily Income Target: ${dailyGoal.dailyTargetUsd.toFixed(2)} / day
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-neutral-400">
                Today's Paper PnL:{" "}
                <span
                  className={`font-bold ${
                    dailyGoal.currentDailyPnlUsd >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {dailyGoal.currentDailyPnlUsd >= 0 ? "+" : ""}$
                  {dailyGoal.currentDailyPnlUsd.toFixed(2)}
                </span>
              </span>
              <span className="text-neutral-400">
                Trades: <span className="text-neutral-200 font-bold">{dailyGoal.tradesCountToday}</span>
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px]">
                {dailyGoal.streakDays}-Day Win Streak 🔥
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-neutral-950 rounded-full h-2 overflow-hidden border border-neutral-800">
            <div
              className={`h-full transition-all duration-500 ${
                dailyGoal.targetAchieved ? "bg-emerald-400 animate-pulse" : "bg-emerald-500"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] text-neutral-500 mt-1 font-mono">
            <span>Progress: {progressPercent.toFixed(1)}%</span>
            <span>
              {dailyGoal.targetAchieved ? "NO DAILY TARGET" : "Executing only when the research rules qualify a setup"}
            </span>
          </div>
        </div>

        {/* Action & Filter Bar */}
        <div className="p-4 border-b border-neutral-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-neutral-900/50">
          {/* Tab Filter */}
          <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-xl border border-neutral-800">
            <button
              id="vault-tab-proven"
              type="button"
              onClick={() => setActiveTab("PROVEN")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                activeTab === "PROVEN"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Provisionally Validated ({strategies.filter((s) => s.status === "PROVISIONALLY_VALIDATED").length})</span>
            </button>
            <button
              id="vault-tab-all"
              type="button"
              onClick={() => setActiveTab("ALL")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "ALL"
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              All Models ({strategies.length})
            </button>
            <button
              id="vault-tab-testing"
              type="button"
              onClick={() => setActiveTab("TESTING")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "TESTING"
                  ? "bg-indigo-600 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Paper Testing ({strategies.filter((s) => s.status === "TESTING_PAPER").length})
            </button>
            <button
              id="vault-tab-discarded"
              type="button"
              onClick={() => setActiveTab("DISCARDED")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${
                activeTab === "DISCARDED"
                  ? "bg-rose-900/80 text-rose-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Discarded / Failed ({strategies.filter((s) => s.status === "DISCARDED_FAILED").length})</span>
            </button>
          </div>

          <button
            id="deploy-best-proven-btn"
            type="button"
            onClick={handleScanBestModel}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-2 transition-colors shadow-md shadow-emerald-950/40"
          >
            <Sparkles className="w-4 h-4" />
            <span>Review Validated Candidates</span>
          </button>
        </div>

        {/* Feedback Message */}
        {feedback && (
          <div className="mx-4 mt-3 p-2 bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs rounded-xl flex items-center gap-2 font-mono">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{feedback}</span>
          </div>
        )}

        {/* Strategy List */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {filteredStrategies.map((item) => {
            const isCurrent = item.config.name === currentStrategy.name;
            const isProven = item.status === "PROVISIONALLY_VALIDATED";
            const isDiscarded = item.status === "DISCARDED_FAILED";

            return (
              <div
                key={item.id}
                className={`p-4 rounded-xl border transition-all ${
                  isCurrent
                    ? "bg-emerald-950/20 border-emerald-500/50 shadow-md"
                    : isProven
                    ? "bg-neutral-950/70 border-emerald-900/40 hover:border-emerald-700/50"
                    : isDiscarded
                    ? "bg-neutral-950/50 border-rose-950 hover:border-rose-900"
                    : "bg-neutral-950/70 border-neutral-800 hover:border-neutral-700"
                }`}
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`p-1.5 rounded-lg ${
                        isProven
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                          : isDiscarded
                          ? "bg-rose-950 text-rose-400 border border-rose-900"
                          : "bg-indigo-950 text-indigo-400 border border-indigo-800"
                      }`}
                    >
                      {isProven ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : isDiscarded ? (
                        <ShieldAlert className="w-4 h-4" />
                      ) : (
                        <Clock className="w-4 h-4" />
                      )}
                    </span>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-neutral-100">
                          {item.name}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 bg-neutral-900 border border-neutral-800 rounded text-neutral-400">
                          v{item.version}
                        </span>
                        {isCurrent && (
                          <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-bold rounded-full">
                            ACTIVE PAPER
                          </span>
                        )}
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                            isProven
                              ? "bg-emerald-950 text-emerald-400 border-emerald-800"
                              : isDiscarded
                              ? "bg-rose-950 text-rose-400 border-rose-900"
                              : "bg-indigo-950 text-indigo-400 border-indigo-800"
                          }`}
                        >
                          {item.status.replace("_", " ")}
                        </span>
                      </div>

                      {/* Anti-Duplication Signature */}
                      <div className="text-[10px] font-mono text-neutral-500 mt-0.5 flex items-center gap-1.5 truncate max-w-lg">
                        <span className="text-neutral-400">Sig:</span>
                        <span className="truncate bg-neutral-900 px-1 py-0.2 rounded border border-neutral-800">
                          {item.signature}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {!isDiscarded && !isCurrent && (
                      <button
                        id={`activate-strat-${item.id}`}
                        type="button"
                        onClick={() => handleActivate(item)}
                        className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors border border-neutral-700"
                      >
                        <span>Deploy Strategy</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-xs p-2.5 bg-neutral-900/60 rounded-lg border border-neutral-800/80 mb-2">
                  <div>
                    <span className="text-[10px] font-sans text-neutral-500 block">Win Rate</span>
                    <span
                      className={`font-bold ${
                        item.winRate >= 65
                          ? "text-emerald-400"
                          : item.winRate >= 50
                          ? "text-amber-400"
                          : "text-rose-400"
                      }`}
                    >
                      {item.winRate}% ({item.wins}W / {item.losses}L)
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-neutral-500 block">Total PnL</span>
                    <span
                      className={`font-bold ${
                        item.totalPnlUsd >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {item.totalPnlUsd >= 0 ? "+" : ""}${item.totalPnlUsd.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-neutral-500 block">Profit Factor</span>
                    <span className="text-neutral-200 font-bold">{item.profitFactor}x</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-neutral-500 block">Max Drawdown</span>
                    <span className="text-rose-400 font-bold">{item.maxDrawdownPercent}%</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-neutral-500 block">Confidence Min</span>
                    <span className="text-cyan-400 font-bold">{item.config.minConfidence}%</span>
                  </div>
                </div>

                {/* Status Evaluation Notes */}
                {item.successNotes && (
                  <div className="text-[11px] text-emerald-300/90 font-sans flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span>{item.successNotes}</span>
                  </div>
                )}
                {item.failureReason && (
                  <div className="text-[11px] text-rose-400/90 font-sans flex items-start gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-500 flex-shrink-0 mt-0.5" />
                    <span>{item.failureReason}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
