import React from "react";
import {
  AlertTriangle,
  Award,
  DollarSign,
  Heart,
  Percent,
  Shield,
  TrendingUp,
  Vault,
  Lock,
} from "lucide-react";
import { BotVitality } from "../types/trading";

interface VitalityBarProps {
  vitality: BotVitality;
  onAdjustCircuitBreaker: (newPercent: number) => void;
  onOpenProfitVault?: () => void;
}

export const VitalityBar: React.FC<VitalityBarProps> = ({
  vitality,
  onAdjustCircuitBreaker,
  onOpenProfitVault,
}) => {
  const isDead = vitality.health <= 0;
  const isNearDeath = vitality.health <= 25 && !isDead;

  // Determine health bar color
  const getHealthColor = () => {
    if (isDead) return "bg-rose-600";
    if (vitality.health < 30) return "bg-rose-500 animate-pulse";
    if (vitality.health < 60) return "bg-amber-500";
    return "bg-gradient-to-r from-emerald-500 to-teal-400";
  };

  const netPnlDollars = vitality.currentEquity - vitality.startingCapital;
  const netPnlPercent = (netPnlDollars / vitality.startingCapital) * 100;

  return (
    <div className="bg-neutral-900/90 border-b border-neutral-800/80 px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        {/* Left: Life Force & Health Meter */}
        <div className="flex-1 bg-neutral-950/60 border border-neutral-800 rounded-xl p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield
                className={`w-4 h-4 ${
                  isDead
                    ? "text-neutral-600"
                    : isNearDeath
                    ? "text-rose-500 animate-ping"
                    : "text-emerald-400 fill-emerald-500/20"
                }`}
              />
              <span className="text-xs font-mono font-bold tracking-wide uppercase text-neutral-300">
                Capital Preservation & Risk Budget Index
              </span>
              <span className="text-[11px] font-mono text-neutral-500">
                (Hard-Stops if Drawdown exceeds Limit)
              </span>
            </div>
            <span
              className={`text-sm font-mono font-bold ${
                vitality.health > 50
                  ? "text-emerald-400"
                  : vitality.health > 20
                  ? "text-amber-400"
                  : "text-rose-400"
              }`}
            >
              {isDead ? "0% (CIRCUIT ENGAGED)" : `${vitality.health}% RISK CAPACITY`}
            </span>
          </div>

          {/* Life Meter Progress Bar */}
          <div className="w-full h-2.5 bg-neutral-800 rounded-full overflow-hidden relative">
            <div
              className={`h-full transition-all duration-300 rounded-full ${getHealthColor()}`}
              style={{ width: `${Math.max(0, Math.min(100, vitality.health))}%` }}
            />
          </div>

          <div className="flex items-center justify-between mt-2 text-[11px] font-mono text-neutral-400">
            <span>
              Current Drawdown:{" "}
              <strong
                className={
                  vitality.currentDrawdownPercent > 1.5
                    ? "text-rose-400"
                    : "text-neutral-200"
                }
              >
                {vitality.currentDrawdownPercent}%
              </strong>{" "}
              (Max: {vitality.maxDrawdownPercent}%)
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500">Emergency Halt at:</span>
              <select
                id="circuit-breaker-cutoff-select"
                aria-label="Emergency Halt Drawdown Cutoff"
                value={vitality.circuitBreakerThresholdPercent}
                onChange={(e) => onAdjustCircuitBreaker(parseFloat(e.target.value))}
                className="bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[11px] font-mono text-amber-300 cursor-pointer focus:outline-none"
              >
                <option value="1.5">-1.5% Drawdown</option>
                <option value="2.5">-2.5% Drawdown</option>
                <option value="4.0">-4.0% Drawdown</option>
                <option value="5.0">-5.0% Drawdown</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right: Key Quant Telemetry Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 flex-1">
          {/* Equity */}
          <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-neutral-400 text-xs font-mono">
              <span>Total Equity</span>
              <DollarSign className="w-3.5 h-3.5 text-neutral-500" />
            </div>
            <div className="mt-1">
              <div className="text-base font-mono font-bold text-neutral-100">
                ${vitality.currentEquity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div
                className={`text-[11px] font-mono flex items-center gap-1 ${
                  netPnlDollars >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                <span>{netPnlDollars >= 0 ? "+" : ""}${netPnlDollars.toFixed(2)}</span>
                <span>({netPnlDollars >= 0 ? "+" : ""}{netPnlPercent.toFixed(2)}%)</span>
              </div>
            </div>
          </div>

          {/* Virtual Paper Reserve */}
          <div
            id="vitality-bar-vault-card"
            onClick={onOpenProfitVault}
            title="Virtual paper reserve ledger; no real money is moved and this balance is not isolated from loss at a financial institution"
            className={`bg-neutral-950/60 border border-amber-500/30 hover:border-amber-500/60 rounded-xl p-2.5 flex flex-col justify-between transition-all ${
              onOpenProfitVault ? "cursor-pointer hover:bg-amber-500/5" : ""
            }`}
          >
            <div className="flex items-center justify-between text-amber-400 text-xs font-mono">
              <span className="flex items-center gap-1">
                <Vault className="w-3.5 h-3.5 text-amber-400" />
                <span>Paper Reserve</span>
              </span>
              <Lock className="w-3 h-3 text-amber-500" />
            </div>
            <div className="mt-1">
              <div className="text-base font-mono font-bold text-amber-400">
                ${(vitality.securedProfitVault || 0).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                <span>Virtual Reserve</span>
              </div>
            </div>
          </div>

          {/* Win Rate */}
          <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-neutral-400 text-xs font-mono">
              <span>Historical Win Rate</span>
              <Percent className="w-3.5 h-3.5 text-neutral-500" />
            </div>
            <div className="mt-1">
              <div className="text-base font-mono font-bold text-emerald-400">
                {vitality.winRate}%
              </div>
              <div className="text-[11px] font-mono text-neutral-400">
                {vitality.winningTrades} Wins / {vitality.losingTrades} Loss
              </div>
            </div>
          </div>

          {/* Execution Win Streak */}
          <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-neutral-400 text-xs font-mono">
              <span>Win Streak</span>
              <Shield className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="mt-1">
              <div className="text-base font-mono font-bold text-neutral-100 flex items-center gap-1.5">
                <span>{vitality.survivalStreak}</span>
                <span className="text-xs font-normal text-emerald-400">wins</span>
              </div>
              <div className="text-[11px] font-mono text-neutral-500">
                Consecutive wins
              </div>
            </div>
          </div>

          {/* Strategy Evolution */}
          <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-neutral-400 text-xs font-mono">
              <span>Strategy Version</span>
              <Award className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="mt-1">
              <div className="text-base font-mono font-bold text-indigo-300">
                Gen {vitality.generationsLearned}
              </div>
              <div className="text-[11px] font-mono text-neutral-400">
                Profit Factor: {vitality.profitFactor.toFixed(1)}x
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
