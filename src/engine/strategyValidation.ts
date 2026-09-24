import type { BacktestResult, StrategyConfig } from "../types/trading";

export type StrategyValidationStatus =
  | "INSUFFICIENT_EVIDENCE"
  | "FAILED"
  | "PROVISIONALLY_VALIDATED";

export interface StrategyValidationPolicy {
  minBacktestTrades: number;
  minWalkForwardFolds: number;
  minSelectedFolds: number;
  minOosCalendarDays: number;
  minPositiveFoldHitRatePercent: number;
  minMedianOosReturnPercent: number;
  maxWorstOosDrawdownPercent: number;
}

export interface StrategyValidationFoldSummary {
  folds: number;
  selectedFolds: number;
  selectedFoldHitRatePercent: number;
  meanOosReturnPercent: number;
  medianOosReturnPercent: number;
  worstOosDrawdownPercent: number;
  oosCalendarDays: number;
}

export interface StrategyValidationResult {
  strategyId: string;
  strategyVersion: number;
  strategyName: string;
  status: StrategyValidationStatus;
  policy: StrategyValidationPolicy;
  backtest: {
    totalTrades: number;
    totalPnl: number;
    maxDrawdown: number;
  };
  walkForward: StrategyValidationFoldSummary | null;
  gates: Array<{
    id:
      | "BACKTEST_SAMPLE"
      | "WALK_FORWARD_FOLDS"
      | "OOS_CALENDAR"
      | "OOS_CONSISTENCY"
      | "OOS_RETURN"
      | "OOS_DRAWDOWN";
    label: string;
    passed: boolean;
    observed: string;
    required: string;
    reason: string;
  }>;
  evaluatedAt: number;
}

export const DEFAULT_STRATEGY_VALIDATION_POLICY: StrategyValidationPolicy = {
  minBacktestTrades: 30,
  minWalkForwardFolds: 3,
  minSelectedFolds: 3,
  minOosCalendarDays: 30,
  minPositiveFoldHitRatePercent: 50,
  minMedianOosReturnPercent: 0,
  maxWorstOosDrawdownPercent: 10,
};

interface OptimizationLike {
  bestStrategy: StrategyConfig;
  bestResult: BacktestResult;
  walkForwardReliable?: boolean;
  walkForwardSummary?: Partial<StrategyValidationFoldSummary> & {
    folds?: number;
    selectedFolds?: number;
  };
}

function format(value: number | undefined, suffix = ""): string {
  if (value === undefined || !Number.isFinite(value)) return "unavailable";
  return Number(value.toFixed(3)).toString() + suffix;
}

