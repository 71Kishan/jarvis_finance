import React from "react";
import { MarketDataSource } from "../types/trading";

interface OrderBookWidgetProps {
  currentPrice: number | null;
  symbol: string;
  dataSource?: MarketDataSource;
  bid?: number | null;
  ask?: number | null;
}

export const OrderBookWidget: React.FC<OrderBookWidgetProps> = ({
  currentPrice,
  symbol,
  dataSource = "LIVE_MARKET_DATA",
  bid,
  ask,
}) => {
  const hasTop = Number.isFinite(bid) && Number.isFinite(ask) && (bid as number) > 0 && (ask as number) > 0;
  const spread = hasTop ? (ask as number) - (bid as number) : null;
  const spreadBps = hasTop && currentPrice != null && currentPrice > 0 ? (spread! / currentPrice) * 10000 : null;

  return (
    <div id="order-book-depth-widget" className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3 flex flex-col font-mono text-[11px]">
      <div className="flex items-center justify-between pb-2 border-b border-neutral-800 text-neutral-400 font-sans font-semibold text-xs">
        <span className="flex items-center gap-1.5">
          <span className={"w-1.5 h-1.5 rounded-full " + (hasTop ? "bg-emerald-400" : "bg-neutral-600")} />
          Top of Book
        </span>
        <span className="text-[10px] text-neutral-500 font-mono">{symbol}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 py-3">
        <div className="rounded-lg bg-rose-950/20 border border-rose-900/30 p-2">
          <div className="text-[9px] text-rose-300 uppercase">Ask</div>
          <div className="text-sm font-bold text-rose-300">{hasTop ? "$" + (ask as number).toFixed(2) : "—"}</div>
        </div>
        <div className="rounded-lg bg-emerald-950/20 border border-emerald-900/30 p-2">
          <div className="text-[9px] text-emerald-300 uppercase">Bid</div>
          <div className="text-sm font-bold text-emerald-300">{hasTop ? "$" + (bid as number).toFixed(2) : "—"}</div>
        </div>
      </div>

      <div className="py-2 border-t border-neutral-800 grid grid-cols-2 gap-2">
        <div><span className="text-neutral-500">Mid</span><div className="text-neutral-100 font-bold">{currentPrice != null ? "$" + currentPrice.toFixed(2) : "—"}</div></div>
        <div><span className="text-neutral-500">Spread</span><div className="text-neutral-200 font-bold">{spread !== null ? "$" + spread.toFixed(4) : "—"}</div></div>
      </div>

      <div className="mt-2 rounded-lg bg-neutral-950 border border-neutral-800 p-2 text-[10px] text-neutral-500 leading-relaxed">
        {dataSource === "SIMULATED"
          ? "Demo mode: market depth is not represented."
          : hasTop
            ? "Top-of-book only. Full Level-2 depth is not connected, so Jarvis does not synthesize liquidity."
            : "Top-of-book unavailable from the current provider. Jarvis does not synthesize an order book."}
      </div>
      {spreadBps !== null && <div className="mt-2 text-[9px] text-neutral-500 font-mono">Spread: {spreadBps.toFixed(1)} bps • Source: {dataSource}</div>}
    </div>
  );
};
