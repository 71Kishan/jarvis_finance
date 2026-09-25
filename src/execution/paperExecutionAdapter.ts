import type { Candle, PaperTradingSettings } from "../types/trading";
import type { FillExecutionModel, ExecutionSide, FillCosts, FillRequest } from "./types";

export class PaperExecutionAdapter implements FillExecutionModel {
  public entryFill(request: FillRequest): FillCosts {
    return this.fill(request, true);
  }

  public exitFill(request: FillRequest): FillCosts {
    return this.fill(request, false);
  }

  public grossPnL(side: ExecutionSide, entryPrice: number, exitPrice: number, amount: number): number {
    return side === "LONG"
      ? (exitPrice - entryPrice) * amount
      : (entryPrice - exitPrice) * amount;
  }

  public applySlippage(expectedPrice: number, side: ExecutionSide, slippageBps: number, isEntry: boolean): number {
    const bps = Math.max(0, slippageBps) / 10_000;
    const adverse = (side === "LONG") === isEntry ? 1 + bps : 1 - bps;
    return expectedPrice * adverse;
  }

  public calculateFee(notionalUsd: number, feePercent: number): number {
    return Math.max(0, notionalUsd) * Math.max(0, feePercent) / 100;
  }

  public resolveStopTarget(
    side: ExecutionSide,
    candle: Pick<Candle, "open" | "high" | "low" | "close">,
    stopLoss: number,
    takeProfit: number,
  ): { kind: "STOP" | "TARGET" | "NONE"; price: number; ambiguous: boolean } {
    const hitStop = side === "LONG" ? candle.low <= stopLoss : candle.high >= stopLoss;
    const hitTarget = side === "LONG" ? candle.high >= takeProfit : candle.low <= takeProfit;

    // A stop is not guaranteed to fill at the stop price through a gap. Use the
    // observed open as the conservative fill when the bar opens beyond the stop.
    const stoppedAt = side === "LONG"
      ? Math.min(candle.open, stopLoss)
      : Math.max(candle.open, stopLoss);

    if (hitStop && hitTarget) return { kind: "STOP", price: stoppedAt, ambiguous: true };
    if (hitStop) return { kind: "STOP", price: stoppedAt, ambiguous: false };
    if (hitTarget) return { kind: "TARGET", price: takeProfit, ambiguous: false };
    return { kind: "NONE", price: candle.close, ambiguous: false };
  }

  private fill(request: FillRequest, isEntry: boolean): FillCosts {
    const expectedPrice = Number(request.expectedPrice);
    const notionalUsd = Math.max(0, Number(request.notionalUsd));
    if (!Number.isFinite(expectedPrice) || expectedPrice <= 0) {
      throw new Error("Execution adapter requires a positive finite expected price.");
    }

    const settings: PaperTradingSettings = {
      slippageBps: Math.max(0, Number(request.settings.slippageBps) || 0),
      feeTierPercent: Math.max(0, Number(request.settings.feeTierPercent) || 0),
      leverage: 1,
      soundAlerts: Boolean(request.settings.soundAlerts),
    };
    const fillPrice = this.applySlippage(expectedPrice, request.side, settings.slippageBps, isEntry);
    const feeUsd = this.calculateFee(notionalUsd, settings.feeTierPercent);
    const slippageUsd = Math.abs(fillPrice - expectedPrice) * (notionalUsd / Math.max(expectedPrice, 1));

    return {
      expectedPrice,
      fillPrice,
      feeUsd,
      slippageUsd,
    };
  }
}

export const paperExecutionAdapter = new PaperExecutionAdapter();
