import React, { useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  Bot,
  CheckCircle2,
  Database,
  Link2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Wallet,
  Wrench,
} from "lucide-react";
import { MarketsWorkspace } from "./MarketsWorkspace";
import type { WorkspaceView } from "../platform/workspace";

interface WorkspaceSurfaceProps {
  view: Exclude<WorkspaceView, "TERMINAL" | "PRACTICE">;
  onSelectAsset: (asset: string) => void;
  onOpenRadar: () => void;
  onOpenResearch: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
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

interface AccountConnectionView {
  id: string;
  provider: string;
  accountType: string;
  label: string;
  externalAccountId?: string;
  status: string;
  permissions: string[];
  lastSyncedAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface BalanceView {
  accountId: string;
  asset: string;
  free: string;
  locked: string;
  total: string;
  updatedAt: number;
}

interface OpenOrderView {
  clientOrderId: string;
  accountId: string;
  instrumentId: string;
  externalOrderId?: string;
  side: "BUY" | "SELL";
  type: string;
  quantity: string;
  limitPrice?: string;
  stopPrice?: string;
  timeInForce?: string;
  status: string;
  filledQuantity: string;
  averageFillPrice?: string;
  requestedAt: number;
  updatedAt: number;
}

interface AccountOverview {
  connections: AccountConnectionView[];
  balances: BalanceView[];
  openOrders: OpenOrderView[];
}

function formatTimestamp(value?: number): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function formatDecimal(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  if (Math.abs(numeric) >= 1000) return numeric.toLocaleString(undefined, { maximumFractionDigits: 8 });
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 12 });
}

