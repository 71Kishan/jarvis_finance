import type { PaperTradingSettings } from "../types/trading";
import { paperExecutionAdapter } from "../execution/paperExecutionAdapter";

export type { FillCosts, ExecutionSide as PositionSide } from "../execution/types";

export const applySlippage = (
  expectedPrice: number,
  side: "LONG" | "SHORT",
  slippageBps: number,
  isEntry: boolean,
): number => paperExecutionAdapter.applySlippage(expectedPrice, side, slippageBps, isEntry);

export const calculateFee = (notionalUsd: number, feePercent: number): number =>
  paperExecutionAdapter.calculateFee(notionalUsd, feePercent);

export const modelEntryFill = (
  marketPrice: number,
  side: "LONG" | "SHORT",
  notionalUsd: number,
  settings: PaperTradingSettings,
) => paperExecutionAdapter.entryFill({ expectedPrice: marketPrice, side, notionalUsd, settings });

export const modelExitFill = (
  marketPrice: number,
  side: "LONG" | "SHORT",
  notionalUsd: number,
  settings: PaperTradingSettings,
) => paperExecutionAdapter.exitFill({ expectedPrice: marketPrice, side, notionalUsd, settings });

export const grossPnL = (
  side: "LONG" | "SHORT",
  entryPrice: number,
  exitPrice: number,
  amount: number,
): number => paperExecutionAdapter.grossPnL(side, entryPrice, exitPrice, amount);

export const resolveStopTarget = (
  side: "LONG" | "SHORT",
  candle: { open: number; high: number; low: number; close: number },
  stopLoss: number,
  takeProfit: number,
) => paperExecutionAdapter.resolveStopTarget(side, candle, stopLoss, takeProfit);