export function evaluateStrategyValidation(
  optimization: OptimizationLike,
  policy: StrategyValidationPolicy = DEFAULT_STRATEGY_VALIDATION_POLICY,
  evaluatedAt = Date.now(),
): StrategyValidationResult {
  const strategy = optimization.bestStrategy;
  const backtest = optimization.bestResult;
  const summary = optimization.walkForwardSummary;
  const walkForward = summary
    ? {
        folds: Number(summary.folds ?? 0),
        selectedFolds: Number(summary.selectedFolds ?? 0),
        selectedFoldHitRatePercent: Number(summary.selectedFoldHitRatePercent ?? 0),
        meanOosReturnPercent: Number(summary.meanOosReturnPercent ?? 0),
        medianOosReturnPercent: Number(summary.medianOosReturnPercent ?? 0),
        worstOosDrawdownPercent: Number(summary.worstOosDrawdownPercent ?? 0),
        oosCalendarDays: Number(summary.oosCalendarDays ?? 0),
      }
    : null;

  const gates: StrategyValidationResult["gates"] = [
    {
      id: "BACKTEST_SAMPLE",
      label: "Backtest sample size",
      passed: backtest.totalTrades >= policy.minBacktestTrades,
      observed: String(backtest.totalTrades),
      required: `>= ${policy.minBacktestTrades} trades`,
      reason:
        backtest.totalTrades >= policy.minBacktestTrades
          ? "The historical test has enough completed trades for the first evidence gate."
          : "The historical test is too small to support a promotion decision.",
    },
    {
      id: "WALK_FORWARD_FOLDS",
      label: "Rolling walk-forward coverage",
      passed:
        Boolean(optimization.walkForwardReliable) &&
        Boolean(walkForward) &&
        (walkForward?.folds ?? 0) >= policy.minWalkForwardFolds &&
        (walkForward?.selectedFolds ?? 0) >= policy.minSelectedFolds,
      observed: walkForward
        ? `${walkForward.folds} folds / ${walkForward.selectedFolds} selected`
        : "unavailable",
      required: `>= ${policy.minWalkForwardFolds} folds and >= ${policy.minSelectedFolds} selected-candidate folds`,
      reason:
        optimization.walkForwardReliable && walkForward
          ? "Rolling selection and held-out test windows are present."
          : "A rolling out-of-sample evaluation is not sufficiently established.",
    },
    {
      id: "OOS_CALENDAR",
      label: "Out-of-sample calendar coverage",
      passed: Boolean(walkForward) && walkForward!.oosCalendarDays >= policy.minOosCalendarDays,
      observed: format(walkForward?.oosCalendarDays, " days"),
      required: `>= ${policy.minOosCalendarDays} days`,
      reason:
        (walkForward?.oosCalendarDays ?? 0) >= policy.minOosCalendarDays
          ? "The selected candidate has at least the minimum rolling OOS calendar span."
          : "The rolling OOS evidence covers too little calendar time.",
    },
    {
      id: "OOS_CONSISTENCY",
      label: "Positive OOS fold consistency",
      passed:
        Boolean(walkForward) &&
        walkForward!.selectedFoldHitRatePercent >= policy.minPositiveFoldHitRatePercent,
      observed: format(walkForward?.selectedFoldHitRatePercent, "%"),
      required: `>= ${policy.minPositiveFoldHitRatePercent}% positive selected-candidate folds`,
      reason:
        (walkForward?.selectedFoldHitRatePercent ?? 0) >= policy.minPositiveFoldHitRatePercent
          ? "At least half of the selected-candidate OOS folds were positive."
          : "Positive OOS outcomes are not consistent enough across folds.",
    },
    {
      id: "OOS_RETURN",
      label: "Median OOS return",
      passed:
        Boolean(walkForward) &&
        walkForward!.medianOosReturnPercent >= policy.minMedianOosReturnPercent,
      observed: format(walkForward?.medianOosReturnPercent, "%"),
      required: `>= ${policy.minMedianOosReturnPercent}%`,
      reason:
        (walkForward?.medianOosReturnPercent ?? -Infinity) >= policy.minMedianOosReturnPercent
          ? "The median held-out fold return is non-negative."
          : "The median held-out fold return is negative.",
    },
    {
      id: "OOS_DRAWDOWN",
      label: "Worst OOS drawdown",
      passed:
        Boolean(walkForward) &&
        walkForward!.worstOosDrawdownPercent <= policy.maxWorstOosDrawdownPercent,
      observed: format(walkForward?.worstOosDrawdownPercent, "%"),
      required: `<= ${policy.maxWorstOosDrawdownPercent}%`,
      reason:
        (walkForward?.worstOosDrawdownPercent ?? Infinity) <= policy.maxWorstOosDrawdownPercent
          ? "The worst selected-candidate OOS fold stayed inside the drawdown gate."
          : "At least one selected-candidate OOS fold breached the drawdown gate.",
    },
  ];

  const allPassed = gates.every((gate) => gate.passed);
  const anyFailedWithEvidence =
    Boolean(walkForward) &&
    gates.some((gate) => !gate.passed) &&
    backtest.totalTrades >= policy.minBacktestTrades;

  return {
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    strategyName: strategy.name,
    status: allPassed
      ? "PROVISIONALLY_VALIDATED"
      : anyFailedWithEvidence
        ? "FAILED"
        : "INSUFFICIENT_EVIDENCE",
    policy: { ...policy },
    backtest: {
      totalTrades: backtest.totalTrades,
      totalPnl: backtest.totalPnl,
      maxDrawdown: backtest.maxDrawdown,
    },
    walkForward,
    gates,
    evaluatedAt,
  };
}
