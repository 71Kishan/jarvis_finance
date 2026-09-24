import React, { useState } from "react";
import {
  Activity,
  AlertOctagon,
  Brain,
  CheckCircle2,
  ChevronDown,
  Flame,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Shield,
  ShieldAlert,
  Skull,
  Sliders,
  Volume2,
  VolumeX,
  Zap,
  Radar,
  BookOpen,
  BarChart2,
  Clock,
  Smartphone,
  Vault,
  Sparkles,
  Mic,
} from "lucide-react";
import { BotState, MarketDataSource, ActionNotification } from "../types/trading";
import { soundFx } from "../utils/soundEffects";
import { NotificationCenter } from "./NotificationCenter";
import { InstrumentSearch } from "./InstrumentSearch";
import type { Instrument } from "../platform/types";
import { WORKSPACE_LABELS, WorkspaceView } from "../platform/workspace";

interface HeaderProps {
  currentAsset: string;
  onSelectAsset: (asset: string) => void;
  currentView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  botState: BotState;
  marketSource: MarketDataSource;
  isAutoTrading: boolean;
  onToggleAutoTrading: () => void;
  simulationSpeed: number;
  onSetSimulationSpeed: (speed: number) => void;
  onStepTick: () => void;
  onOpenStudyModal: () => void;
  onOpenRiskSettings?: () => void;
  onOpenRadar?: () => void;
  onOpenVault?: () => void;
  onOpenMarketHours?: () => void;
  onOpenSecurityVault?: () => void;
  onOpenCopilot?: (mode?: "CHAT" | "VOICE") => void;
  onOpenProfitVault?: () => void;
  securedVaultBalance?: number;
  onTriggerKillSwitch: () => void;
  onReviveBot: () => void;
  notifications: ActionNotification[];
  onMarkAllNotificationsRead: () => void;
  onClearNotifications: () => void;
  onScrollToAnalytics?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentAsset,
  onSelectAsset,
  botState,
  marketSource,
  isAutoTrading,
  onToggleAutoTrading,
  simulationSpeed,
  onSetSimulationSpeed,
  onStepTick,
  onOpenStudyModal,
  onOpenRiskSettings,
  onOpenRadar,
  onOpenVault,
  onOpenMarketHours,
  onOpenSecurityVault,
  onOpenCopilot,
  onOpenProfitVault,
  securedVaultBalance = 0,
  onTriggerKillSwitch,
  onReviveBot,
  notifications,
  onMarkAllNotificationsRead,
  onClearNotifications,
  onScrollToAnalytics,
}) => {
  const getStateBadge = () => {
    if (currentView !== "PRACTICE") {
      return {
        label: currentView === "TERMINAL" ? "MARKET TERMINAL" : WORKSPACE_LABELS[currentView].toUpperCase(),
        color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
        icon: Radio,
        pulse: "bg-emerald-400",
      };
    }
    switch (botState) {
      case "THRIVING":
        return {
          label: "PAPER SYSTEM STABLE",
          color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
          icon: Flame,
          pulse: "bg-emerald-400",
        };
      case "HUNTING":
        return {
          label: "SCANNING QUALIFIED SIGNALS",
          color: "bg-blue-500/10 text-blue-400 border-blue-500/30",
          icon: Zap,
          pulse: "bg-blue-400",
        };
      case "IN_POSITION":
        return {
          label: "POSITION ACTIVE (RISK MONITORED)",
          color: "bg-violet-500/10 text-violet-300 border-violet-500/30",
          icon: Activity,
          pulse: "bg-violet-400",
        };
      case "DEFENSIVE":
        return {
          label: "DEFENSIVE POSTURE (VOLATILITY GUARD)",
          color: "bg-amber-500/10 text-amber-400 border-amber-500/30",
          icon: ShieldAlert,
          pulse: "bg-amber-400",
        };
      case "CRITICAL_HAZARD":
        return {
          label: "CIRCUIT WARNING (RISK BUDGET CONTRACTION)",
          color: "bg-rose-500/15 text-rose-400 border-rose-500/40 animate-pulse",
          icon: AlertOctagon,
          pulse: "bg-rose-400",
        };
      case "HALTED_DEAD":
        return {
          label: "EXECUTION SUSPENDED (CIRCUIT BREAKER ENGAGED)",
          color: "bg-red-950/80 text-red-300 border-red-700/60",
          icon: AlertOctagon,
          pulse: "bg-red-600",
        };
      default:
        return {
          label: "ACTIVE",
          color: "bg-neutral-800 text-neutral-300 border-neutral-700",
          icon: Activity,
          pulse: "bg-neutral-400",
        };
    }
  };

  const badge = getStateBadge();
  const BadgeIcon = badge.icon;

  return (
    <header className="border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-md px-4 py-3 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Left: Branding & Status */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-neutral-100 tracking-tight text-sm md:text-base">
                  JARVIS FINANCE
                </span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
                  Research + Controlled Optimization
                </span>
              </div>
              <p className="text-xs text-neutral-400 font-mono">
                Research & Paper Trading &bull; Evidence-Driven Risk Controls
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div
            className={`flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-mono font-medium ${badge.color}`}
          >
            <span className="relative flex h-2 w-2">
              {botState !== "HALTED_DEAD" && (
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${badge.pulse}`}
                />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${badge.pulse}`}
              />
            </span>
            <BadgeIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{badge.label}</span>
          </div>
        </div>

        {/* Right: Controls, Asset Switcher & Speed */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          {/* Dynamic instrument search: provider catalog, not a hardcoded asset list */}
          <InstrumentSearch
            value={currentAsset}
            disabled={botState === "IN_POSITION"}
            onSelect={(instrument: Instrument) => onSelectAsset(instrument.symbol)}
          />

          {currentView === "PRACTICE" && (
            <>
          {/* Auto-Trading Toggle */}
          <button
            id="toggle-autotrade-btn"
            onClick={onToggleAutoTrading}
            disabled={botState === "HALTED_DEAD"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all shadow-sm ${
              isAutoTrading
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
                : "bg-neutral-800 text-neutral-300 border border-neutral-700 hover:bg-neutral-700"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {isAutoTrading ? (
              <>
                <Play className="w-3.5 h-3.5 fill-emerald-400 text-emerald-400" />
                <span>PAPER AUTO ACTIVE</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>TRADING PAUSED</span>
              </>
            )}
          </button>

          {/* Speed Buttons */}
          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
            {[1, 2, 5, 10].map((spd) => (
              <button
                key={spd}
                id={`speed-btn-${spd}x`}
                onClick={() => onSetSimulationSpeed(spd)}
                className={`px-2 py-1 text-[11px] font-mono rounded transition-colors ${
                  simulationSpeed === spd
                    ? "bg-neutral-700 text-white font-bold"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {spd}x
              </button>
            ))}
            <button
              id="step-tick-btn"
              onClick={onStepTick}
              title="Step Single Tick"
              className="px-2 py-1 text-[11px] font-mono text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
            >
              +1 Tick
            </button>
          </div>

          {/* AI Strategy Evolution Lab Modal */}
          <button
            id="open-brain-lab-btn"
            onClick={onOpenStudyModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-xs font-mono font-medium transition-all"
          >
            <Brain className="w-3.5 h-3.5 text-indigo-400" />
            <span>Strategy Lab</span>
          </button>

          {/* AI Copilot & Voice Advisor Button */}
          {onOpenCopilot && (
            <div className="flex items-center rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 overflow-hidden shadow-[0_0_12px_rgba(99,102,241,0.18)]">
              <button
                id="header-open-copilot-btn"
                onClick={() => onOpenCopilot("CHAT")}
                title="Jarvis Finance AI Copilot & Research Assistant"
                className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-indigo-600/30 text-xs font-mono font-semibold transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>AI Copilot</span>
              </button>
              <button
                id="header-open-voice-btn"
                type="button"
                onClick={() => onOpenCopilot("VOICE")}
                title="Live voice research assistant"
                className="px-2 py-1.5 border-l border-indigo-500/30 hover:bg-indigo-600/30 text-indigo-300 transition-colors"
              >
                <Mic className="w-3.5 h-3.5 text-indigo-400" />
              </button>
            </div>
          )}

          {/* Paper Profit Reserve Button */}
          {onOpenProfitVault && (
            <button
              id="header-open-profit-vault-btn"
              onClick={onOpenProfitVault}
              title="Paper Profit Reserve: virtual transfer ledger only"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/35 text-xs font-mono font-semibold transition-all shadow-[0_0_10px_rgba(245,158,11,0.15)] cursor-pointer"
            >
              <Vault className="w-3.5 h-3.5 text-amber-400" />
              <span>Vault: ${securedVaultBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
            </button>
          )}

          {/* Multi-Asset Radar Button */}
          {onOpenRadar && (
            <button
              id="header-open-radar-btn"
              onClick={onOpenRadar}
              title="Review supported assets from connected market-data sources"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 text-xs font-mono transition-colors"
            >
              <Radar className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Radar</span>
            </button>
          )}

          {/* Strategy Vault Button */}
          {onOpenVault && (
            <button
              id="header-open-vault-btn"
              onClick={onOpenVault}
              title="Strategy evidence journal and validation states"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 text-xs font-mono transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Vault</span>
            </button>
          )}

          {/* Quick Analytics Jump Button */}
          {onScrollToAnalytics && (
            <button
              id="header-scroll-analytics-btn"
              onClick={onScrollToAnalytics}
              title="Jump to P&L, Equity & Risk Analytics Charts"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 text-xs font-mono transition-colors"
            >
              <BarChart2 className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Analytics</span>
            </button>
          )}

          {/* Market Sessions & Runtime Button */}
          {onOpenMarketHours && (
            <button
              id="header-open-market-hours-btn"
              onClick={onOpenMarketHours}
              title="Market sessions and server runtime architecture"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 text-xs font-mono transition-colors cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Market Sessions</span>
            </button>
          )}

          {/* Security Vault & Legal Compliance Button */}
          {onOpenSecurityVault && (
            <button
              id="header-open-security-vault-btn"
              onClick={onOpenSecurityVault}
              title="Security controls, disclosures and local audit checks"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-mono transition-colors cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Security & Legal</span>
            </button>
          )}

          {/* Action Notifications Center */}
          <NotificationCenter
            notifications={notifications}
            onMarkAllRead={onMarkAllNotificationsRead}
            onClear={onClearNotifications}
          />

            </>
          )}

          {/* Risk & Paper Settings Modal */}
          {onOpenRiskSettings && (
            <button
              id="header-open-risk-settings-btn"
              onClick={onOpenRiskSettings}
              title="Risk Settings & Account Reseed"
              className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-850 text-neutral-300 border border-neutral-800 transition-colors"
            >
              <Sliders className="w-4 h-4" />
            </button>
          )}

          {/* Sound Toggle */}
          <button
            id="header-toggle-sound-btn"
            onClick={() => {
              const current = soundFx.getEnabled();
              soundFx.setEnabled(!current);
            }}
            title="Toggle Web Audio Telemetry Alerts"
            className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-850 text-neutral-300 border border-neutral-800 transition-colors"
          >
            <Volume2 className="w-4 h-4" />
          </button>

          {/* Emergency Circuit Breaker or Reset Execution */}
          {botState === "HALTED_DEAD" ? (
            <button
              id="revive-bot-btn"
              onClick={onReviveBot}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold transition-all shadow-[0_0_12px_rgba(16,185,129,0.3)] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset & Resume Execution</span>
            </button>
          ) : (
            <button
              id="kill-switch-btn"
              onClick={onTriggerKillSwitch}
              title="Trigger Emergency Circuit Breaker: liquidates open positions and halts automated execution"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 text-xs font-mono font-medium transition-all cursor-pointer"
            >
              <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden lg:inline">Emergency Halt</span>
            </button>
          )}
        </div>
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 pt-3 mt-3 border-t border-neutral-900">
        <nav className="flex items-center gap-1 overflow-x-auto pb-0.5" aria-label="Jarvis workspace">
          {(["TERMINAL", "MARKETS", "PORTFOLIO", "AUTOMATION", "RESEARCH", "PRACTICE"] as WorkspaceView[]).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => onChangeView(view)}
              className={
                "px-3 py-1.5 rounded-lg text-xs font-mono font-semibold whitespace-nowrap transition-colors " +
                (currentView === view
                  ? "bg-neutral-800 text-white border border-neutral-700"
                  : "text-neutral-500 hover:text-neutral-200 hover:bg-neutral-900 border border-transparent")
              }
            >
              {WORKSPACE_LABELS[view]}
            </button>
          ))}
        </nav>
        <div className="text-[10px] font-mono text-neutral-600 uppercase tracking-wider">
          {currentView === "PRACTICE" ? "Paper / Simulation workspace" : "Live market workspace"}
        </div>
      </div>
      </div>
    </header>
  );
};
