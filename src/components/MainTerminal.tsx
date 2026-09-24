import React, { useEffect, useState } from "react";
import { Activity, ArrowUpRight, Bot, Clock3, Link2, RefreshCw, ShieldCheck, Wallet, Zap } from "lucide-react";
import type { Candle, LiveExchangeTicker } from "../types/trading";
import { MarketChart, type ChartTimeframe } from "./MarketChart";
import { OrderBookWidget } from "./OrderBookWidget";
import { InstrumentSearch } from "./InstrumentSearch";
import type { Instrument } from "../platform/types";

interface MainTerminalProps {
  asset: string;
  candles: Candle[];
  formingCandle?: Candle | null;
  ticker: LiveExchangeTicker | null;
  currentPrice: number | null;
  regime?: "BULL_EXPANSION" | "BEAR_TREND" | "CHOPPY_RANGE" | "VOLATILITY_SPIKE" | null;
  onSelectAsset: (asset: string) => void;
  onOpenPortfolio: () => void;
  onOpenAutomation: () => void;
  onOpenResearch: () => void;
}

type ChartLoadState = "LIVE" | "REFRESHING" | "STALE" | "UNAVAILABLE";

const fmt = (value: number | null | undefined, digits = 2) =>
  Number.isFinite(value)
    ? Number(value).toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: 0,
      })
    : "—";

const fmtPrice = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(Number(value));
  const digits = absolute >= 1 ? 2 : absolute >= 0.01 ? 4 : absolute >= 0.0001 ? 6 : 8;
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
};

const ageLabel = (timestamp?: number) => {
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 1000));
  return seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m";
};