export const WorkspaceSurface: React.FC<WorkspaceSurfaceProps> = ({
  view,
  onSelectAsset,
  onOpenRadar,
  onOpenResearch,
  onOpenSettings,
  onLogout,
}) => {
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [platformHealth, setPlatformHealth] = useState<any>(null);
  const [accountOverview, setAccountOverview] = useState<AccountOverview | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);

  const loadHealth = async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      setPlatformHealth(payload);
      setRuntime({
        status: payload?.autonomousPaper?.status || "UNKNOWN",
        symbol: payload?.autonomousPaper?.symbol,
        lastProcessedCandleAt: payload?.autonomousPaper?.lastProcessedCandleAt,
        message: payload?.autonomousPaper?.message,
        databaseState: payload?.database?.state,
        marketState: payload?.marketData?.state,
        catalogState: payload?.instrumentCatalog?.state,
      });
    } catch {
      setPlatformHealth(null);
      setRuntime({ status: "UNAVAILABLE" });
    }
  };

  const loadAccountOverview = async () => {
    try {
      const response = await fetch("/api/account/overview", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Account overview unavailable.");
      setAccountOverview({
        connections: Array.isArray(payload?.connections) ? payload.connections : [],
        balances: Array.isArray(payload?.balances) ? payload.balances : [],
        openOrders: Array.isArray(payload?.openOrders) ? payload.openOrders : [],
      });
      setAccountMessage(null);
    } catch (error: any) {
      setAccountOverview(null);
      setAccountMessage(error?.message || "Account overview unavailable.");
    }
  };

  const syncBinanceTestnet = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    setAccountMessage(null);

    try {
      const response = await fetch("/api/account/binance-testnet/sync", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Binance testnet sync failed.");

      setAccountOverview((current) => ({
        connections: payload?.connection ? [payload.connection, ...(current?.connections || []).filter((row) => row.id !== payload.connection.id)] : current?.connections || [],
        balances: Array.isArray(payload?.balances) ? payload.balances : current?.balances || [],
        openOrders: Array.isArray(payload?.openOrders) ? payload.openOrders : current?.openOrders || [],
      }));
      setAccountMessage("Binance Spot Testnet account synchronized from the provider.");
      void loadHealth();
    } catch (error: any) {
      setAccountMessage(error?.message || "Binance testnet sync failed.");
    } finally {
      setAccountBusy(false);
    }
  };

  useEffect(() => {
    if (view === "PORTFOLIO" || view === "AUTOMATION") {
      void loadHealth();
    }
    if (view !== "PORTFOLIO") return;

    void loadAccountOverview();
    const timer = setInterval(() => void loadAccountOverview(), 15_000);
    return () => clearInterval(timer);
  }, [view]);

  useEffect(() => {
    if (view !== "AUTOMATION") return;
    const timer = setInterval(() => void loadHealth(), 5_000);
    return () => clearInterval(timer);
  }, [view]);

  if (view === "MARKETS") {
    return <MarketsWorkspace onSelectAsset={onSelectAsset} onOpenRadar={onOpenRadar} />;
  }

  if (view === "PORTFOLIO") {
    const connections = accountOverview?.connections || [];
    const balances = accountOverview?.balances || [];
    const openOrders = accountOverview?.openOrders || [];
    const testnetConfigured = platformHealth?.binanceSpotTestnetAccount?.configured === true;

    return (
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 space-y-4">
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/80 overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-neutral-600">Account Control Plane</div>
              <h1 className="text-2xl font-semibold text-neutral-100 mt-1">Portfolio</h1>
              <p className="text-xs text-neutral-500 mt-1">
                Provider-owned balances and orders only. Jarvis does not invent cash, positions, or valuation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadAccountOverview()}
                disabled={accountBusy}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-200 disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                REFRESH
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/10 px-3 py-2 text-xs font-mono text-red-300"
              >
                <LogOut className="w-3.5 h-3.5" />
                SIGN OUT
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-neutral-800">
            <div className="bg-neutral-950 p-4">
              <Link2 className="w-4 h-4 text-neutral-500" />
              <div className="text-[10px] font-mono uppercase text-neutral-600 mt-3">Connected Accounts</div>
              <div className="text-xl font-mono text-neutral-100 mt-1">{connections.length}</div>
            </div>
            <div className="bg-neutral-950 p-4">
              <Wallet className="w-4 h-4 text-neutral-500" />
              <div className="text-[10px] font-mono uppercase text-neutral-600 mt-3">Wallet Assets</div>
              <div className="text-xl font-mono text-neutral-100 mt-1">{balances.length}</div>
            </div>
            <div className="bg-neutral-950 p-4">
              <Activity className="w-4 h-4 text-neutral-500" />
              <div className="text-[10px] font-mono uppercase text-neutral-600 mt-3">Provider Open Orders</div>
              <div className="text-xl font-mono text-neutral-100 mt-1">{openOrders.length}</div>
            </div>
            <div className="bg-neutral-950 p-4">
              <Database className="w-4 h-4 text-neutral-500" />
              <div className="text-[10px] font-mono uppercase text-neutral-600 mt-3">Database</div>
              <div className="text-xl font-mono text-neutral-100 mt-1">{platformHealth?.database?.state || "LOADING"}</div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-neutral-100">Provider connection</h2>
              </div>
              <p className="text-xs text-neutral-500 mt-2 max-w-3xl">
                Credentials stay on the server. The browser receives only the authenticated session and provider-sourced account state.
                The current Binance adapter is read-only and testnet-locked.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void syncBinanceTestnet()}
              disabled={!testnetConfigured || accountBusy}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-600/40 bg-amber-500/10 px-4 py-2.5 text-xs font-mono text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${accountBusy ? "animate-spin" : ""}`} />
              {accountBusy ? "SYNCING…" : "SYNC BINANCE TESTNET"}
            </button>
          </div>

          {!testnetConfigured && (
            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-[11px] font-mono text-neutral-500">
              SERVER CREDENTIALS NOT CONFIGURED • The account sync control is intentionally unavailable.
            </div>
          )}

          {accountMessage && (
            <div className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/10 px-3 py-2.5 text-xs text-amber-200">
              {accountMessage}
            </div>
          )}

          <div className="mt-4 space-y-2">
            {connections.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/60 px-4 py-5 text-center">
                <div className="text-xs font-mono uppercase text-neutral-500">No connected provider account</div>
                <div className="text-[11px] text-neutral-600 mt-1">
                  Run a server-side Binance Spot Testnet sync after configuring credentials. No local wallet is created.
                </div>
              </div>
            ) : connections.map((connection) => (
              <div key={connection.id} className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-neutral-100">{connection.label}</div>
                    <div className="text-[11px] font-mono text-neutral-600 mt-1">
                      {connection.provider} • {connection.externalAccountId || "provider account id unavailable"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-900/60 bg-emerald-950/20 px-2 py-1 text-emerald-300">
                      <CheckCircle2 className="w-3 h-3" />
                      {connection.status}
                    </span>
                    <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-400">
                      READ ONLY
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 text-[11px] font-mono">
                  <div><span className="text-neutral-600">Permissions</span><div className="text-neutral-300 mt-1">{connection.permissions.join(", ") || "—"}</div></div>
                  <div><span className="text-neutral-600">Last sync</span><div className="text-neutral-300 mt-1">{formatTimestamp(connection.lastSyncedAt)}</div></div>
                  <div><span className="text-neutral-600">Account type</span><div className="text-neutral-300 mt-1">{connection.accountType}</div></div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/80 overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-100">Wallet balances</h2>
            <p className="text-[11px] text-neutral-500 mt-1">
              Raw provider balances. Spot holdings are not automatically relabeled as leveraged “positions.”
            </p>
          </div>
          {balances.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs font-mono text-neutral-600">NO PROVIDER BALANCE SNAPSHOT</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-950/80 text-[10px] font-mono uppercase text-neutral-600">
                  <tr>
                    <th className="text-left px-5 py-3">Asset</th>
                    <th className="text-right px-5 py-3">Free</th>
                    <th className="text-right px-5 py-3">Locked</th>
                    <th className="text-right px-5 py-3">Total</th>
                    <th className="text-right px-5 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {balances.map((balance) => (
                    <tr key={balance.accountId + ":" + balance.asset} className="hover:bg-neutral-950/60">
                      <td className="px-5 py-3 font-mono font-semibold text-neutral-200">{balance.asset}</td>
                      <td className="px-5 py-3 text-right font-mono text-neutral-300">{formatDecimal(balance.free)}</td>
                      <td className="px-5 py-3 text-right font-mono text-neutral-500">{formatDecimal(balance.locked)}</td>
                      <td className="px-5 py-3 text-right font-mono text-neutral-100">{formatDecimal(balance.total)}</td>
                      <td className="px-5 py-3 text-right font-mono text-neutral-600">{formatTimestamp(balance.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/80 overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-100">Open orders</h2>
            <p className="text-[11px] text-neutral-500 mt-1">
              Reconciled provider orders only. Unknown or missing provider state is treated conservatively.
            </p>
          </div>
          {openOrders.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs font-mono text-neutral-600">NO OPEN PROVIDER ORDERS</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-950/80 text-[10px] font-mono uppercase text-neutral-600">
                  <tr>
                    <th className="text-left px-5 py-3">Instrument</th>
                    <th className="text-left px-5 py-3">Side / Type</th>
                    <th className="text-right px-5 py-3">Qty</th>
                    <th className="text-right px-5 py-3">Filled</th>
                    <th className="text-right px-5 py-3">Price</th>
                    <th className="text-right px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {openOrders.map((order) => (
                    <tr key={order.clientOrderId} className="hover:bg-neutral-950/60">
                      <td className="px-5 py-3 font-mono text-neutral-300">
                        <div>{order.instrumentId}</div>
                        <div className="text-[9px] text-neutral-700 mt-0.5">{order.externalOrderId || order.clientOrderId}</div>
                      </td>
                      <td className="px-5 py-3 font-mono">
                        <span className={order.side === "BUY" ? "text-emerald-300" : "text-red-300"}>{order.side}</span>
                        <span className="text-neutral-600"> / {order.type}</span>
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-neutral-300">{formatDecimal(order.quantity)}</td>
                      <td className="px-5 py-3 text-right font-mono text-neutral-400">{formatDecimal(order.filledQuantity)}</td>
                      <td className="px-5 py-3 text-right font-mono text-neutral-300">{order.limitPrice || order.stopPrice || "MARKET"}</td>
                      <td className="px-5 py-3 text-right font-mono text-neutral-500">{order.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-300">Execution boundary</div>
          <p className="text-xs text-amber-200/70 mt-2 leading-relaxed">
            The connected Binance adapter is read-only. It cannot submit or cancel an order.
            The next execution gate is an authenticated, idempotent sandbox order lifecycle with provider reconciliation before any real-money capability is considered.
          </p>
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
            <div className="flex justify-between mt-2"><span className="text-neutral-500">Last processed bar</span><span className="text-neutral-200">{formatTimestamp(runtime?.lastProcessedCandleAt)}</span></div>
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
        <p className="text-sm text-neutral-400 mt-2">
          Security, risk and provider connection controls will live here.
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          <button type="button" onClick={onOpenSettings} className="px-3 py-2 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-xs font-mono text-neutral-200">
            Open security & risk controls
          </button>
          <button type="button" onClick={onLogout} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-950/10 hover:bg-red-950/20 border border-red-900/60 text-xs font-mono text-red-300">
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
};
