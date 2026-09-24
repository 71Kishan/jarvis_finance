import React, { useEffect, useState } from "react";
import { Activity, Bot, BookOpen, Database, Link2, ShieldCheck, Wallet, Wrench } from "lucide-react";
import { MarketsWorkspace } from "./MarketsWorkspace";
import type { WorkspaceView } from "../platform/workspace";

interface WorkspaceSurfaceProps {
  view: Exclude<WorkspaceView, "TERMINAL" | "PRACTICE">;
  onSelectAsset: (asset: string) => void;
  onOpenRadar: () => void;
  onOpenResearch: () => void;
  onOpenSettings: () => void;
}

interface RuntimeStatus {
  status?: string;
  symbol?: string;
  lastProcessedCandleAt?: number;
  message?: string;
  databaseState?: string;
  marketState?: string;
  catalogState?: string;
}

export const WorkspaceSurface: React.FC<WorkspaceSurfaceProps> = ({
  view,
  onSelectAsset,
  onOpenRadar,
  onOpenResearch,
  onOpenSettings,
}) => {
  useEffect(() => {
    if (view !== "PORTFOLIO") return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const payload = await response.json();
        if (!cancelled) setPlatformHealth(payload);
      } catch {
        if (!cancelled) setPlatformHealth(null);
      }
    };
    load();
    const timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [view]);

  useEffect(() => {
    if (view !== "AUTOMATION") return;
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const health = await response.json();
        if (!cancelled) {
          setRuntime({
            status: health?.autonomousPaper?.status || "UNKNOWN",
            symbol: health?.autonomousPaper?.symbol,
            lastProcessedCandleAt: health?.autonomousPaper?.lastProcessedCandleAt,
            message: health?.autonomousPaper?.message,
            databaseState: health?.database?.state,
            marketState: health?.marketData?.state,
            catalogState: health?.instrumentCatalog?.state,
          });
        }
      } catch {
        if (!cancelled) setRuntime({ status: "UNAVAILABLE" });
      }
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [view]);

  if (view === "MARKETS") {
    return <MarketsWorkspace onSelectAsset={onSelectAsset} onOpenRadar={onOpenRadar} />;
  }
  if (view === "PORTFOLIO") {
    return (
      <main className="flex-1 max-w-7xl w-full mx-auto p-4">
        <section className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-6">
          <Wallet className="w-6 h-6 text-amber-400" />
          <h1 className="text-xl font-bold text-neutral-100 mt-3">Portfolio</h1>
          <p className="text-sm text-neutral-400 mt-2 max-w-2xl">
            This is the authoritative portfolio surface planned for connected broker and exchange accounts.
            No cash, wallet balance or position is invented while no provider account is linked.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-6">
            <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-4">
              <Link2 className="w-4 h-4 text-neutral-500" />
              <div className="text-[10px] text-neutral-600 font-mono uppercase mt-3">Connected Accounts</div>
              <div className="text-lg font-mono font-semibold text-neutral-200 mt-1">0</div>
            </div>
            <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-4">
              <Wallet className="w-4 h-4 text-neutral-500" />
              <div className="text-[10px] text-neutral-600 font-mono uppercase mt-3">Wallet Balances</div>
              <div className="text-lg font-mono font-semibold text-neutral-200 mt-1">Unavailable</div>
            </div>
            <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-4">
              <Activity className="w-4 h-4 text-neutral-500" />
              <div className="text-[10px] text-neutral-600 font-mono uppercase mt-3">Open Positions</div>
              <div className="text-lg font-mono font-semibold text-neutral-200 mt-1">Unavailable</div>
            </div>
            <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-4">
              <Database className="w-4 h-4 text-neutral-500" />
              <div className="text-[10px] text-neutral-600 font-mono uppercase mt-3">Persistence</div>
              <div className="text-lg font-mono font-semibold text-neutral-200 mt-1">{platformHealth?.database?.state || "LOADING"}</div>
              <div className="text-[9px] font-mono text-neutral-600 mt-1">
                {platformHealth?.binanceSpotTestnetAccount?.configured ? "Binance testnet adapter configured" : "No account credentials configured"}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-mono uppercase text-neutral-600">Next account gate</div>
                <div className="text-sm text-neutral-200 mt-1">Authenticated user session + reconciled provider account</div>
              </div>
              <span className="text-[10px] font-mono text-amber-300 border border-amber-500/20 bg-amber-500/5 rounded px-2 py-1">NOT CONNECTED</span>
            </div>
            <div className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
              The server-side Binance Spot testnet adapter is read-only in this phase. It can inspect balances and open orders after secure account authentication is implemented; it cannot submit or cancel orders.
            </div>
          </div>
          <button type="button" onClick={onOpenSettings} className="mt-5 px-3 py-2 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-xs font-mono text-neutral-200">
            Account & security settings
          </button>
        </section>
      </main>
    );
  }

  if (view === "AUTOMATION") {
    return (
      <main className="flex-1 max-w-7xl w-full mx-auto p-4">
        <section className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-6">
          <Bot className="w-6 h-6 text-violet-400" />
          <h1 className="text-xl font-bold text-neutral-100 mt-3">Automation</h1>
          <p className="text-sm text-neutral-400 mt-2 max-w-2xl">
            Automated execution is a server-owned subsystem. Paper automation is available from Practice Lab;
            real-money execution remains disabled until the broker adapter, reconciliation and production gates are complete.
          </p>
          <div className="mt-6 rounded-lg bg-neutral-950 border border-neutral-800 p-4 font-mono text-xs">
            <div className="flex justify-between"><span className="text-neutral-500">Paper runtime</span><span className="text-neutral-200">{runtime?.status || "LOADING"}</span></div>
            <div className="flex justify-between mt-2"><span className="text-neutral-500">Symbol</span><span className="text-neutral-200">{runtime?.symbol || "—"}</span></div>
            <div className="flex justify-between mt-2"><span className="text-neutral-500">Last processed bar</span><span className="text-neutral-200">{runtime?.lastProcessedCandleAt ? new Date(runtime.lastProcessedCandleAt).toLocaleString() : "—"}</span></div>
            <div className="flex justify-between mt-2"><span className="text-neutral-500">Market gateway</span><span className="text-neutral-200">{runtime?.marketState || "—"}</span></div>
            <div className="flex justify-between mt-2"><span className="text-neutral-500">Instrument catalog</span><span className="text-neutral-200">{runtime?.catalogState || "—"}</span></div>
            <div className="flex justify-between mt-2"><span className="text-neutral-500">PostgreSQL</span><span className="text-neutral-200">{runtime?.databaseState || "DISABLED"}</span></div>
            {runtime?.message && <div className="mt-3 text-neutral-500 leading-relaxed">{runtime.message}</div>}
          </div>
          <div className="flex flex-wrap gap-2 mt-5">
            <button type="button" onClick={onOpenResearch} className="px-3 py-2 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-xs font-mono text-violet-200">
              Review strategies
            </button>
            <button type="button" onClick={onOpenSettings} className="px-3 py-2 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-xs font-mono text-neutral-200">
              Risk & controls
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (view === "RESEARCH") {
    return (
      <main className="flex-1 max-w-7xl w-full mx-auto p-4">
        <section className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-6">
          <BookOpen className="w-6 h-6 text-indigo-400" />
          <h1 className="text-xl font-bold text-neutral-100 mt-3">Research & Strategies</h1>
          <p className="text-sm text-neutral-400 mt-2 max-w-2xl">
            Jarvis separates research hypotheses from execution. Strategy candidates need reproducible testing,
            out-of-sample evidence and forward validation before they can approach live execution.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
            {[
              ["Strategy Lab", "Backtest and compare candidate rules."],
              ["Market Radar", "Screen the supported market universe."],
              ["Data Layer", "Keep provider/source/timestamp context attached to research."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-lg bg-neutral-950 border border-neutral-800 p-4">
                <div className="text-sm font-semibold text-neutral-200">{title}</div>
                <div className="text-xs text-neutral-500 mt-2 leading-relaxed">{body}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-5">
            <button type="button" onClick={onOpenResearch} className="px-3 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-xs font-mono text-indigo-200">
              Open Strategy Lab
            </button>
            <button type="button" onClick={onOpenRadar} className="px-3 py-2 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-xs font-mono text-neutral-200">
              Open Radar
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4">
      <section className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-6">
        <Wrench className="w-6 h-6 text-neutral-400" />
        <h1 className="text-xl font-bold text-neutral-100 mt-3">Settings</h1>
        <p className="text-sm text-neutral-400 mt-2">Security, risk and provider connection controls will live here.</p>
        <button type="button" onClick={onOpenSettings} className="mt-5 px-3 py-2 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-xs font-mono text-neutral-200">
          Open security & risk controls
        </button>
      </section>
    </main>
  );
};