export const MainTerminal: React.FC<MainTerminalProps> = ({
  asset,
  candles,
  formingCandle = null,
  ticker,
  currentPrice,
  regime,
  onSelectAsset,
  onOpenPortfolio,
  onOpenAutomation,
  onOpenResearch,
}) => {
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>("1m");
  const [chartCandles, setChartCandles] = useState<Candle[]>(candles);
  const [chartFormingCandle, setChartFormingCandle] = useState<Candle | null>(formingCandle);
  const [chartStatus, setChartStatus] = useState<ChartLoadState>("LIVE");
  const [chartRefreshAt, setChartRefreshAt] = useState<number | null>(null);

  useEffect(() => {
    if (chartTimeframe !== "1m") return;
    setChartCandles(candles);
    setChartFormingCandle(formingCandle);
    setChartStatus(candles.length > 0 ? "LIVE" : "UNAVAILABLE");
    setChartRefreshAt(Date.now());
  }, [chartTimeframe, candles, formingCandle]);

  useEffect(() => {
    if (chartTimeframe === "1m") return;

    let active = true;
    let loadedOnce = false;

    const loadChart = async () => {
      if (!loadedOnce) setChartStatus("REFRESHING");

      try {
        const params = new URLSearchParams({
          symbol: asset,
          interval: chartTimeframe,
          limit: "300",
        });
        const response = await fetch("/api/market/chart-candles?" + params.toString(), { cache: "no-store" });
        if (!response.ok) throw new Error("Chart feed HTTP " + response.status);

        const payload = await response.json();
        if (!active) return;

        if (!Array.isArray(payload?.candles) || payload.candles.length === 0) {
          throw new Error("Provider returned no completed chart bars.");
        }

        setChartCandles(payload.candles);
        setChartFormingCandle(payload.formingCandle || null);
        setChartRefreshAt(Date.now());
        setChartStatus("LIVE");
        loadedOnce = true;
      } catch (error) {
        if (!active) return;
        console.warn("Chart timeframe unavailable:", error);
        setChartStatus(loadedOnce ? "STALE" : "UNAVAILABLE");
      }
    };

    void loadChart();
    const timer = setInterval(loadChart, 10_000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [asset, chartTimeframe]);

  const change = ticker?.change24hPercent;
  const quoteAge = ageLabel(ticker?.lastUpdated);
  const chartAge = chartRefreshAt ? ageLabel(chartRefreshAt) : "—";

  return (
    <main className="flex-1 w-full max-w-[1600px] mx-auto p-3 sm:p-4 flex flex-col gap-3">
      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_310px] gap-3">
        <div className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden">
          <div className="border-b border-neutral-800/80 px-4 py-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[9px] font-mono uppercase tracking-wider text-neutral-600">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  Spot market terminal
                  <span className="text-neutral-800">•</span>
                  <span>Binance Spot</span>
                </div>
                <div className="flex items-baseline gap-3 mt-1">
                  <h1 className="text-xl sm:text-2xl font-mono font-semibold text-neutral-100">{asset}</h1>
                  <span className="text-[10px] font-mono text-neutral-600">
                    {ticker ? "QUOTE " + quoteAge + " OLD" : "WAITING FOR QUOTE"}
                  </span>
                </div>
              </div>

              <InstrumentSearch
                value={asset}
                onSelect={(instrument: Instrument) => onSelectAsset(instrument.symbol)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 border-b border-neutral-800">
            {[
              ["LAST", fmtPrice(ticker?.price ?? currentPrice), "neutral"],
              ["24H", change == null ? "—" : (change >= 0 ? "+" : "") + fmt(change, 2) + "%", change == null ? "neutral" : change >= 0 ? "up" : "down"],
              ["HIGH", fmtPrice(ticker?.high24h), "neutral"],
              ["LOW", fmtPrice(ticker?.low24h), "neutral"],
              ["VOLUME", ticker?.volume24h == null ? "—" : Number(ticker.volume24h).toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 }), "neutral"],
            ].map(([label, value, tone]) => (
              <div key={label} className="px-3 py-2.5 border-r border-neutral-900 last:border-r-0">
                <div className="text-[8px] font-mono text-neutral-600">{label}</div>
                <div
                  className={
                    "text-sm sm:text-base font-mono font-semibold mt-1 " +
                    (tone === "up" ? "text-emerald-400" : tone === "down" ? "text-rose-400" : "text-neutral-100")
                  }
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          <MarketChart
            candles={chartCandles}
            formingCandle={chartFormingCandle}
            activeTrade={null}
            tradeHistory={[]}
            assetSymbol={asset}
            regime={regime}
            timeframe={chartTimeframe}
            onTimeframeChange={setChartTimeframe}
            chartStatus={chartStatus}
          />

          <div className="grid grid-cols-2 md:grid-cols-4 border-t border-neutral-800 bg-neutral-950">
            <div className="px-3 py-2 border-r border-neutral-900">
              <div className="text-[8px] font-mono text-neutral-600">MARKET</div>
              <div className="text-[10px] font-mono text-neutral-300 mt-1">BINANCE SPOT</div>
            </div>
            <div className="px-3 py-2 border-r border-neutral-900">
              <div className="text-[8px] font-mono text-neutral-600">QUOTE AGE</div>
              <div className="text-[10px] font-mono text-neutral-300 mt-1">{quoteAge}</div>
            </div>
            <div className="px-3 py-2 border-r border-neutral-900">
              <div className="text-[8px] font-mono text-neutral-600">CHART REFRESH</div>
              <div className="text-[10px] font-mono text-neutral-300 mt-1">{chartAge}</div>
            </div>
            <div className="px-3 py-2">
              <div className="text-[8px] font-mono text-neutral-600">STRATEGY DATA</div>
              <div className="text-[10px] font-mono text-neutral-300 mt-1">1m closed bars</div>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-3">
          <OrderBookWidget
            currentPrice={ticker?.price ?? currentPrice}
            symbol={asset}
            bid={ticker?.bid}
            ask={ticker?.ask}
          />

          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-mono text-neutral-600 uppercase tracking-wider">Account layer</div>
              <Clock3 className="w-3.5 h-3.5 text-neutral-700" />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Link2 className="w-4 h-4 text-neutral-400" />
              <span className="text-sm text-neutral-200">No broker connected</span>
            </div>
            <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
              No cash, position, or buying power is synthesized. This panel will bind to the authenticated account layer.
            </p>
            <button
              type="button"
              onClick={onOpenPortfolio}
              className="w-full mt-3 rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-xs font-mono text-neutral-200 px-3 py-2 transition-colors"
            >
              Open Portfolio
            </button>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-[9px] font-mono text-neutral-600 uppercase tracking-wider">Systems</div>
            <div className="space-y-2 mt-3">
              <button type="button" onClick={onOpenAutomation} className="w-full flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 p-2.5 text-left">
                <Bot className="w-4 h-4 text-violet-400" />
                <span className="text-xs text-neutral-200">Automation</span>
                <ArrowUpRight className="w-3.5 h-3.5 ml-auto text-neutral-600" />
              </button>
              <button type="button" onClick={onOpenResearch} className="w-full flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 p-2.5 text-left">
                <Zap className="w-4 h-4 text-indigo-400" />
                <span className="text-xs text-neutral-200">Research & Strategies</span>
                <ArrowUpRight className="w-3.5 h-3.5 ml-auto text-neutral-600" />
              </button>
              <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-500 pt-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Execution remains disabled.
              </div>
            </div>
          </div>
        </aside>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
            <Wallet className="w-4 h-4 text-amber-400" />
            Portfolio
          </div>
          <div className="text-lg font-mono font-semibold text-neutral-100 mt-3">Awaiting account connection</div>
          <div className="text-[11px] text-neutral-500 mt-1">Balances and holdings will come from a provider adapter and reconciled ledger.</div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
            <RefreshCw className="w-4 h-4 text-sky-400" />
            Market data
          </div>
          <div className="text-lg font-mono font-semibold text-neutral-100 mt-3">{chartTimeframe.toUpperCase()} chart</div>
          <div className="text-[11px] text-neutral-500 mt-1">Chart timeframe changes never alter the strategy or execution timeframe.</div>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Integrity
          </div>
          <div className="text-lg font-mono font-semibold text-neutral-100 mt-3">Fail-closed</div>
          <div className="text-[11px] text-neutral-500 mt-1">Provider failure does not create synthetic market prices or simulated account state in the terminal.</div>
        </div>
      </section>
    </main>
  );
};
