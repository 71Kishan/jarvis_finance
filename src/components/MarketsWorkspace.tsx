import React, { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, ChevronDown, RefreshCw, Search, Star } from "lucide-react";
import type { Instrument } from "../platform/types";

interface MarketQuote {
  price: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  updatedAt: number;
}

type MarketInstrument = Instrument & { quote?: MarketQuote };
type SortKey = "symbol" | "price" | "change" | "volume";

interface MarketsWorkspaceProps {
  onSelectAsset: (asset: string) => void;
  onOpenRadar: () => void;
}

const FAVORITES_KEY = "jarvis-market-favorites-v1";

function formatPrice(value: number | undefined) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value as number) < 1) return (value as number).toLocaleString(undefined, { maximumFractionDigits: 6 });
  if (Math.abs(value as number) < 100) return (value as number).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return (value as number).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatVolume(value: number | undefined) {
  if (!Number.isFinite(value)) return "—";
  if ((value as number) >= 1_000_000_000) return "$" + ((value as number) / 1_000_000_000).toFixed(2) + "B";
  if ((value as number) >= 1_000_000) return "$" + ((value as number) / 1_000_000).toFixed(2) + "M";
  if ((value as number) >= 1_000) return "$" + ((value as number) / 1_000).toFixed(1) + "K";
  return "$" + (value as number).toFixed(0);
}

function loadFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export const MarketsWorkspace: React.FC<MarketsWorkspaceProps> = ({ onSelectAsset, onOpenRadar }) => {
  const [query, setQuery] = useState("");
  const [quoteAsset, setQuoteAsset] = useState<"ALL" | "USDT" | "USDC" | "BNB">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [showFavorites, setShowFavorites] = useState(false);
  const [viewMode, setViewMode] = useState<"TABLE" | "CARDS">("TABLE");
  const [instruments, setInstruments] = useState<MarketInstrument[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [catalogState, setCatalogState] = useState("LOADING");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const toggleFavorite = (symbol: string) => {
    setFavorites((current) => {
      const next = current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol];
      try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const loadMarkets = async (manual = false) => {
    if (manual) setRefreshing(true); else setLoading(true);
    try {
      const params = new URLSearchParams({ tradableOnly: "true", limit: "150" });
      if (quoteAsset !== "ALL") params.set("quoteAsset", quoteAsset);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch("/api/market/catalog?" + params.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      const next = Array.isArray(payload?.instruments) ? payload.instruments : [];
      setInstruments(next);
      setCatalogState(payload?.health?.state || "READY");
      setLastUpdated(Date.now());
      if (!next.some((item: MarketInstrument) => item.providerSymbol === selectedSymbol) && next[0]) setSelectedSymbol(next[0].providerSymbol);
    } catch {
      setInstruments([]);
      setCatalogState("UNAVAILABLE");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void loadMarkets(), query ? 180 : 0);
    return () => clearTimeout(timer);
  }, [query, quoteAsset]);

  useEffect(() => {
    const timer = setInterval(() => void loadMarkets(true), 5_000);
    return () => clearInterval(timer);
  }, [query, quoteAsset]);

  const visible = useMemo(() => {
    const rows = instruments.filter((instrument) => showFavorites ? favorites.includes(instrument.providerSymbol) : true);
    return [...rows].sort((a, b) => {
      let result = 0;
      if (sortKey === "symbol") result = a.displaySymbol.localeCompare(b.displaySymbol);
      else if (sortKey === "price") result = (a.quote?.price ?? -Infinity) - (b.quote?.price ?? -Infinity);
      else if (sortKey === "change") result = (a.quote?.change24hPercent ?? -Infinity) - (b.quote?.change24hPercent ?? -Infinity);
      else result = (a.quote?.volume24h ?? -Infinity) - (b.quote?.volume24h ?? -Infinity);
      return sortDirection === "asc" ? result : -result;
    });
  }, [instruments, favorites, showFavorites, sortKey, sortDirection]);

  const quotedCount = instruments.filter((item) => Boolean(item.quote)).length;
  const selected = instruments.find((item) => item.providerSymbol === selectedSymbol) || visible[0] || null;
  const quoteRows = instruments.filter((item) => item.quote);
  const gainers = [...quoteRows].sort((a, b) => (b.quote?.change24hPercent ?? -Infinity) - (a.quote?.change24hPercent ?? -Infinity)).slice(0, 3);
  const losers = [...quoteRows].sort((a, b) => (a.quote?.change24hPercent ?? Infinity) - (b.quote?.change24hPercent ?? Infinity)).slice(0, 3);
  const volumeLeaders = [...quoteRows].sort((a, b) => (b.quote?.volume24h ?? -Infinity) - (a.quote?.volume24h ?? -Infinity)).slice(0, 3);

  const selectMarket = (instrument: MarketInstrument) => {
    setSelectedSymbol(instrument.providerSymbol);
    onSelectAsset(instrument.symbol);
  };

  const changeSort = () => {
    if (sortKey === "change") setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey("change"); setSortDirection("desc"); }
  };

  const volumeSort = () => {
    if (sortKey === "volume") setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey("volume"); setSortDirection("desc"); }
  };

  const renderMoverStrip = (label: string, rows: MarketInstrument[]) => (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2.5">
      <div className="text-[9px] font-mono text-neutral-600">{label}</div>
      <div className="flex items-center gap-5 mt-2 overflow-x-auto">
        {rows.map((row) => {
          const change = row.quote?.change24hPercent;
          return (
            <button key={row.instrumentId} type="button" onClick={() => selectMarket(row)} className="min-w-[130px] text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-semibold text-neutral-200">{row.displaySymbol}</span>
                <span className={"text-[10px] font-mono " + ((change ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {change == null ? "—" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%"}
                </span>
              </div>
              <div className="text-[10px] font-mono text-neutral-500 mt-0.5">{"$" + formatPrice(row.quote?.price)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <main className="flex-1 min-h-0 w-full bg-[#0a0a0a]">
      <div className="border-b border-neutral-800 bg-neutral-950/95 sticky top-0 z-20">
        <div className="max-w-[1500px] mx-auto px-4 py-3">
          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <div className="min-w-[230px]">
              <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-400" /><span className="text-sm font-semibold text-neutral-100">Markets</span><span className="text-[9px] font-mono text-neutral-600 border border-neutral-800 rounded px-1.5 py-0.5">BINANCE SPOT</span></div>
              <div className="text-[10px] font-mono text-neutral-600 mt-1">{quotedCount}/{instruments.length} quoted · {catalogState} · {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "—"}</div>
            </div>
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-600" />
              <input aria-label="Search markets" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search symbol or market" className="w-full h-10 bg-neutral-900 border border-neutral-800 rounded-lg pl-10 pr-3 text-xs font-mono text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600" />
            </div>
            <div className="flex items-center gap-1 bg-neutral-900/70 border border-neutral-800 rounded-lg p-1">
              {(["ALL", "USDT", "USDC", "BNB"] as const).map((tab) => <button key={tab} type="button" onClick={() => setQuoteAsset(tab)} className={"px-3 py-1.5 rounded-md text-[10px] font-mono " + (quoteAsset === tab ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-neutral-200")}>{tab}</button>)}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setShowFavorites((current) => !current)} className={"h-9 px-3 rounded-lg border text-[10px] font-mono flex items-center gap-1.5 " + (showFavorites ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-200")}><Star className="w-3.5 h-3.5" />Favorites</button>
              <button type="button" onClick={() => void loadMarkets(true)} className="h-9 w-9 rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-100 flex items-center justify-center" title="Refresh markets"><RefreshCw className={"w-3.5 h-3.5 " + (refreshing ? "animate-spin" : "")} /></button>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 text-[10px] font-mono">
            <div className="flex items-center gap-2 text-neutral-500"><button type="button" onClick={() => setViewMode("TABLE")} className={viewMode === "TABLE" ? "text-neutral-100" : "hover:text-neutral-300"}>TABLE</button><span className="text-neutral-800">/</span><button type="button" onClick={() => setViewMode("CARDS")} className={viewMode === "CARDS" ? "text-neutral-100" : "hover:text-neutral-300"}>CARDS</button><span className="text-neutral-700 ml-2">· Auto refresh 5s</span></div>
            <button type="button" onClick={onOpenRadar} className="text-indigo-300 hover:text-indigo-200 flex items-center gap-1">Research radar <ArrowUpRight className="w-3 h-3" /></button>
          </div>
        </div>
      </div>

      <div className="max-w-[1500px] mx-auto p-4 space-y-3">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-2">{renderMoverStrip("TOP GAINERS", gainers)}{renderMoverStrip("TOP LOSERS", losers)}{renderMoverStrip("HIGH VOLUME", volumeLeaders)}</section>

        <section className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_300px] gap-3">
          <aside className="rounded-lg border border-neutral-800 bg-neutral-950 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-neutral-800"><div className="text-[9px] font-mono text-neutral-600">WATCHLIST</div><div className="text-xs text-neutral-200 mt-0.5">{favorites.length} saved</div></div>
            <div className="divide-y divide-neutral-900 max-h-[620px] overflow-auto">
              {instruments.filter((item) => favorites.includes(item.providerSymbol)).slice(0, 50).map((item) => <button key={item.instrumentId} type="button" onClick={() => selectMarket(item)} className={"w-full px-3 py-2.5 text-left hover:bg-neutral-900 " + (selectedSymbol === item.providerSymbol ? "bg-neutral-900/90" : "")}><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-mono text-neutral-100">{item.displaySymbol}</span><span className="text-[10px] font-mono text-neutral-500">{formatPrice(item.quote?.price)}</span></div><div className="flex justify-between mt-0.5"><span className="text-[9px] text-neutral-600">{item.quoteAsset || "—"}</span><span className={"text-[9px] font-mono " + ((item.quote?.change24hPercent ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500")}>{(item.quote?.change24hPercent ?? 0) >= 0 ? "+" : ""}{(item.quote?.change24hPercent ?? 0).toFixed(2)}%</span></div></button>)}
              {favorites.length === 0 && <div className="px-3 py-10 text-center text-[10px] font-mono text-neutral-600 leading-relaxed">Star a market to build your watchlist.</div>}
            </div>
          </aside>

          <section className="rounded-lg border border-neutral-800 bg-neutral-950 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-neutral-800 flex items-center justify-between"><div><div className="text-[9px] font-mono text-neutral-600">MARKET SCANNER</div><div className="text-xs text-neutral-200 mt-0.5">{visible.length} instruments</div></div><span className="text-[9px] font-mono text-neutral-700">LIVE QUOTES</span></div>
            {viewMode === "TABLE" ? <div className="overflow-auto max-h-[680px]">
              <table className="w-full min-w-[760px] text-xs"><thead className="bg-neutral-900/80 sticky top-0 z-10"><tr className="text-[9px] uppercase font-mono text-neutral-600"><th className="text-left px-3 py-2 font-medium">Symbol</th><th className="text-right px-3 py-2 font-medium">Price</th><th className="text-right px-3 py-2 font-medium"><button type="button" onClick={changeSort} className="inline-flex items-center gap-1">24h % <ChevronDown className="w-3 h-3" /></button></th><th className="text-right px-3 py-2 font-medium"><button type="button" onClick={volumeSort} className="inline-flex items-center gap-1">24h Volume <ChevronDown className="w-3 h-3" /></button></th><th className="text-right px-3 py-2 font-medium">High</th><th className="text-right px-3 py-2 font-medium">Low</th><th className="w-10"></th></tr></thead>
              <tbody className="divide-y divide-neutral-900">{visible.map((item) => { const change = item.quote?.change24hPercent; return <tr key={item.instrumentId} onClick={() => setSelectedSymbol(item.providerSymbol)} className={"cursor-pointer " + (selectedSymbol === item.providerSymbol ? "bg-neutral-900" : "hover:bg-neutral-900/60")}><td className="px-3 py-2.5"><div className="flex items-center gap-2"><button type="button" onClick={(event) => { event.stopPropagation(); toggleFavorite(item.providerSymbol); }} className="text-neutral-700 hover:text-amber-300"><Star className={"w-3.5 h-3.5 " + (favorites.includes(item.providerSymbol) ? "fill-amber-300 text-amber-300" : "")} /></button><div><div className="font-mono font-semibold text-neutral-100">{item.displaySymbol}</div><div className="text-[9px] font-mono text-neutral-600">{item.name}</div></div></div></td><td className="px-3 py-2.5 text-right font-mono text-neutral-200">{formatPrice(item.quote?.price)}</td><td className={"px-3 py-2.5 text-right font-mono font-semibold " + (change == null ? "text-neutral-700" : change >= 0 ? "text-emerald-400" : "text-rose-400")}>{change == null ? "—" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%"}</td><td className="px-3 py-2.5 text-right font-mono text-neutral-400">{formatVolume(item.quote?.volume24h)}</td><td className="px-3 py-2.5 text-right font-mono text-neutral-500">{formatPrice(item.quote?.high24h)}</td><td className="px-3 py-2.5 text-right font-mono text-neutral-500">{formatPrice(item.quote?.low24h)}</td><td className="px-2 py-2.5"><button type="button" onClick={(event) => { event.stopPropagation(); selectMarket(item); }} className="p-1.5 rounded text-neutral-600 hover:text-neutral-200 hover:bg-neutral-800" title="Open chart"><ArrowUpRight className="w-3.5 h-3.5" /></button></td></tr>; })}</tbody></table>
              {loading && <div className="p-8 text-center text-[10px] font-mono text-neutral-600">Loading live market universe…</div>}{!loading && visible.length === 0 && <div className="p-10 text-center text-[10px] font-mono text-neutral-600">No instruments match the current filters.</div>}
            </div> : <div className="grid grid-cols-2 xl:grid-cols-3 gap-px bg-neutral-900 p-px max-h-[680px] overflow-auto">{visible.map((item) => { const change = item.quote?.change24hPercent; return <button key={item.instrumentId} type="button" onClick={() => selectMarket(item)} className="bg-neutral-950 hover:bg-neutral-900 text-left p-3"><div className="flex items-center justify-between"><span className="font-mono text-xs font-semibold text-neutral-100">{item.displaySymbol}</span><Star className={"w-3.5 h-3.5 " + (favorites.includes(item.providerSymbol) ? "fill-amber-300 text-amber-300" : "text-neutral-700")} /></div><div className="text-base font-mono text-neutral-100 mt-3">{formatPrice(item.quote?.price)}</div><div className={"text-[10px] font-mono mt-1 " + ((change ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>{change == null ? "—" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%"}</div><div className="flex justify-between text-[9px] font-mono text-neutral-600 mt-3"><span>{formatVolume(item.quote?.volume24h)}</span><span>{item.quoteAsset || "—"}</span></div></button>; })}</div>}
          </section>

          <aside className="rounded-lg border border-neutral-800 bg-neutral-950 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-neutral-800 flex items-center justify-between"><div><div className="text-[9px] font-mono text-neutral-600">SELECTED MARKET</div><div className="text-sm font-semibold text-neutral-100 mt-0.5">{selected?.displaySymbol || "—"}</div></div>{selected && <button type="button" onClick={() => toggleFavorite(selected.providerSymbol)} className="text-neutral-600 hover:text-amber-300"><Star className={"w-4 h-4 " + (favorites.includes(selected.providerSymbol) ? "fill-amber-300 text-amber-300" : "")} /></button>}</div>
            {selected ? <div className="p-3"><div className="text-2xl font-mono font-semibold text-neutral-100">{formatPrice(selected.quote?.price)}</div><div className={"text-xs font-mono mt-1 " + ((selected.quote?.change24hPercent ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>{selected.quote?.change24hPercent == null ? "Quote unavailable" : ((selected.quote.change24hPercent >= 0 ? "+" : "") + selected.quote.change24hPercent.toFixed(2) + "% 24h")}</div>
              <div className="grid grid-cols-2 gap-px bg-neutral-900 rounded-lg overflow-hidden mt-4">{[["24H HIGH", formatPrice(selected.quote?.high24h)],["24H LOW", formatPrice(selected.quote?.low24h)],["24H VOLUME", formatVolume(selected.quote?.volume24h)],["QUOTE", selected.quoteAsset || "—"],["TICK SIZE", selected.tickSize || "—"],["MIN NOTIONAL", selected.minNotional || "—"]].map(([label, value]) => <div key={label} className="bg-neutral-950 p-2.5"><div className="text-[8px] font-mono text-neutral-600">{label}</div><div className="text-[10px] font-mono text-neutral-300 mt-1 truncate">{value}</div></div>)}</div>
              <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3"><div className="text-[9px] font-mono uppercase text-neutral-600">MARKET DATA</div><div className="flex justify-between mt-2 text-[10px] font-mono"><span className="text-neutral-500">Provider</span><span className="text-neutral-200">{selected.provider}</span></div><div className="flex justify-between mt-1.5 text-[10px] font-mono"><span className="text-neutral-500">Status</span><span className="text-emerald-400">{selected.tradable ? "TRADABLE" : "NOT TRADABLE"}</span></div><div className="flex justify-between mt-1.5 text-[10px] font-mono"><span className="text-neutral-500">Updated</span><span className="text-neutral-300">{selected.quote?.updatedAt ? new Date(selected.quote.updatedAt).toLocaleTimeString() : "—"}</span></div></div>
              <button type="button" onClick={() => selectMarket(selected)} className="w-full mt-4 rounded-lg bg-neutral-100 hover:bg-white text-neutral-950 py-2.5 text-[10px] font-mono font-semibold flex items-center justify-center gap-1.5">Open full chart <ArrowUpRight className="w-3.5 h-3.5" /></button>
            </div> : <div className="p-8 text-center text-[10px] font-mono text-neutral-600">Select a market to inspect live metadata.</div>}
          </aside>
        </section>
      </div>
    </main>
  );
}
