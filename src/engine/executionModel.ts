import { PaperTradingSettings } from "../types/trading";

export interface FillCosts {
  expectedPrice: number;
  fillPrice: number;
  feeUsd: number;
  slippageUsd: number;
}

export type PositionSide = "LONG" | "SHORT";

export function applySlippage(expectedPrice: number, side: PositionSide, slippageBps: number, isEntry: boolean): number {
  const bps = Math.max(0, slippageBps) / 10000;
  const adverse = (side === "LONG") === isEntry ? 1 + bps : 1 - bps;
  return expectedPrice * adverse;
}

export function calculateFee(notionalUsd: number, feePercent: number): number {
  return Math.max(0, notionalUsd) * Math.max(0, feePercent) / 100;
}

export function modelEntryFill(marketPrice: number, side: PositionSide, notionalUsd: number, settings: PaperTradingSettings): FillCosts {
  const fillPrice = applySlippage(marketPrice, side, settings.slippageBps, true);
  return {
    expectedPrice: marketPrice,
    fillPrice,
    feeUsd: calculateFee(notionalUsd, settings.feeTierPercent),
    slippageUsd: Math.abs(fillPrice - marketPrice) * (notionalUsd / Math.max(marketPrice, 1)),
  };
}

export function modelExitFill(marketPrice: number, side: PositionSide, notionalUsd: number, settings: PaperTradingSettings): FillCosts {
  const fillPrice = applySlippage(marketPrice, side, settings.slippageBps, false);
  return {
    expectedPrice: marketPrice,
    fillPrice,
    feeUsd: calculateFee(notionalUsd, settings.feeTierPercent),
    slippageUsd: Math.abs(fillPrice - marketPrice) * (notionalUsd / Math.max(marketPrice, 1)),
  };
}

export function grossPnL(side: PositionSide, entryPrice: number, exitPrice: number, amount: number): number {
  return side === "LONG" ? (exitPrice - entryPrice) * amount : (entryPrice - exitPrice) * amount;
}

export function resolveStopTarget(
  side: PositionSide,
  candle: { open: number; high: number; low: number; close: number },
  stopLoss: number,
  takeProfit: number,
): { kind: "STOP" | "TARGET" | "NONE"; price: number; ambiguous: boolean } {
  const hitStop = side === "LONG" ? candle.low <= stopLoss : candle.high >= stopLoss;
  const hitTarget = side === "LONG" ? candle.high >= takeProfit : candle.low <= takeProfit;

  // A stop order is not guaranteed to fill at its stop price through a gap. If the
  // bar opens beyond the stop, use the open as the conservative fill price.
  const stoppedAt = side === "LONG"
    ? Math.min(candle.open, stopLoss)
    : Math.max(candle.open, stopLoss);

  if (hitStop && hitTarget) return { kind: "STOP", price: stoppedAt, ambiguous: true };
  if (hitStop) return { kind: "STOP", price: stoppedAt, ambiguous: false };
  if (hitTarget) return { kind: "TARGET", price: takeProfit, ambiguous: false };
  return { kind: "NONE", price: candle.close, ambiguous: false };
}
