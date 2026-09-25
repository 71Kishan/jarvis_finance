import type { PaperTradingSettings } from "../types/trading";

export type ExecutionSide = "LONG" | "SHORT";

export interface FillCosts {
  expectedPrice: number;
  fillPrice: number;
  feeUsd: number;
  slippageUsd: number;
}

export interface FillRequest {
  expectedPrice: number;
  side: ExecutionSide;
  notionalUsd: number;
  settings: PaperTradingSettings;
}

export interface FillExecutionModel {
  entryFill(request: FillRequest): FillCosts;
  exitFill(request: FillRequest): FillCosts;
  grossPnL(side: ExecutionSide, entryPrice: number, exitPrice: number, amount: number): number;
}
