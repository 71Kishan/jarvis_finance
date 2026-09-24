import React, { useMemo, useState } from "react";
import { attachIndicators } from "../engine/indicators";
import type { Candle, Trade } from "../types/trading";
import type { MarketRegime } from "../engine/marketSimulator";

export type ChartTimeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
export type ChartType = "CANDLES" | "LINE";

interface MarketChartProps {
  candles: Candle[];
  formingCandle?: Candle | null;
  activeTrade: Trade | null;
  tradeHistory: Trade[];
  assetSymbol: string;
  regime?: MarketRegime | null;
  timeframe?: ChartTimeframe;
  onTimeframeChange?: (timeframe: ChartTimeframe) => void;
  chartStatus?: "LIVE" | "REFRESHING" | "STALE" | "UNAVAILABLE";
}

const TIMEFRAME_MS: Record<ChartTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

const fmtPrice = (value: number, digits?: number) => {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const resolvedDigits =
    digits ??
    (absolute >= 1000 ? 2 :
      absolute >= 1 ? 2 :
        absolute >= 0.01 ? 4 :
          absolute >= 0.0001 ? 6 : 8);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits !== undefined ? digits : 0,
    maximumFractionDigits: resolvedDigits,
  });
};

const fmtVolume = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + "B";
  if (absolute >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (absolute >= 1_000) return (value / 1_000).toFixed(2) + "K";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const fmtTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const fmtAxisTime = (timestamp: number, timeframe: ChartTimeframe) =>
  timeframe === "1d"
    ? new Date(timestamp).toLocaleDateString([], { month: "short", day: "2-digit" })
    : timeframe === "4h" || timeframe === "1h"
      ? new Date(timestamp).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit" })
      : fmtTime(timestamp);

const fmtDateTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

function getRange(values: number[], fallback = 1) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: fallback };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = Math.max(max - min, Math.abs(max) * 0.0005, 0.00000001);
  const padding = span * 0.08;
  return { min: Math.max(0, min - padding), max: max + padding };
}

function getRegimeClass(regime: MarketRegime | null | undefined) {
  switch (regime) {
    case "BULL_EXPANSION":
      return "text-emerald-300 border-emerald-500/30 bg-emerald-500/10";
    case "BEAR_TREND":
      return "text-rose-300 border-rose-500/30 bg-rose-500/10";
    case "VOLATILITY_SPIKE":
      return "text-violet-300 border-violet-500/30 bg-violet-500/10";
    default:
      return "text-amber-300 border-amber-500/30 bg-amber-500/10";
  }
}

const STATUS_STYLES: Record<NonNullable<MarketChartProps["chartStatus"]>, string> = {
  LIVE: "text-emerald-300 border-emerald-500/20 bg-emerald-500/5",
  REFRESHING: "text-sky-300 border-sky-500/20 bg-sky-500/5",
  STALE: "text-amber-300 border-amber-500/20 bg-amber-500/5",
  UNAVAILABLE: "text-rose-300 border-rose-500/20 bg-rose-500/5",
};

