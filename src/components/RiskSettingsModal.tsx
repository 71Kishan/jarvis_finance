import React, { useState } from "react";
import { BotVitality, PaperTradingSettings, Trade } from "../types/trading";
import {
  X,
  Shield,
  Sliders,
  Volume2,
  VolumeX,
  Download,
  RotateCcw,
  AlertOctagon,
  CheckCircle,
} from "lucide-react";

interface RiskSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vitality: BotVitality;
  paperSettings: PaperTradingSettings;
  tradeHistory: Trade[];
  onUpdateSettings: (settings: Partial<PaperTradingSettings>) => void;
  onUpdateCircuitBreaker: (percent: number) => void;
  onResetAccount: (initialCapital: number) => void;
}

export const RiskSettingsModal: React.FC<RiskSettingsModalProps> = ({
  isOpen,
  onClose,
  vitality,
  paperSettings,
  tradeHistory,
  onUpdateSettings,
  onUpdateCircuitBreaker,
  onResetAccount,
}) => {
  const [circuitBreaker, setCircuitBreaker] = useState(vitality.circuitBreakerThresholdPercent);
  const [slippage, setSlippage] = useState(paperSettings.slippageBps);
  const [feeTier, setFeeTier] = useState(paperSettings.feeTierPercent);
  const [soundEnabled, setSoundEnabled] = useState(paperSettings.soundAlerts);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    onUpdateCircuitBreaker(circuitBreaker);
    onUpdateSettings({
      slippageBps: slippage,
      feeTierPercent: feeTier,
      soundAlerts: soundEnabled,
    });
    setSavedNote(true);
    setTimeout(() => {
      setSavedNote(false);
      onClose();
    }, 800);
  };

  const handleExportCSV = () => {
    if (tradeHistory.length === 0) {
      alert("No closed paper trades to export yet.");
      return;
    }

    const headers = [
      "ID",
      "Asset",
      "Type",
      "Entry Price",
      "Exit Price",
      "Size USD",
      "PnL USD",
      "PnL Percent",
      "Status",
      "Entry Time",
      "Exit Time",
      "Confidence",
      "Survival Note",
    ];

    const rows = tradeHistory.map((t) => [
      t.id,
      t.asset,
      t.type,
      t.entryPrice,
      t.exitPrice || "",
      t.sizeUsd,
      t.pnl,
      `${t.pnlPercent}%`,
      t.status,
      new Date(t.entryTime).toISOString(),
      t.exitTime ? new Date(t.exitTime).toISOString() : "",
      `${t.confidence}%`,
      `"${(t.botSurvivalNote || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `survival_bot_paper_trades_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      id="risk-settings-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        id="risk-settings-modal-window"
        className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-950/70 border border-indigo-800 text-indigo-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-neutral-100 text-base">
                Risk & Paper Trading Settings
              </h2>
              <p className="text-xs text-neutral-400">
                Calibrate execution slippage, fees, circuit breaker limits, and audio telemetry.
              </p>
            </div>
          </div>
          <button
            id="risk-settings-close-btn"
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section 1: Existential Circuit Breaker Limit */}
        <div className="flex flex-col gap-2 p-3.5 bg-neutral-950/70 rounded-xl border border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-neutral-200 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-rose-400" />
              <span>Emergency Circuit Breaker Limit</span>
            </span>
            <span className="font-mono text-sm font-bold text-rose-400">
              {circuitBreaker}% Drawdown
            </span>
          </div>
          <p className="text-[11px] text-neutral-400 leading-snug">
            If cumulative equity draws down by this percentage, the circuit breaker terminates automated trading
            immediately to guarantee remaining funds are protected from catastrophic loss.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <input
              type="range"
              min="1.0"
              max="10.0"
              step="0.5"
              value={circuitBreaker}
              onChange={(e) => setCircuitBreaker(Number(e.target.value))}
              className="w-full accent-rose-500 cursor-pointer"
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono text-neutral-400">
            <span>1.0% (Ultra-Strict)</span>
            <span>2.5% (Default)</span>
            <span>10.0% (High Volatility)</span>
          </div>
        </div>

        {/* Section 2: Paper Trading Realism (Slippage & Fees) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-neutral-950/70 rounded-xl border border-neutral-800 flex flex-col gap-1.5">
            <div className="text-xs font-semibold text-neutral-300">
              Simulated Slippage
            </div>
            <div className="text-[10px] text-neutral-400">
              Simulates realistic market order fill penalty.
            </div>
            <div className="flex items-center gap-1 mt-1">
              <input
                type="number"
                min="0"
                max="20"
                step="1"
                value={slippage}
                onChange={(e) => setSlippage(Number(e.target.value))}
                className="w-20 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 font-mono text-xs text-neutral-200"
              />
              <span className="text-xs text-neutral-400 font-mono">bps ({slippage / 100}%)</span>
            </div>
          </div>

          <div className="p-3 bg-neutral-950/70 rounded-xl border border-neutral-800 flex flex-col gap-1.5">
            <div className="text-xs font-semibold text-neutral-300">
              Exchange Fee Tier
            </div>
            <div className="text-[10px] text-neutral-400">
              Deducted per fill (maker/taker average).
            </div>
            <div className="flex items-center gap-1 mt-1">
              <input
                type="number"
                min="0"
                max="0.2"
                step="0.01"
                value={feeTier}
                onChange={(e) => setFeeTier(Number(e.target.value))}
                className="w-20 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 font-mono text-xs text-neutral-200"
              />
              <span className="text-xs text-neutral-400 font-mono">%</span>
            </div>
          </div>
        </div>

        {/* Section 3: Audio Synthesizer & Mobile Push Alerts */}
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3.5 bg-neutral-950/70 rounded-xl border border-neutral-800">
            <div className="flex items-center gap-2.5">
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-indigo-400" />
              ) : (
                <VolumeX className="w-4 h-4 text-neutral-400" />
              )}
              <div>
                <div className="text-xs font-semibold text-neutral-200">
                  Audio Synthesizer Telemetry
                </div>
                <div className="text-[11px] text-neutral-400">
                  Real-time harmonic chimes on trade entry, TP target hit, and circuit breaker trip.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                soundEnabled
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-neutral-800 text-neutral-400"
              }`}
            >
              {soundEnabled ? "ENABLED" : "MUTED"}
            </button>
          </div>
        </div>

        {/* Section 4: Export Trade History & Portfolio Reset */}
        <div className="flex flex-col gap-2 pt-2 border-t border-neutral-800">
          <button
            id="export-trade-csv-btn"
            type="button"
            onClick={handleExportCSV}
            className="w-full py-2 px-3 bg-neutral-800 hover:bg-neutral-750 text-neutral-200 border border-neutral-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Export Paper Trading Journal (CSV)</span>
          </button>

          {!resetConfirm ? (
            <button
              id="request-reset-account-btn"
              type="button"
              onClick={() => setResetConfirm(true)}
              className="w-full py-2 px-3 bg-red-950/20 hover:bg-red-950/40 text-rose-400 border border-rose-900/40 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reset & Reseed Paper Account ($10,000)</span>
            </button>
          ) : (
            <div className="p-3 bg-rose-950/50 border border-rose-800 rounded-xl flex flex-col gap-2">
              <div className="text-xs text-rose-300 font-semibold flex items-center gap-1.5">
                <AlertOctagon className="w-4 h-4 text-rose-400" />
                <span>Confirm Full Paper Account Reset?</span>
              </div>
              <p className="text-[11px] text-neutral-300">
                Restores $10,000 balance, clears open positions, and resets capital preservation index to 100%.
              </p>
              <div className="flex items-center gap-2 mt-1">
                <button
                  id="confirm-reset-account-btn"
                  type="button"
                  onClick={() => {
                    onResetAccount(10000);
                    setResetConfirm(false);
                    onClose();
                  }}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-colors"
                >
                  Yes, Reset Account
                </button>
                <button
                  type="button"
                  onClick={() => setResetConfirm(false)}
                  className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            id="save-risk-settings-btn"
            type="button"
            onClick={handleSave}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            {savedNote ? (
              <>
                <CheckCircle className="w-4 h-4 text-emerald-300" />
                <span>Saved</span>
              </>
            ) : (
              <span>Save & Apply Settings</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
