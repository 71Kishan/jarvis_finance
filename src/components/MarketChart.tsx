import React, { useMemo, useState } from "react";
import { Candle, Trade } from "../types/trading";
import { MarketRegime } from "../engine/marketSimulator";

interface MarketChartProps {
  candles: Candle[];
  activeTrade: Trade | null;
  tradeHistory: Trade[];
  assetSymbol: string;
  regime: MarketRegime;
}

export const MarketChart: React.FC<MarketChartProps> = ({
  candles,
  activeTrade,
  tradeHistory,
  assetSymbol,
  regime,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showIndicators, setShowIndicators] = useState({
    ema: true,
    bollinger: true,
    rsi: true,
    macd: true,
  });

  const chartData = useMemo(() => {
    // Show last 65 candles for clear candlestick detail
    const slice = candles.slice(-65);
    if (slice.length === 0) return { slice: [], minPrice: 0, maxPrice: 1, maxVol: 1 };

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 0;

    slice.forEach((c) => {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.indicators?.bbandLower && c.indicators.bbandLower < minPrice) {
        minPrice = c.indicators.bbandLower;
      }
      if (c.indicators?.bbandUpper && c.indicators.bbandUpper > maxPrice) {
        maxPrice = c.indicators.bbandUpper;
      }
      if (c.volume > maxVol) maxVol = c.volume;
    });

    // Add a 2% padding
    const padding = (maxPrice - minPrice) * 0.05 || 10;
    minPrice = Math.max(0, minPrice - padding);
    maxPrice = maxPrice + padding;

    return { slice, minPrice, maxPrice, maxVol: maxVol || 1 };
  }, [candles]);

  const { slice, minPrice, maxPrice, maxVol } = chartData;

  const width = 800;
  const height = 340;
  const rsiHeight = 80;
  const priceHeight = height - rsiHeight - 20;

  const getY = (price: number) => {
    if (maxPrice === minPrice) return priceHeight / 2;
    return priceHeight - ((price - minPrice) / (maxPrice - minPrice)) * priceHeight;
  };

  const getRsiY = (rsi: number) => {
    const top = priceHeight + 20;
    const boundedRsi = Math.max(0, Math.min(100, rsi));
    return top + rsiHeight - (boundedRsi / 100) * rsiHeight;
  };

  const candleWidth = Math.max(3, (width / (slice.length || 1)) * 0.65);
  const candleGap = width / (slice.length || 1);

  const hoveredCandle =
    hoverIndex !== null && slice[hoverIndex]
      ? slice[hoverIndex]
      : slice.length > 0
      ? slice[slice.length - 1]
      : null;

  // Helper for SVG polyline points
  const generatePolyline = (getter: (c: Candle) => number | undefined) => {
    return slice
      .map((c, i) => {
        const val = getter(c);
        if (val === undefined || isNaN(val)) return null;
        const x = i * candleGap + candleGap / 2;
        const y = getY(val);
        return `${x},${y}`;
      })
      .filter(Boolean)
      .join(" ");
  };

  const getRegimeColor = () => {
    switch (regime) {
      case "BULL_EXPANSION":
        return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
      case "BEAR_TREND":
        return "text-rose-400 border-rose-500/30 bg-rose-500/10";
      case "CHOPPY_RANGE":
        return "text-amber-400 border-amber-500/30 bg-amber-500/10";
      case "VOLATILITY_SPIKE":
        return "text-purple-400 border-purple-500/30 bg-purple-500/10 animate-pulse";
    }
  };

  return (
    <div className="bg-neutral-950 border border-neutral-800/90 rounded-xl p-4 flex flex-col gap-3 shadow-lg">
      {/* Chart Top Bar: Asset, Regime, Hover info & Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800/80 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-bold text-lg text-white">
              {assetSymbol}
            </span>
            <span className="text-xs font-mono text-neutral-400">1m Candle</span>
          </div>

          <div
            className={`px-2 py-0.5 rounded text-[11px] font-mono border uppercase ${getRegimeColor()}`}
          >
            Regime: {regime.replace("_", " ")}
          </div>
        </div>

        {/* Hover telemetry pill */}
        {hoveredCandle && (
          <div className="flex items-center gap-3 text-xs font-mono text-neutral-300 overflow-x-auto py-1">
            <span>
              O:{" "}
              <strong className="text-neutral-100">
                {hoveredCandle.open.toFixed(2)}
              </strong>
            </span>
            <span>
              H:{" "}
              <strong className="text-neutral-100">
                {hoveredCandle.high.toFixed(2)}
              </strong>
            </span>
            <span>
              L:{" "}
              <strong className="text-neutral-100">
                {hoveredCandle.low.toFixed(2)}
              </strong>
            </span>
            <span>
              C:{" "}
              <strong
                className={
                  hoveredCandle.close >= hoveredCandle.open
                    ? "text-emerald-400 font-bold"
                    : "text-rose-400 font-bold"
                }
              >
                {hoveredCandle.close.toFixed(2)}
              </strong>
            </span>
            {hoveredCandle.indicators && (
              <>
                <span className="text-cyan-400">
                  RSI: {hoveredCandle.indicators.rsi.toFixed(1)}
                </span>
                <span className="text-amber-300">
                  EMA9: {hoveredCandle.indicators.ema9.toFixed(1)}
                </span>
              </>
            )}
          </div>
        )}

        {/* Indicator toggle checkboxes */}
        <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
          <button
            onClick={() =>
              setShowIndicators((p) => ({ ...p, ema: !p.ema }))
            }
            className={`px-2 py-0.5 rounded border transition-colors ${
              showIndicators.ema
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : "bg-neutral-900 border-neutral-800 text-neutral-500"
            }`}
          >
            EMA 9/21/50
          </button>
          <button
            onClick={() =>
              setShowIndicators((p) => ({ ...p, bollinger: !p.bollinger }))
            }
            className={`px-2 py-0.5 rounded border transition-colors ${
              showIndicators.bollinger
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                : "bg-neutral-900 border-neutral-800 text-neutral-500"
            }`}
          >
            Bollinger
          </button>
          <button
            onClick={() =>
              setShowIndicators((p) => ({ ...p, rsi: !p.rsi }))
            }
            className={`px-2 py-0.5 rounded border transition-colors ${
              showIndicators.rsi
                ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                : "bg-neutral-900 border-neutral-800 text-neutral-500"
            }`}
          >
            RSI (14)
          </button>
          <button
            onClick={() =>
              setShowIndicators((p) => ({ ...p, macd: !p.macd }))
            }
            className={`px-2 py-0.5 rounded border transition-colors ${
              showIndicators.macd
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                : "bg-neutral-900 border-neutral-800 text-neutral-500"
            }`}
          >
            MACD (12,26,9)
          </button>
        </div>
      </div>

      {/* SVG Canvas Chart */}
      <div className="relative w-full aspect-[16/8] min-h-[320px] select-none">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full overflow-visible"
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="bbGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="rsiOverboughtGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Background Grid Lines */}
          {[0.2, 0.4, 0.6, 0.8].map((ratio) => {
            const y = priceHeight * ratio;
            const priceVal = maxPrice - ratio * (maxPrice - minPrice);
            return (
              <g key={ratio}>
                <line
                  x1="0"
                  y1={y}
                  x2={width}
                  y2={y}
                  stroke="#262626"
                  strokeDasharray="3 3"
                  strokeWidth="0.8"
                />
                <text
                  x={width - 5}
                  y={y - 4}
                  textAnchor="end"
                  fill="#737373"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {priceVal.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Bollinger Bands Shading */}
          {showIndicators.bollinger && (
            <>
              <polygon
                points={`
                  ${slice
                    .map((c, i) => `${i * candleGap + candleGap / 2},${getY(c.indicators?.bbandUpper || c.close)}`)
                    .join(" ")}
                  ${slice
                    .slice()
                    .reverse()
                    .map(
                      (c, i) =>
                        `${(slice.length - 1 - i) * candleGap + candleGap / 2},${getY(
                          c.indicators?.bbandLower || c.close
                        )}`
                    )
                    .join(" ")}
                `}
                fill="url(#bbGradient)"
              />
              <polyline
                points={generatePolyline((c) => c.indicators?.bbandUpper)}
                fill="none"
                stroke="#06b6d4"
                strokeWidth="0.75"
                strokeOpacity="0.4"
              />
              <polyline
                points={generatePolyline((c) => c.indicators?.bbandLower)}
                fill="none"
                stroke="#06b6d4"
                strokeWidth="0.75"
                strokeOpacity="0.4"
              />
            </>
          )}

          {/* EMA Lines */}
          {showIndicators.ema && (
            <>
              {/* EMA 50 (purple) */}
              <polyline
                points={generatePolyline((c) => c.indicators?.ema50)}
                fill="none"
                stroke="#a855f7"
                strokeWidth="1.2"
                strokeOpacity="0.7"
              />
              {/* EMA 21 (orange) */}
              <polyline
                points={generatePolyline((c) => c.indicators?.ema21)}
                fill="none"
                stroke="#f97316"
                strokeWidth="1.2"
                strokeOpacity="0.8"
              />
              {/* EMA 9 (cyan) */}
              <polyline
                points={generatePolyline((c) => c.indicators?.ema9)}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.5"
                strokeOpacity="0.9"
              />
            </>
          )}

          {/* Volume Sub-bars (embedded at bottom of price section) */}
          {slice.map((c, idx) => {
            const x = idx * candleGap + candleGap / 2;
            const volHeight = (c.volume / maxVol) * 40;
            const y = priceHeight - volHeight;
            const isUp = c.close >= c.open;
            return (
              <rect
                key={`vol-${c.timestamp}`}
                x={x - candleWidth / 2}
                y={y}
                width={candleWidth}
                height={volHeight}
                fill={isUp ? "#10b981" : "#f43f5e"}
                opacity="0.2"
              />
            );
          })}

          {/* Candlesticks */}
          {slice.map((c, idx) => {
            const x = idx * candleGap + candleGap / 2;
            const yOpen = getY(c.open);
            const yClose = getY(c.close);
            const yHigh = getY(c.high);
            const yLow = getY(c.low);
            const isUp = c.close >= c.open;
            const color = isUp ? "#10b981" : "#f43f5e";
            const candleTop = Math.min(yOpen, yClose);
            const candleBodyHeight = Math.max(1.5, Math.abs(yOpen - yClose));

            return (
              <g
                key={c.timestamp}
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(idx)}
              >
                {/* Wick */}
                <line
                  x1={x}
                  y1={yHigh}
                  x2={x}
                  y2={yLow}
                  stroke={color}
                  strokeWidth="1"
                />
                {/* Body */}
                <rect
                  x={x - candleWidth / 2}
                  y={candleTop}
                  width={candleWidth}
                  height={candleBodyHeight}
                  fill={color}
                  rx="0.5"
                />
              </g>
            );
          })}

          {/* Trade Execution Markers (Recent & Active) */}
          {slice.map((c, idx) => {
            const x = idx * candleGap + candleGap / 2;
            // Check if any trade in history entered near this candle time
            const matchingTrade = tradeHistory.find(
              (t) => Math.abs(t.entryTime - c.timestamp) < 65000
            );

            if (!matchingTrade) return null;

            const isLong = matchingTrade.type === "LONG";
            const yMarker = isLong ? getY(c.low) + 14 : getY(c.high) - 14;

            return (
              <g key={`marker-${matchingTrade.id}`}>
                <polygon
                  points={
                    isLong
                      ? `${x},${yMarker - 6} ${x - 4},${yMarker + 3} ${x + 4},${yMarker + 3}`
                      : `${x},${yMarker + 6} ${x - 4},${yMarker - 3} ${x + 4},${yMarker - 3}`
                  }
                  fill={isLong ? "#10b981" : "#f43f5e"}
                />
                <circle
                  cx={x}
                  cy={yMarker}
                  r="2"
                  fill="#ffffff"
                />
              </g>
            );
          })}

          {/* Active Trade Levels Overlay (Entry, Stop Loss, Take Profit) */}
          {activeTrade && (
            <g className="font-mono text-[10px]">
              {/* Entry Price Line */}
              <line
                x1="0"
                y1={getY(activeTrade.entryPrice)}
                x2={width}
                y2={getY(activeTrade.entryPrice)}
                stroke="#6366f1"
                strokeWidth="1.2"
              />
              <rect
                x={width - 120}
                y={getY(activeTrade.entryPrice) - 12}
                width="115"
                height="16"
                fill="#312e81"
                rx="3"
              />
              <text
                x={width - 62}
                y={getY(activeTrade.entryPrice)}
                fill="#e0e7ff"
                textAnchor="middle"
                fontSize="9"
              >
                ENTRY ${activeTrade.entryPrice.toFixed(2)}
              </text>

              {/* Take Profit Line */}
              <line
                x1="0"
                y1={getY(activeTrade.takeProfit)}
                x2={width}
                y2={getY(activeTrade.takeProfit)}
                stroke="#10b981"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
              <rect
                x={width - 120}
                y={getY(activeTrade.takeProfit) - 12}
                width="115"
                height="16"
                fill="#064e3b"
                rx="3"
              />
              <text
                x={width - 62}
                y={getY(activeTrade.takeProfit)}
                fill="#6ee7b7"
                textAnchor="middle"
                fontSize="9"
              >
                TP ${activeTrade.takeProfit.toFixed(2)}
              </text>

              {/* Stop Loss / Trailing Stop Line */}
              <line
                x1="0"
                y1={getY(activeTrade.stopLoss)}
                x2={width}
                y2={getY(activeTrade.stopLoss)}
                stroke="#f43f5e"
                strokeWidth="1.2"
                strokeDasharray="4 3"
              />
              <rect
                x={width - 120}
                y={getY(activeTrade.stopLoss) - 12}
                width="115"
                height="16"
                fill="#881337"
                rx="3"
              />
              <text
                x={width - 62}
                y={getY(activeTrade.stopLoss)}
                fill="#fecdd3"
                textAnchor="middle"
                fontSize="9"
              >
                SL ${activeTrade.stopLoss.toFixed(2)}
              </text>
            </g>
          )}

          {/* RSI Sub-Panel */}
          {showIndicators.rsi && (
            <g>
              {/* Divider */}
              <line
                x1="0"
                y1={priceHeight + 15}
                x2={width}
                y2={priceHeight + 15}
                stroke="#262626"
                strokeWidth="1"
              />

              {/* RSI 70 & 30 Reference Lines */}
              <line
                x1="0"
                y1={getRsiY(70)}
                x2={width}
                y2={getRsiY(70)}
                stroke="#ef4444"
                strokeDasharray="2 2"
                strokeOpacity="0.4"
              />
              <text
                x="15"
                y={getRsiY(70) - 2}
                fill="#ef4444"
                fontSize="8"
                fontFamily="monospace"
              >
                70 Overbought
              </text>

              <line
                x1="0"
                y1={getRsiY(30)}
                x2={width}
                y2={getRsiY(30)}
                stroke="#10b981"
                strokeDasharray="2 2"
                strokeOpacity="0.4"
              />
              <text
                x="15"
                y={getRsiY(30) + 9}
                fill="#10b981"
                fontSize="8"
                fontFamily="monospace"
              >
                30 Oversold
              </text>

              {/* 50 Midline */}
              <line
                x1="0"
                y1={getRsiY(50)}
                x2={width}
                y2={getRsiY(50)}
                stroke="#404040"
                strokeDasharray="1 3"
              />

              {/* RSI Line */}
              <polyline
                points={slice
                  .map((c, i) => {
                    const rsi = c.indicators?.rsi ?? 50;
                    const x = i * candleGap + candleGap / 2;
                    const y = getRsiY(rsi);
                    return `${x},${y}`;
                  })
                  .join(" ")}
                fill="none"
                stroke="#c084fc"
                strokeWidth="1.4"
              />

              <text
                x={width - 5}
                y={priceHeight + 28}
                textAnchor="end"
                fill="#a855f7"
                fontSize="9"
                fontFamily="monospace"
                fontWeight="bold"
              >
                RSI (14): {(hoveredCandle?.indicators?.rsi ?? 50).toFixed(1)}
              </text>
            </g>
          )}

          {/* Hover Crosshair Vertical Line */}
          {hoverIndex !== null && (
            <line
              x1={hoverIndex * candleGap + candleGap / 2}
              y1="0"
              x2={hoverIndex * candleGap + candleGap / 2}
              y2={height}
              stroke="#ffffff"
              strokeOpacity="0.25"
              strokeDasharray="2 2"
            />
          )}
        </svg>
      </div>

      {/* Legend & Key */}
      <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-neutral-400 pt-1 border-t border-neutral-900">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-sky-400 inline-block" /> EMA 9
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-orange-500 inline-block" /> EMA 21
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-purple-500 inline-block" /> EMA 50
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" /> BB (20,2)
          </span>
        </div>
        <div className="flex items-center gap-3 text-neutral-500">
          <span>Markers = Executed Algorithmic Entries</span>
          <span>Dashed Lines = Active Dynamic SL & TP</span>
        </div>
      </div>
    </div>
  );
};