export const MarketChart: React.FC<MarketChartProps> = ({
  candles,
  formingCandle = null,
  activeTrade,
  tradeHistory,
  assetSymbol,
  regime,
  timeframe = "1m",
  onTimeframeChange,
  chartStatus = "LIVE",
}) => {
  const [visibleCount, setVisibleCount] = useState(80);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [chartType, setChartType] = useState<ChartType>("CANDLES");
  const [showIndicators, setShowIndicators] = useState({
    ema: true,
    bollinger: true,
    rsi: true,
    volume: true,
  });

  const chartData = useMemo(() => {
    const clean = candles
      .filter((c) =>
        [c.timestamp, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite),
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    const withLive = formingCandle ? [...clean, { ...formingCandle }] : clean;
    const enriched = attachIndicators(withLive);
    const closedCount = clean.length;
    const startIndex = Math.max(0, enriched.length - visibleCount - (formingCandle ? 1 : 0));
    const displayRows = enriched
      .map((candle, index) => ({ candle, index }))
      .slice(startIndex);
    const displayClosedRows = displayRows.filter((row) => row.index < closedCount);
    const display = displayRows.map((row) => row.candle);

    const priceValues: number[] = [];
    const volumeValues: number[] = [];
    displayRows.forEach(({ candle }) => {
      priceValues.push(candle.open, candle.high, candle.low, candle.close);
      volumeValues.push(candle.volume);

      if (showIndicators.ema) {
        if (Number.isFinite(candle.indicators?.ema9)) priceValues.push(candle.indicators!.ema9);
        if (Number.isFinite(candle.indicators?.ema21)) priceValues.push(candle.indicators!.ema21);
        if (Number.isFinite(candle.indicators?.ema50)) priceValues.push(candle.indicators!.ema50);
      }
      if (showIndicators.bollinger) {
        if (Number.isFinite(candle.indicators?.bbandUpper)) priceValues.push(candle.indicators!.bbandUpper);
        if (Number.isFinite(candle.indicators?.bbandLower)) priceValues.push(candle.indicators!.bbandLower);
      }
    });

    return {
      display,
      displayRows,
      displayClosedRows,
      closedCount,
      priceRange: getRange(priceValues, 1),
      maxVolume: Math.max(1, ...volumeValues.filter(Number.isFinite)),
    };
  }, [candles, formingCandle, visibleCount, showIndicators.ema, showIndicators.bollinger]);

  const { display, displayRows, displayClosedRows, closedCount, priceRange, maxVolume } = chartData;
  const hasData = display.length > 0;
  const width = 1000;
  const priceHeight = 300;
  const volumeHeight = showIndicators.volume ? 68 : 0;
  const rsiHeight = showIndicators.rsi ? 92 : 0;
  const timeHeight = 30;
  const gap = 10;
  const height = priceHeight + volumeHeight + rsiHeight + timeHeight + gap * 2;

  const getPriceY = (price: number) => {
    const span = priceRange.max - priceRange.min || 1;
    return ((priceRange.max - price) / span) * priceHeight;
  };

  const getRsiY = (value: number) => {
    const bounded = Math.max(0, Math.min(100, value));
    const top = priceHeight + gap + volumeHeight + gap;
    return top + rsiHeight - (bounded / 100) * rsiHeight;
  };

  const step = width / Math.max(1, display.length);
  const candleWidth = Math.max(3, Math.min(13, step * 0.64));

  const hoveredCandle =
    hoverIndex !== null && display[hoverIndex]
      ? display[hoverIndex]
      : display[display.length - 1] || null;

  const latestClosed = displayClosedRows[displayClosedRows.length - 1]?.candle || null;
  const latestVisible = display[display.length - 1] || null;

  const matchingTrades = useMemo(() => {
    const timeframeMs = TIMEFRAME_MS[timeframe];
    return tradeHistory.filter((trade) =>
      display.some((c) => Math.abs(trade.entryTime - c.timestamp) < timeframeMs),
    );
  }, [display, tradeHistory, timeframe]);

  const priceTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      ratio,
      value: priceRange.max - ratio * (priceRange.max - priceRange.min),
      y: ratio * priceHeight,
    };
  });

  const timeTickIndexes = useMemo(() => {
    if (display.length <= 8) return display.map((_, index) => index);
    const desired = 8;
    const interval = Math.max(1, Math.floor((display.length - 1) / (desired - 1)));
    const indexes: number[] = [];
    for (let i = 0; i < display.length; i += interval) indexes.push(i);
    if (indexes[indexes.length - 1] !== display.length - 1) indexes.push(display.length - 1);
    return indexes;
  }, [display.length]);

  const pointerToIndex = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!display.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const index = Math.max(
      0,
      Math.min(display.length - 1, Math.floor((localX / rect.width) * display.length)),
    );
    setHoverIndex(index);
  };

  const indicatorReady = (globalIndex: number, period: number) => globalIndex >= period - 1;

  return (
    <div className="bg-neutral-950 border border-neutral-800/90 rounded-xl shadow-lg overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-neutral-800/80 p-4 pb-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-mono font-bold text-lg text-white">{assetSymbol}</div>
            <span className="text-[10px] font-mono text-neutral-600">{timeframe.toUpperCase()}</span>
            <div className={"px-2 py-0.5 rounded border text-[10px] font-mono uppercase " + (regime ? getRegimeClass(regime) : "text-neutral-600 border-neutral-800 bg-neutral-900")}>
              {regime ? regime.replaceAll("_", " ") : "REGIME UNAVAILABLE"}
            </div>
            <div className={"px-2 py-0.5 rounded border text-[10px] font-mono uppercase " + STATUS_STYLES[chartStatus]}>
              {chartStatus}
            </div>
            {formingCandle && (
              <div className="px-2 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300 text-[10px] font-mono uppercase">
                Live bar
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onTimeframeChange && (
              <div className="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/70 p-1 text-[10px] font-mono">
                {(["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as ChartTimeframe[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onTimeframeChange(value)}
                    className={
                      "px-2 py-1.5 rounded " +
                      (timeframe === value
                        ? "bg-neutral-100 text-neutral-950 font-semibold"
                        : "text-neutral-500 hover:text-neutral-200")
                    }
                  >
                    {value.toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/70 p-1 text-[10px] font-mono">
              {([["CANDLES", "CANDLE"], ["LINE", "LINE"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setChartType(value)}
                  className={
                    "px-2 py-1.5 rounded " +
                    (chartType === value
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-500 hover:text-neutral-200")
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 text-[10px] font-mono">
              {[40, 80, 160].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setVisibleCount(count)}
                  className={
                    "px-2 py-1.5 rounded border " +
                    (visibleCount === count
                      ? "border-neutral-600 bg-neutral-800 text-neutral-100"
                      : "border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-300")
                  }
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
          {([
            ["ema", "EMA 9/21/50"],
            ["bollinger", "Bollinger"],
            ["volume", "Volume"],
            ["rsi", "RSI 14"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setShowIndicators((current) => ({ ...current, [key]: !current[key] }))}
              className={
                "px-2 py-1 rounded border " +
                (showIndicators[key]
                  ? "border-neutral-700 bg-neutral-900 text-neutral-200"
                  : "border-neutral-900 bg-neutral-950 text-neutral-600")
              }
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-neutral-600">{closedCount} completed bars{formingCandle ? " + 1 forming bar" : ""}</span>
        </div>

        {hoveredCandle ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-[10px] font-mono">
            <div><span className="text-neutral-600">TIME</span><div className="text-neutral-200 mt-0.5">{fmtDateTime(hoveredCandle.timestamp)}</div></div>
            <div><span className="text-neutral-600">OPEN</span><div className="text-neutral-200 mt-0.5">{fmtPrice(hoveredCandle.open)}</div></div>
            <div><span className="text-neutral-600">HIGH</span><div className="text-neutral-200 mt-0.5">{fmtPrice(hoveredCandle.high)}</div></div>
            <div><span className="text-neutral-600">LOW</span><div className="text-neutral-200 mt-0.5">{fmtPrice(hoveredCandle.low)}</div></div>
            <div><span className="text-neutral-600">CLOSE</span><div className={hoveredCandle.close >= hoveredCandle.open ? "text-emerald-300 mt-0.5" : "text-rose-300 mt-0.5"}>{fmtPrice(hoveredCandle.close)}</div></div>
            <div><span className="text-neutral-600">VOLUME</span><div className="text-neutral-200 mt-0.5">{fmtVolume(hoveredCandle.volume)}</div></div>
            <div><span className="text-neutral-600">RSI</span><div className="text-purple-300 mt-0.5">{fmtPrice(hoveredCandle.indicators?.rsi ?? NaN, 1)}</div></div>
            <div><span className="text-neutral-600">STATE</span><div className="text-sky-300 mt-0.5">{formingCandle && hoveredCandle.timestamp === formingCandle.timestamp ? "FORMING" : "CLOSED"}</div></div>
          </div>
        ) : (
          <div className="text-xs font-mono text-neutral-600">Waiting for trusted market candles…</div>
        )}
      </div>

      {!hasData ? (
        <div className="min-h-[420px] flex items-center justify-center text-center">
          <div>
            <div className="text-sm font-mono text-neutral-400">
              {chartStatus === "UNAVAILABLE" ? "Chart data unavailable" : "No trusted candles available"}
            </div>
            <div className="text-xs text-neutral-600 mt-2 max-w-md">
              Jarvis will not replace a missing provider series with synthetic prices.
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full overflow-hidden">
          <svg
            viewBox={"0 0 " + width + " " + height}
            className="w-full h-auto min-h-[440px] select-none touch-none"
            role="img"
            aria-label={assetSymbol + " " + timeframe + " market chart"}
            onPointerMove={pointerToIndex}
            onPointerLeave={() => setHoverIndex(null)}
          >
            <rect x="0" y="0" width={width} height={height} fill="#0a0a0a" />

            {priceTicks.map((tick) => (
              <g key={tick.ratio}>
                <line x1="0" y1={tick.y} x2={width} y2={tick.y} stroke="#202020" strokeDasharray="4 4" />
                <text x={width - 4} y={tick.y + 4} textAnchor="end" fill="#737373" fontSize="10" fontFamily="monospace">
                  {fmtPrice(tick.value)}
                </text>
              </g>
            ))}

            {chartType === "CANDLES" ? displayRows.map(({ candle, index: globalIndex }, index) => {
              const x = index * step + step / 2;
              const openY = getPriceY(candle.open);
              const closeY = getPriceY(candle.close);
              const highY = getPriceY(candle.high);
              const lowY = getPriceY(candle.low);
              const up = candle.close >= candle.open;
              const live = Boolean(formingCandle && candle.timestamp === formingCandle.timestamp);
              const stroke = up ? "#34d399" : "#fb7185";
              const bodyTop = Math.min(openY, closeY);
              const bodyHeight = Math.max(1.8, Math.abs(openY - closeY));

              return (
                <g key={String(candle.timestamp)} opacity={live ? 0.8 : 1}>
                  <line x1={x} y1={highY} x2={x} y2={lowY} stroke={stroke} strokeWidth={live ? 1.5 : 1.1} />
                  <rect
                    x={x - candleWidth / 2}
                    y={bodyTop}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={stroke}
                    fillOpacity={live ? 0.55 : 0.9}
                    stroke={live ? "#e0f2fe" : stroke}
                    strokeWidth={live ? 0.8 : 0}
                    rx="0.6"
                  />
                </g>
              );
            }) : (
              <polyline
                fill="none"
                stroke="#f5f5f5"
                strokeWidth="1.8"
                points={display.map((candle, index) =>
                  (index * step + step / 2) + "," + getPriceY(candle.close)
                ).join(" ")}
              />
            )}

            {showIndicators.bollinger && (
              <>
                <polyline
                  fill="none"
                  stroke="#22d3ee"
                  strokeOpacity="0.5"
                  strokeWidth="1"
                  points={displayRows
                    .map(({ candle, index: globalIndex }, index) =>
                      indicatorReady(globalIndex, 20) && Number.isFinite(candle.indicators?.bbandUpper)
                        ? (index * step + step / 2) + "," + getPriceY(candle.indicators!.bbandUpper)
                        : null)
                    .filter(Boolean)
                    .join(" ")}
                />
                <polyline
                  fill="none"
                  stroke="#22d3ee"
                  strokeOpacity="0.5"
                  strokeWidth="1"
                  points={displayRows
                    .map(({ candle, index: globalIndex }, index) =>
                      indicatorReady(globalIndex, 20) && Number.isFinite(candle.indicators?.bbandLower)
                        ? (index * step + step / 2) + "," + getPriceY(candle.indicators!.bbandLower)
                        : null)
                    .filter(Boolean)
                    .join(" ")}
                />
              </>
            )}

            {showIndicators.ema && (
              <>
                <polyline
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.4"
                  points={displayRows
                    .map(({ candle, index: globalIndex }, index) =>
                      indicatorReady(globalIndex, 9) && Number.isFinite(candle.indicators?.ema9)
                        ? (index * step + step / 2) + "," + getPriceY(candle.indicators!.ema9)
                        : null)
                    .filter(Boolean)
                    .join(" ")}
                />
                <polyline
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="1.2"
                  points={displayRows
                    .map(({ candle, index: globalIndex }, index) =>
                      indicatorReady(globalIndex, 21) && Number.isFinite(candle.indicators?.ema21)
                        ? (index * step + step / 2) + "," + getPriceY(candle.indicators!.ema21)
                        : null)
                    .filter(Boolean)
                    .join(" ")}
                />
                <polyline
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="1.2"
                  points={displayRows
                    .map(({ candle, index: globalIndex }, index) =>
                      indicatorReady(globalIndex, 50) && Number.isFinite(candle.indicators?.ema50)
                        ? (index * step + step / 2) + "," + getPriceY(candle.indicators!.ema50)
                        : null)
                    .filter(Boolean)
                    .join(" ")}
                />
              </>
            )}

            {activeTrade && (
              <g>
                {[
                  { price: activeTrade.entryPrice, label: "ENTRY", stroke: "#818cf8", fill: "#312e81", dash: "" },
                  { price: activeTrade.takeProfit, label: "TP", stroke: "#34d399", fill: "#064e3b", dash: "5 4" },
                  { price: activeTrade.stopLoss, label: "SL", stroke: "#fb7185", fill: "#881337", dash: "5 4" },
                ].map((level) => {
                  const y = getPriceY(level.price);
                  return (
                    <g key={level.label}>
                      <line x1="0" y1={y} x2={width} y2={y} stroke={level.stroke} strokeWidth="1" strokeDasharray={level.dash} />
                      <rect x={width - 128} y={y - 10} width="124" height="16" rx="3" fill={level.fill} opacity="0.9" />
                      <text x={width - 66} y={y + 2} textAnchor="middle" fill="#fff" fontSize="9" fontFamily="monospace">
                        {level.label} {fmtPrice(level.price)}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {latestVisible && (
              <g>
                <line
                  x1="0"
                  y1={getPriceY(latestVisible.close)}
                  x2={width}
                  y2={getPriceY(latestVisible.close)}
                  stroke="#e5e5e5"
                  strokeOpacity="0.25"
                  strokeDasharray="2 4"
                />
                <rect x={width - 118} y={getPriceY(latestVisible.close) - 9} width="114" height="16" rx="3" fill="#171717" stroke="#404040" />
                <text x={width - 61} y={getPriceY(latestVisible.close) + 2} textAnchor="middle" fill="#d4d4d4" fontSize="9" fontFamily="monospace">
                  {fmtPrice(latestVisible.close)}
                </text>
              </g>
            )}

            {hoverIndex !== null && (
              <line
                x1={hoverIndex * step + step / 2}
                y1="0"
                x2={hoverIndex * step + step / 2}
                y2={priceHeight}
                stroke="#e5e5e5"
                strokeOpacity="0.3"
                strokeDasharray="3 3"
              />
            )}

            {showIndicators.volume && (
              <g transform={"translate(0 " + (priceHeight + gap) + ")"}>
                <line x1="0" y1="0" x2={width} y2="0" stroke="#262626" />
                {display.map((candle, index) => {
                  const x = index * step + step / 2;
                  const h = Math.max(1, (candle.volume / maxVolume) * (volumeHeight - 8));
                  const up = candle.close >= candle.open;
                  return (
                    <rect
                      key={"volume-" + candle.timestamp}
                      x={x - candleWidth / 2}
                      y={volumeHeight - h}
                      width={candleWidth}
                      height={h}
                      fill={up ? "#10b981" : "#f43f5e"}
                      opacity="0.35"
                    />
                  );
                })}
                <text x="5" y="14" fill="#525252" fontSize="9" fontFamily="monospace">VOLUME</text>
              </g>
            )}

            {showIndicators.rsi && (
              <g transform={"translate(0 " + (priceHeight + gap + volumeHeight + gap) + ")"}>
                <rect x="0" y="0" width={width} height={rsiHeight} fill="#0b0b0b" />
                <line x1="0" y1={rsiHeight * 0.3} x2={width} y2={rsiHeight * 0.3} stroke="#7f1d1d" strokeDasharray="3 3" opacity="0.5" />
                <line x1="0" y1={rsiHeight * 0.7} x2={width} y2={rsiHeight * 0.7} stroke="#14532d" strokeDasharray="3 3" opacity="0.5" />
                <line x1="0" y1={rsiHeight * 0.5} x2={width} y2={rsiHeight * 0.5} stroke="#262626" strokeDasharray="2 4" />
                <polyline
                  fill="none"
                  stroke="#c084fc"
                  strokeWidth="1.4"
                  points={displayRows.map(({ candle, index: globalIndex }, index) => {
                    const x = index * step + step / 2;
                    const y = getRsiY(candle.indicators?.rsi ?? NaN) - (priceHeight + gap + volumeHeight + gap);
                    return indicatorReady(globalIndex, 15) && Number.isFinite(y) ? x + "," + y : null;
                  }).filter(Boolean).join(" ")}
                />
                <text x="5" y="13" fill="#7c3aed" fontSize="9" fontFamily="monospace">RSI 14</text>
                <text x="43" y="13" fill="#525252" fontSize="9" fontFamily="monospace">70 / 50 / 30</text>
              </g>
            )}

            {timeTickIndexes.map((index) => {
              const candle = display[index];
              const x = index * step + step / 2;
              return (
                <g key={"time-" + candle.timestamp}>
                  <line x1={x} y1={height - timeHeight} x2={x} y2={height - timeHeight + 4} stroke="#444" />
                  <text x={x} y={height - 8} textAnchor="middle" fill="#666" fontSize="9" fontFamily="monospace">
                    {fmtAxisTime(candle.timestamp, timeframe)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-t border-neutral-900 text-[10px] font-mono text-neutral-600">
        <span>{hoveredCandle ? "Hover " + fmtTime(hoveredCandle.timestamp) : "Move pointer across chart for OHLC telemetry"}</span>
        <span>{matchingTrades.length > 0 ? matchingTrades.length + " execution marker(s)" : "Strategy calculations remain on their own server timeframe."}</span>
      </div>
    </div>
  );
};
