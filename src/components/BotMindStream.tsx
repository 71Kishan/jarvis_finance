import React, { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Brain,
  Filter,
  Flame,
  Shield,
  Terminal,
  Zap,
} from "lucide-react";
import { BotThoughtLog } from "../types/trading";

interface BotMindStreamProps {
  thoughts: BotThoughtLog[];
  activeRuleCount: number;
  strategyVersion: number;
}

export const BotMindStream: React.FC<BotMindStreamProps> = ({
  thoughts,
  activeRuleCount,
  strategyVersion,
}) => {
  const [filterType, setFilterType] = useState<string>("ALL");

  const filteredThoughts = thoughts.filter((t) => {
    if (filterType === "ALL") return true;
    if (filterType === "EXECUTION") return t.type === "EXECUTION";
    if (filterType === "STUDY") return t.type === "STUDY" || t.type === "OPTIMIZATION";
    if (filterType === "DEFENSE") return t.type === "DEFENSE" || t.type === "PERISH_ALERT";
    return true;
  });

  const getTypeBadge = (type: BotThoughtLog["type"]) => {
    switch (type) {
      case "EXECUTION":
        return {
          label: "EXEC",
          color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
          icon: Zap,
        };
      case "SIGNAL":
        return {
          label: "SIGNAL",
          color: "bg-teal-500/20 text-teal-300 border-teal-500/40",
          icon: Activity,
        };
      case "STUDY":
        return {
          label: "STUDY",
          color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
          icon: Brain,
        };
      case "OPTIMIZATION":
        return {
          label: "EVOLVE",
          color: "bg-purple-500/20 text-purple-300 border-purple-500/40",
          icon: Flame,
        };
      case "DEFENSE":
        return {
          label: "DEFENSE",
          color: "bg-amber-500/20 text-amber-300 border-amber-500/40",
          icon: Shield,
        };
      case "PERISH_ALERT":
        return {
          label: "CRITICAL HALT",
          color: "bg-rose-500/30 text-rose-300 border-rose-500/50 animate-pulse",
          icon: AlertTriangle,
        };
    }
  };

  return (
    <div className="bg-neutral-950 border border-neutral-800/90 rounded-xl p-4 flex flex-col h-[480px] shadow-lg">
      {/* Mind Stream Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <h2 className="font-mono font-bold text-sm text-neutral-100 uppercase tracking-wide">
            Quantitative Decision & Strategy Log
          </h2>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
            Model v{strategyVersion}
          </span>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-0.5 text-[11px] font-mono">
          {["ALL", "EXECUTION", "STUDY", "DEFENSE"].map((f) => (
            <button
              key={f}
              onClick={() => setFilterType(f)}
              className={`px-2 py-0.5 rounded transition-colors ${
                filterType === f
                  ? "bg-neutral-700 text-white font-bold"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Risk Mandate Banner */}
      <div className="my-2.5 bg-neutral-900/70 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-neutral-400 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          <span>
            System Mandate: <strong>Capital Preservation & Risk-Adjusted Asymmetric Alpha</strong>
          </span>
        </span>
        <span className="text-[11px] text-neutral-500 hidden sm:inline">
          {activeRuleCount} active execution filters
        </span>
      </div>

      {/* Scrolling Thought Stream */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 font-mono text-xs">
        {filteredThoughts.length === 0 ? (
          <div className="text-center py-12 text-neutral-500">
            No entries for current filter
          </div>
        ) : (
          filteredThoughts.map((thought) => {
            const badge = getTypeBadge(thought.type);
            const Icon = badge.icon;
            const timeStr = new Date(thought.timestamp).toLocaleTimeString([], {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            return (
              <div
                key={thought.id}
                className="p-2.5 rounded-lg bg-neutral-900/50 border border-neutral-800/60 hover:border-neutral-700 transition-colors flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded border font-semibold ${badge.color}`}
                    >
                      <Icon className="w-3 h-3" />
                      {badge.label}
                    </span>
                    <strong className="text-neutral-200 font-semibold truncate max-w-[200px] sm:max-w-none">
                      {thought.headline}
                    </strong>
                  </div>
                  <span className="text-neutral-500 text-[10px]">{timeStr}</span>
                </div>

                <p className="text-neutral-300 text-xs leading-relaxed pl-1">
                  {thought.message}
                </p>

                {thought.confidence !== undefined && (
                  <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-1 border-t border-neutral-800/40">
                    <span>
                      Confidence:{" "}
                      <strong
                        className={
                          thought.confidence >= 80
                            ? "text-emerald-400"
                            : "text-amber-400"
                        }
                      >
                        {thought.confidence}%
                      </strong>
                    </span>
                    {thought.vitalityDelta !== undefined && (
                      <span
                        className={
                          thought.vitalityDelta >= 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }
                      >
                        Vitality: {thought.vitalityDelta >= 0 ? "+" : ""}
                        {thought.vitalityDelta}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
