import React, { useEffect, useState } from "react";
import { MultiAssetOpportunity, AssetCategory } from "../types/trading";
import { AssetSymbol } from "../engine/marketSimulator";
import {
  Radar,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  ShieldCheck,
  Zap,
  Filter,
  RefreshCw,
  X,
  Compass,
} from "lucide-react";

interface MultiAssetRadarModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAsset: AssetSymbol;
  onSelectAndTradeAsset: (symbol: AssetSymbol, executeTrade?: boolean) => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  minConfidence: number;
}

export const MultiAssetRadarModal: React.FC<MultiAssetRadarModalProps> = ({
  isOpen,
  onClose,
  currentAsset,
  onSelectAndTradeAsset,
  autoRotate,
  onToggleAutoRotate,
  minConfidence,
}) => {
  const [opportunities, setOpportunities] = useState<MultiAssetOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | AssetCategory>("ALL");
  const [lastScanTime, setLastScanTime] = useState<number>(Date.now());

  const fetchRadarData = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/market/multi-scan?minConfidence=${minConfidence}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.opportunities)) {
          setOpportunities(data.opportunities);
          setLastScanTime(Date.now());
        }
      }
    } catch (err) {
      console.warn("Failed to fetch multi-scan radar:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRadarData();
    }
  }, [isOpen, minConfidence]);

  if (!isOpen) return null;

  const filteredList = opportunities.filter((op) => {
    if (categoryFilter === "ALL") return true;
    return op.category === categoryFilter;
  });

  const topOpportunity = opportunities[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        id="multi-asset-radar-modal"
        className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Radar className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-neutral-100">
                  Multi-Market Research Radar
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-indigo-950 text-indigo-300 border border-indigo-800">
                  Global Universe
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Scans supported assets using connected market data. Radar results are research candidates, not trade approvals.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="refresh-radar-btn"
              type="button"
              onClick={fetchRadarData}
              disabled={isLoading}
              className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition-colors"
              title="Refresh radar scan"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <button
              id="close-radar-btn"
              type="button"
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Top Feature Banner: Research Universe Rotation */}
        <div className="bg-gradient-to-r from-neutral-950 via-indigo-950/40 to-neutral-950 p-4 border-b border-neutral-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-neutral-200">
                  Cross-Asset Research Scanner
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${
                    autoRotate
                      ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                      : "bg-neutral-800 text-neutral-400"
                  }`}
                >
                  {autoRotate ? "RESEARCH MODE" : "MANUAL"}
                </span>
              </div>
              <div className="text-[11px] text-neutral-400">
                Scores below {minConfidence}% are shown for review only. The radar only changes the research focus; it never moves capital or approves a trade automatically.
              </div>
            </div>
          </div>

          <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-neutral-800 text-neutral-300 border border-neutral-700">Research Asset Selection</span>
        </div>

        {/* Top Opportunity Highlight */}
        {topOpportunity && (
          <div className="mx-4 mt-4 p-3 bg-indigo-950/30 border border-indigo-500/40 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="px-2 py-1 bg-indigo-600 text-white font-bold text-xs rounded-lg uppercase">
                #1 Top Setup
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white font-mono">
                    {topOpportunity.symbol} ({topOpportunity.name})
                  </span>
                  <span
                    className={`text-xs font-mono font-semibold ${
                      topOpportunity.change24hPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {topOpportunity.change24hPercent >= 0 ? "+" : ""}
                    {topOpportunity.change24hPercent}%
                  </span>
                  <span className="px-1.5 py-0.2 bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-mono rounded">
                    Score: {topOpportunity.score}%
                  </span>
                </div>
                <div className="text-[11px] text-neutral-300 mt-0.5">
                  {topOpportunity.rationale}
                </div>
              </div>
            </div>

            <button
              id="switch-to-top-opportunity-btn"
              type="button"
              onClick={() => {
                onSelectAndTradeAsset(topOpportunity.symbol as AssetSymbol, false);
                onClose();
              }}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-md"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Switch & Review Signal</span>
            </button>
          </div>
        )}

        {/* Category Filters */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-1.5">
            {(["ALL", "CRYPTO", "STOCK", "INDEX", "FOREX"] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  categoryFilter === cat
                    ? "bg-neutral-800 text-white border border-neutral-700"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="text-[11px] text-neutral-500 font-mono">
            {filteredList.length} assets scanned &bull; Last updated {new Date(lastScanTime).toLocaleTimeString()}
          </div>
        </div>

        {/* Opportunity List Table */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="divide-y divide-neutral-800/80 border border-neutral-800 rounded-xl overflow-hidden bg-neutral-950/50">
            {filteredList.map((op) => {
              const isCurrent = op.symbol === currentAsset;
              return (
                <div
                  key={op.symbol}
                  className={`p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors ${
                    isCurrent ? "bg-indigo-950/20" : "hover:bg-neutral-900/60"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-neutral-900 flex items-center justify-center font-bold text-xs font-mono text-neutral-300 border border-neutral-800">
                      {op.category === "CRYPTO" ? "₿" : op.category === "STOCK" ? "📈" : op.category === "FOREX" ? "💱" : "📊"}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-neutral-100 font-mono">
                          {op.symbol}
                        </span>
                        <span className="text-xs text-neutral-400">
                          {op.name}
                        </span>
                        {isCurrent && (
                          <span className="px-1.5 py-0.2 bg-indigo-950 text-indigo-300 text-[10px] font-mono rounded border border-indigo-800">
                            CURRENT
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-neutral-400 font-mono mt-0.5">
                        <span>${op.price.toLocaleString()}</span>
                        <span
                          className={op.change24hPercent >= 0 ? "text-emerald-400" : "text-rose-400"}
                        >
                          {op.change24hPercent >= 0 ? "+" : ""}
                          {op.change24hPercent}%
                        </span>
                        <span>RSI: {op.rsi}</span>
                        <span className="text-[11px] text-neutral-500 font-sans hidden md:inline">
                          {op.rationale}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                    {/* Confluence Score Gauge */}
                    <div className="text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        <span
                          className={`text-xs font-mono font-bold ${
                            op.score >= minConfidence
                              ? "text-emerald-400"
                              : op.score >= 60
                              ? "text-amber-400"
                              : "text-neutral-500"
                          }`}
                        >
                          {op.score}% Score
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            op.bestDirection === "LONG"
                              ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                              : op.bestDirection === "SHORT"
                              ? "bg-rose-950 text-rose-300 border border-rose-800"
                              : "bg-neutral-800 text-neutral-400"
                          }`}
                        >
                          {op.bestDirection}
                        </span>
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        {op.isEligible ? "Screen Threshold Met" : "Review / Abstain"}
                      </div>
                    </div>

                    {/* Action Button */}
                    <button
                      id={`trade-asset-${op.symbol.replace(/[^a-zA-Z0-9]/g, "")}`}
                      type="button"
                      onClick={() => {
                        onSelectAndTradeAsset(op.symbol as AssetSymbol, false);
                        onClose();
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                        op.isEligible
                          ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                          : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700"
                      }`}
                    >
                      <span>Switch & Scan</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
