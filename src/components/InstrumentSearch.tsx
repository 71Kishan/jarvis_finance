import React, { useEffect, useRef, useState } from "react";
import type { Instrument } from "../platform/types";
import { Search, Loader2 } from "lucide-react";

interface InstrumentSearchProps {
  value: string;
  onSelect: (instrument: Instrument) => void;
  disabled?: boolean;
}

export const InstrumentSearch: React.FC<InstrumentSearchProps> = ({ value, onSelect, disabled }) => {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<Instrument[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;

    const requestId = ++requestRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const url = "/api/market/catalog?q=" + encodeURIComponent(query.trim()) + "&tradableOnly=true&limit=30";
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("catalog " + response.status);
        const payload = await response.json();
        if (requestId === requestRef.current && Array.isArray(payload?.instruments)) {
          setResults(payload.instruments);
        }
      } catch {
        if (requestId === requestRef.current) setResults([]);
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }, query.trim() ? 180 : 0);

    return () => clearTimeout(timer);
  }, [query, open]);

  return (
    <div className="relative w-full sm:w-[270px]">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500 pointer-events-none" />
        <input
          aria-label="Search tradable instruments"
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && results[0]) {
              onSelect(results[0]);
              setOpen(false);
            }
          }}
          placeholder="Search coins / pairs"
          className="w-full bg-neutral-900 border border-neutral-700/80 hover:border-neutral-600 rounded-lg pl-8 pr-8 py-1.5 text-xs font-mono font-semibold text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
        />
        {loading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-neutral-500" />}
      </div>

      {open && !disabled && (
        <button
          aria-label="Close instrument search"
          className="fixed inset-0 z-40 cursor-default"
          onClick={() => setOpen(false)}
        />
      )}

      {open && !disabled && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl">
          {results.length === 0 && !loading ? (
            <div className="px-3 py-4 text-xs font-mono text-neutral-500">
              No tradable Binance Spot instruments found.
            </div>
          ) : (
            results.map((instrument) => (
              <button
                key={instrument.instrumentId}
                type="button"
                onClick={() => {
                  onSelect(instrument);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2.5 border-b border-neutral-900 last:border-b-0 hover:bg-neutral-900 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-mono font-semibold text-neutral-100 truncate">
                    {instrument.displaySymbol}
                  </span>
                  <span className="text-[10px] font-mono text-neutral-600">BINANCE SPOT</span>
                </div>
                <div className="flex items-center justify-between gap-3 mt-0.5">
                  <span className="text-[11px] text-neutral-500 truncate">{instrument.name}</span>
                  {instrument.quoteAsset && (
                    <span className="text-[10px] font-mono text-neutral-600">{instrument.quoteAsset}</span>
                  )}
                </div>
                {instrument.quote && (
                  <div className="mt-1 text-[10px] font-mono text-neutral-400">
                    {instrument.quote.price} · {instrument.quote.change24hPercent >= 0 ? "+" : ""}
                    {instrument.quote.change24hPercent.toFixed(2)}%
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
