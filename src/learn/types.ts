import type { StrategyConfig, Trade } from "../types/trading";
import type { DecisionFeatureSnapshot } from "./features";

export type LearningOutcome = "WIN" | "LOSS" | "FLAT";

export interface LearningTradeRecord {
  tradeId: string;
  recordedAt: number;
  asset: string;
  side: Trade["type"];
  strategyId: string;
  strategyVersion: number;
  strategyName: string;
  signalScore: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  sizeUsd: number;
  feesUsd: number;
  slippageUsd: number;
  pnlUsd: number;
  pnlPercent: number;
  outcome: LearningOutcome;
  entryTime: number;
  exitTime: number;
  holdingPeriodMs: number;
  exitStatus: Trade["status"];
  rationale: string;
  features?: DecisionFeatureSnapshot;
}

export function buildLearningTradeRecord(
  trade: Trade,
  strategy: StrategyConfig,
  recordedAt = Date.now(),
): LearningTradeRecord {
  const pnl = Number(trade.pnl);
  const outcome: LearningOutcome = pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "FLAT";
  const exitTime = Number(trade.exitTime || recordedAt);
  const entryTime = Number(trade.entryTime || recordedAt);

  return {
    tradeId: trade.id,
    recordedAt,
    asset: trade.asset,
    side: trade.type,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    strategyName: strategy.name,
    signalScore: Number(trade.signalScore) || 0,
    entryPrice: Number(trade.entryPrice),
    exitPrice: Number(trade.exitPrice || trade.entryPrice),
    quantity: Number(trade.amount) || 0,
    sizeUsd: Number(trade.sizeUsd) || 0,
    feesUsd: Number(trade.feesUsd) || 0,
    slippageUsd: Number(trade.slippageUsd) || 0,
    pnlUsd: pnl,
    pnlPercent: Number(trade.pnlPercent) || 0,
    outcome,
    entryTime,
    exitTime,
    holdingPeriodMs: Math.max(0, exitTime - entryTime),
    exitStatus: trade.status,
    rationale: trade.rationale || "",
    features: trade.learningFeatures ? { ...trade.learningFeatures } : undefined,
  };
}
