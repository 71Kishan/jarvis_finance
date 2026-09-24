import React from "react";
import { Activity, ArrowUpRight, Bot, Link2, ShieldCheck, Wallet, Zap } from "lucide-react";
import type { Candle, LiveExchangeTicker } from "../types/trading";
import { MarketChart } from "./MarketChart";
import { OrderBookWidget } from "./OrderBookWidget";
import { InstrumentSearch } from "./InstrumentSearch";
import type { Instrument } from "../platform/types";

interface MainTerminalProps {
  asset: string;
  candles: Candle[];
  formingCandle?: Candle | null;
  ticker: LiveExchangeTicker | null;
  currentPrice: number | null;
  regime: "BULL_EXPANSION" | "BEAR_TREND" | "CHOPPY_RANGE" | "VOLATILITY_SPIKE";
  onSelectAsset: (asset: string) => void;
  onOpenPortfolio: () => void;
  onOpenAutomation: () => void;
  onOpenResearch: () => void;
}

const fmt = (value: number | null | undefined, digits = 2) =>
  Number.isFinite(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";

export const MainTerminal: React.FC<MainTerminalProps> = ({
  asset,
  candles,
  formingCandle,
  ticker,
  currentPrice,
  regime,
  onSelectAsset,
  onOpenPortfolio,
  onOpenAutomation,
  onOpenResearch,
}) => {
  const change = ticker?.change24hPercent;

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4 flex flex-col gap-4">
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-9 bg-neutral-900/80 border border-neutral-800 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                Live Market Terminal
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-neutral-100 mt-1">
                {asset}
              </h1>
              <div className="text-xs font-mono text-neutral-500 mt-1">
                {ticker?.source || "TRUSTED PROVIDER"} • {ticker ? "live quote" : "waiting for quote"}
              </div>
            </div>
            <InstrumentSearch
              value={asset}
              onSelect={(instrument: Instrument) => onSelectAsset(instrument.symbol)}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <div className="rounded-lg bg-neutral-950/80 border border-neutral-800 p-3">
              <div className="text-[10px] text-neutral-500">LAST</div>
              <div className="text-lg font-mono font-semibold text-neutral-100 mt-1">$ {fmt(ticker?.price ?? currentPrice, 2)}</div>
            </div>
            <div className="rounded-lg bg-neutral-950/80 border border-neutral-800 p-3">
              <div className="text-[10px] text-neutral-500">24H</div>
              <div className={"text-lg font-mono font-semibold mt-1 " + ((change ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                {change == null ? "—" : (change >= 0 ? "+" : "") + fmt(change, 2) + "%"}
              </div>
            </div>
            <div className="rounded-lg bg-neutral-950/80 border border-neutral-800 p-3">
              <div className="text-[10px] text-neutral-500">24H HIGH</div>
              <div className="text-lg font-mono font-semibold text-neutral-100 mt-1">$ {fmt(ticker?.high24h, 2)}</div>
            </div>
            <div className="rounded-lg bg-neutral-950/80 border border-neutral-800 p-3">
              <div className="text-[10px] text-neutral-500">24H LOW</div>
              <div className="text-lg font-mono font-semibold text-neutral-100 mt-1">$ {fmt(ticker?.low24h, 2)}</div>
            </div>
          </div>

          <MarketChart
            candles={candles}
            formingCandle={formingCandle}
            activeTrade={null}
            tradeHistory={[]}
            assetSymbol={asset}
            regime={regime}
          />
        </div>

        <div className="xl:col-span-3 flex flex-col gap-4">
          <OrderBookWidget
            currentPrice={ticker?.price ?? currentPrice}
            symbol={asset}
            bid={ticker?.bid}
            ask={ticker?.ask}
          />

          <div className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-4">
            <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">Account Layer</div>
            <div className="flex items-center gap-2 mt-2">
              <Link2 className="w-4 h-4 text-neutral-400" />
              <span className="text-sm text-neutral-200">No broker connected</span>
            </div>
            <p className="text-xs text-neutral-500 mt-2 leading-relaxed">
              Jarvis is ready for connected-account infrastructure. No balance is fabricated until a provider account is linked.
            </p>
            <button
              type="button"
              onClick={onOpenPortfolio}
              className="w-full mt-3 rounded-lg border border-neutral-700 bg-neutral-950 hover:bg-neutral-800 text-xs font-mono text-neutral-200 px-3 py-2 transition-colors"
            >
              Open Portfolio
            </button>
          </div>

          <div className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-4">
            <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">Jarvis Systems</div>
            <div className="space-y-2 mt-3">
              <button type="button" onClick={onOpenAutomation} className="w-full flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 p-2.5 text-left">
                <Bot className="w-4 h-4 text-violet-400" />
                <span className="text-xs text-neutral-200">Automation</span>
                <ArrowUpRight className="w-3.5 h-3.5 ml-auto text-neutral-600" />
              </button>
              <button type="button" onClick={onOpenResearch} className="w-full flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 p-2.5 text-left">
                <Zap className="w-4 h-4 text-indigo-400" />
                <span className="text-xs text-neutral-200">Research & Strategies</span>
                <ArrowUpRight className="w-3.5 h-3.5 ml-auto text-neutral-600" />
              </button>
              <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-500 pt-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Real-money execution is not enabled.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-neutral-900/70 border border-neutral-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
            <Wallet className="w-4 h-4 text-amber-400" />
            Portfolio
          </div>
          <div className="text-xl font-mono font-semibold text-neutral-100 mt-3">No connected accounts</div>
          <div className="text-xs text-neutral-500 mt-1">Connect a supported provider later to populate real balances and holdings.</div>
        </div>
        <div className="bg-neutral-900/70 border border-neutral-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
            <Bot className="w-4 h-4 text-violet-400" />
            Automation
          </div>
          <div className="text-sm text-neutral-300 mt-3">Server-owned runtime architecture is separated from the terminal UI.</div>
          <div className="text-xs text-neutral-500 mt-1">Practice automation lives in Practice Lab.</div>
        </div>
        <div className="bg-neutral-900/70 border border-neutral-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Data Integrity
          </div>
          <div className="text-sm text-neutral-300 mt-3">No synthetic price substitution on the live terminal.</div>
          <div className="text-xs text-neutral-500 mt-1">Provider outages fail closed.</div>
        </div>
      </section>
    </main>
  );
};
