import React, { useState } from "react";
import {
  AlertOctagon,
  ArrowRight,
  Brain,
  DollarSign,
  HeartCrack,
  RotateCcw,
  Shield,
  ShieldAlert,
  Skull,
} from "lucide-react";
import { BotVitality, StrategyConfig } from "../types/trading";

interface EmergencyHaltModalProps {
  isOpen: boolean;
  vitality: BotVitality;
  strategy: StrategyConfig;
  onReviveBot: (recapitalAmount?: number) => void;
  onUpdateThreshold: (newThreshold: number) => void;
}

export const EmergencyHaltModal: React.FC<EmergencyHaltModalProps> = ({
  isOpen,
  vitality,
  strategy,
  onReviveBot,
  onUpdateThreshold,
}) => {
  const [recapital, setRecapital] = useState<number>(vitality.startingCapital);
  const [newHaltCutoff, setNewHaltCutoff] = useState<number>(
    vitality.circuitBreakerThresholdPercent
  );

  if (!isOpen) return null;

  const lossDollars = vitality.startingCapital - vitality.currentEquity;

  const handleRevive = () => {
    onUpdateThreshold(newHaltCutoff);
    onReviveBot(recapital);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-neutral-950 border border-rose-700/60 rounded-2xl w-full max-w-lg shadow-[0_0_50px_rgba(225,29,72,0.25)] overflow-hidden font-mono text-xs flex flex-col">
        {/* Header with Circuit Breaker Warning */}
        <div className="bg-rose-950/70 border-b border-rose-800/80 px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-900/60 border border-rose-600/60 text-rose-300 flex items-center justify-center shrink-0 shadow-lg">
            <AlertOctagon className="w-5 h-5 animate-pulse text-rose-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-rose-100 uppercase tracking-wide">
              Emergency Circuit Breaker Triggered
            </h2>
            <p className="text-[11px] text-rose-300">
              Operations halted immediately to preserve portfolio capital
            </p>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* Capital Preservation Statement */}
          <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-neutral-300">
              <span>Capital Preserved Safely:</span>
              <strong className="text-base text-emerald-400 font-bold">
                ${vitality.currentEquity.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </strong>
            </div>

            <div className="flex items-center justify-between text-neutral-400 text-[11px] pt-1 border-t border-neutral-800">
              <span>Controlled Drawdown Limited At:</span>
              <span className="text-rose-400 font-bold">
                -${Math.abs(lossDollars).toFixed(2)} (-{vitality.currentDrawdownPercent}%)
              </span>
            </div>

            <div className="flex items-center justify-between text-neutral-400 text-[11px]">
              <span>Maximum Allowed Threshold:</span>
              <span className="text-neutral-200">
                {vitality.circuitBreakerThresholdPercent}% Drawdown
              </span>
            </div>
          </div>

          {/* Circuit Attribution Analysis */}
          <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>Circuit Attribution & Risk Analysis</span>
            </div>
            <p className="text-neutral-300 text-[11px] leading-relaxed">
              The algorithm detected adverse market regime dislocation and reached the pre-set risk boundary. Rather than allowing compounding drawdown, the system strictly enforced its fiduciary circuit breaker: open positions were safely liquidated and automated order entry was suspended.
            </p>
            <p className="text-indigo-300 text-[11px] bg-indigo-950/30 p-2 rounded border border-indigo-900/40">
              Risk-halt state reached. The modeled limits stop new paper entries; they cannot guarantee protection from real-market gaps or losses.
            </p>
          </div>

          {/* Recalibration Controls */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center gap-2 text-neutral-200 font-bold">
              <RotateCcw className="w-4 h-4 text-emerald-400" />
              <span>System Reset & Recalibration Protocol</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <label className="text-neutral-400 block mb-1">
                  Starting Balance ($)
                </label>
                <input
                  id="revive-balance-input"
                  type="number"
                  aria-label="Starting Balance"
                  value={recapital}
                  onChange={(e) => setRecapital(Number(e.target.value) || 10000)}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded px-2.5 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-neutral-400 block mb-1">
                  Circuit Breaker Cutoff
                </label>
                <select
                  id="revive-cutoff-select"
                  aria-label="Circuit Breaker Cutoff"
                  value={newHaltCutoff}
                  onChange={(e) => setNewHaltCutoff(parseFloat(e.target.value))}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded px-2.5 py-1.5 text-neutral-100 focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="1.5">-1.5% (Ultra Defensive)</option>
                  <option value="2.5">-2.5% (Balanced)</option>
                  <option value="4.0">-4.0% (Adaptive)</option>
                  <option value="5.0">-5.0% (Tolerant)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-900/70 flex items-center justify-end gap-2">
          <button
            id="confirm-revive-btn"
            onClick={handleRevive}
            className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reboot Terminal & Resume Execution</span>
          </button>
        </div>
      </div>
    </div>
  );
};
