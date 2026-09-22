import React from "react";
import { LiveExchangeTicker } from "../types/trading";

interface OrderBookWidgetProps {
  currentPrice: number;
  symbol: string;
  ticker?: LiveExchangeTicker | null;
  onSelectPrice?: (price: number) => void;
}

export const OrderBookWidget: React.FC<OrderBookWidgetProps> = ({
  currentPrice,
  symbol,
  ticker,
}) => {
  const maxTotal = Math.max(
    asks[0]?.total || 1,
    bids[bids.length - 1]?.total || 1
  );

  const hasBidAsk = Boolean(ticker) && ticker!.source === "BINANCE" && ticker!.bid > 0 && ticker!.ask > 0;
  const spread = hasBidAsk ? ticker!.ask - ticker!.bid : null;
  const spreadBps = hasBidAsk && ticker!.price > 0 ? (spread! / ticker!.price) * 10000 : null;

  return (
    <div
      id="order-book-depth-widget"
      className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3 flex flex-col font-mono text-[11px]"
    >
      <div className="flex items-center justify-between pb-2 border-b border-neutral-800 text-neutral-400 font-sans font-semibold text-xs">
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${hasBidAsk ? "bg-cyan-400" : "bg-amber-400"}`} />
          Market Quote
        </span>
        <span className="text-[10px] text-neutral-500 font-mono">{symbol}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 py-3">
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-2">
          <div className="text-[10px] text-neutral-500">Last / Mark</div>
          <div className="text-sm font-bold text-neutral-100">
            {currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : "N/A"}
          </div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-2">
          <div className="text-[10px] text-neutral-500">24h Change</div>
          <div className="text-sm font-bold text-neutral-100">
            {ticker ? `${ticker.change24hPercent >= 0 ? "+" : ""}${ticker.change24hPercent.toFixed(2)}%` : "N/A"}
          </div>
        </div>
      </div>

      {hasBidAsk ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-2">
            <div className="text-[10px] text-emerald-400">Bid</div>
            <div className="font-bold text-neutral-100">${ticker!.bid.toFixed(2)}</div>
          </div>
          <div className="rounded-lg border border-rose-900/40 bg-rose-950/20 p-2">
            <div className="text-[10px] text-rose-400">Ask</div>
            <div className="font-bold text-neutral-100">${ticker!.ask.toFixed(2)}</div>
          </div>
          <div className="col-span-2 mt-1 py-2 px-2.5 bg-neutral-950/80 border border-neutral-800 rounded flex items-center justify-between text-[10px]">
            <span className="text-neutral-500">Spread <strong className="text-neutral-200">${spread!.toFixed(2)}</strong></span>
            <span className="text-cyan-400">{spreadBps!.toFixed(1)} bps</span>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-amber-300">
          <div className="font-semibold">Depth not available</div>
          <div className="text-[10px] leading-relaxed text-amber-200/70 mt-1">
            Jarvis does not synthesize Level-2 bids, asks, or depth. A provider with real order-book data is required for this view.
          </div>
        </div>
      )}

      <div className="mt-3 text-[10px] text-neutral-500">
        Source: {ticker?.source || "SIMULATOR"} · Quality: {ticker?.dataQuality || "SIMULATED"}
      </div>
    </div>
  );;
};
