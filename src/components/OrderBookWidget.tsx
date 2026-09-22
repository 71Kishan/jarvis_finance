import React, { useMemo } from "react";
import { OrderBookLevel } from "../types/trading";

interface OrderBookWidgetProps {
  currentPrice: number;
  symbol: string;
  onSelectPrice?: (price: number) => void;
}

export const OrderBookWidget: React.FC<OrderBookWidgetProps> = ({
  currentPrice,
  symbol,
  onSelectPrice,
}) => {
  // Generate realistic dynamic Level-2 order book depth around currentPrice
  const { asks, bids, spread, spreadBps } = useMemo(() => {
    const tickStep = currentPrice > 1000 ? 5 : currentPrice > 100 ? 0.2 : 0.02;
    const askLevels: OrderBookLevel[] = [];
    const bidLevels: OrderBookLevel[] = [];

    let totalAskVol = 0;
    for (let i = 6; i >= 1; i--) {
      const p = Number((currentPrice + i * tickStep).toFixed(2));
      const size = Number((0.25 + Math.sin(p * 13) * 0.2 + (7 - i) * 0.15).toFixed(3));
      totalAskVol += size;
      askLevels.push({ price: p, size, total: Number(totalAskVol.toFixed(3)) });
    }

    let totalBidVol = 0;
    for (let i = 1; i <= 6; i++) {
      const p = Number((currentPrice - i * tickStep).toFixed(2));
      const size = Number((0.28 + Math.cos(p * 11) * 0.2 + (7 - i) * 0.15).toFixed(3));
      totalBidVol += size;
      bidLevels.push({ price: p, size, total: Number(totalBidVol.toFixed(3)) });
    }

    const spreadVal = Number((askLevels[askLevels.length - 1].price - bidLevels[0].price).toFixed(2));
    const bps = Number(((spreadVal / currentPrice) * 10000).toFixed(1));

    return {
      asks: askLevels,
      bids: bidLevels,
      spread: spreadVal,
      spreadBps: bps,
    };
  }, [currentPrice]);

  const maxTotal = Math.max(
    asks[0]?.total || 1,
    bids[bids.length - 1]?.total || 1
  );

  return (
    <div
      id="order-book-depth-widget"
      className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3 flex flex-col font-mono text-[11px]"
    >
      <div className="flex items-center justify-between pb-2 border-b border-neutral-800 text-neutral-400 font-sans font-semibold text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          Live Order Flow (L2)
        </span>
        <span className="text-[10px] text-neutral-500 font-mono">{symbol}</span>
      </div>

      <div className="grid grid-cols-3 text-neutral-400 font-semibold py-1.5 text-[10px] border-b border-neutral-800/60">
        <span>Price ($)</span>
        <span className="text-right">Size</span>
        <span className="text-right">Depth</span>
      </div>

      {/* Asks (Sells) */}
      <div className="flex flex-col gap-0.5 py-1">
        {asks.map((ask) => {
          const depthPct = Math.min(100, Math.round((ask.total / maxTotal) * 100));
          return (
            <div
              key={`ask-${ask.price}`}
              onClick={() => onSelectPrice?.(ask.price)}
              className="relative grid grid-cols-3 py-0.5 px-1 rounded cursor-pointer hover:bg-rose-950/40 transition-colors"
            >
              <div
                className="absolute right-0 top-0 bottom-0 bg-rose-500/15 rounded pointer-events-none"
                style={{ width: `${depthPct}%` }}
              />
              <span className="text-rose-400 font-bold relative z-10">
                {ask.price.toFixed(2)}
              </span>
              <span className="text-right text-neutral-300 relative z-10">
                {ask.size}
              </span>
              <span className="text-right text-neutral-400 relative z-10">
                {ask.total}
              </span>
            </div>
          );
        })}
      </div>

      {/* Spread Indicator Bar */}
      <div className="my-1.5 py-1 px-2 bg-neutral-950/80 border border-neutral-800 rounded flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-400 font-sans">Spread:</span>
          <span className="text-neutral-200 font-bold font-mono">${spread}</span>
          <span className="text-cyan-400 font-mono text-[9px]">({spreadBps} bps)</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-neutral-400 font-sans">Mid:</span>
          <span className="text-neutral-100 font-bold font-mono">
            ${currentPrice.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Bids (Buys) */}
      <div className="flex flex-col gap-0.5 py-1">
        {bids.map((bid) => {
          const depthPct = Math.min(100, Math.round((bid.total / maxTotal) * 100));
          return (
            <div
              key={`bid-${bid.price}`}
              onClick={() => onSelectPrice?.(bid.price)}
              className="relative grid grid-cols-3 py-0.5 px-1 rounded cursor-pointer hover:bg-emerald-950/40 transition-colors"
            >
              <div
                className="absolute right-0 top-0 bottom-0 bg-emerald-500/15 rounded pointer-events-none"
                style={{ width: `${depthPct}%` }}
              />
              <span className="text-emerald-400 font-bold relative z-10">
                {bid.price.toFixed(2)}
              </span>
              <span className="text-right text-neutral-300 relative z-10">
                {bid.size}
              </span>
              <span className="text-right text-neutral-400 relative z-10">
                {bid.total}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
