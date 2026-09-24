import type { ShadowEvidenceSummary } from "../platform/platformRepository";

export type ForwardValidationStatus =
  | "INSUFFICIENT_EVIDENCE"
  | "FAILED"
  | "PROVISIONALLY_VALIDATED";

export interface ForwardValidationPolicy {
  minClosedTrades: number;
  minForwardCalendarDays: number;
  minProfitFactor: number;
  minExpectancyPerTrade: number;
  maxDrawdownPercent: number;
}

export interface ForwardValidationResult {
  status: ForwardValidationStatus;
  policy: ForwardValidationPolicy;
  evidence: {
    runtimeId: string;
    strategyId: string;
    strategyVersion: number;
    symbol: string;
    status: string;
    forwardCalendarDays: number;
    observationCount: number;
    closedTrades: number;
    winRatePercent: string;
    profitFactor: string;
    expectancyPerTrade: string;
    totalPnl: string;
    totalFees: string;
    maxDrawdownPercent: string;
    latestEquity: string | null;
  };
  gates: Array<{
    id:
      | "CLOSED_TRADES"
      | "FORWARD_CALENDAR"
      | "PROFIT_FACTOR"
      | "EXPECTANCY"
      | "DRAWDOWN"
      | "RUNTIME_HEALTH";
    label: string;
    passed: boolean;
    observed: string;
    required: string;
    reason: string;
  }>;
  evaluatedAt: number;
};

export const DEFAULT_FORWARD_VALIDATION_POLICY: ForwardValidationPolicy = {
  minClosedTrades: 30,
  minForwardCalendarDays: 30,
  minProfitFactor: 1.05,
  minExpectancyPerTrade: 0,
  maxDrawdownPercent: 10,
};

function finite(value: string): number {
  if (value === "INF" || value === "Infinity") return Infinity;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function format(value: number | string, suffix = ""): string {
  const numeric = typeof value === "number" ? value : finite(value);
  if (!Number.isFinite(numeric)) return "unavailable";
  return Number(numeric.toFixed(4)).toString() + suffix;
}

export function evaluateForwardValidation(
  evidence: ShadowEvidenceSummary,
  policy: ForwardValidationPolicy = DEFAULT_FORWARD_VALIDATION_POLICY,
  evaluatedAt = Date.now(),
): ForwardValidationResult {
  const gates: ForwardValidationResult["gates"] = [
    {
      id: "CLOSED_TRADES",
      label: "Closed forward trades",
      passed: evidence.closedTrades >= policy.minClosedTrades,
      observed: String(evidence.closedTrades),
      required: `>= ${policy.minClosedTrades}`,
      reason:
        evidence.closedTrades >= policy.minClosedTrades
          ? "Forward shadow has enough closed observations for this first evidence gate."
          : "The forward sample is still too small for a promotion decision.",
    },
    {
      id: "FORWARD_CALENDAR",
      label: "Forward calendar coverage",
      passed: evidence.forwardCalendarDays >= policy.minForwardCalendarDays,
      observed: format(evidence.forwardCalendarDays, " days"),
      required: `>= ${policy.minForwardCalendarDays} days`,
      reason:
        evidence.forwardCalendarDays >= policy.minForwardCalendarDays
          ? "Forward evidence spans the minimum calendar period."
          : "Forward evidence has not observed enough market time yet.",
    },
    {
      id: "PROFIT_FACTOR",
      label: "Forward profit factor",
      passed: finite(evidence.profitFactor) >= policy.minProfitFactor,
      observed: format(evidence.profitFactor),
      required: `>= ${policy.minProfitFactor}`,
      reason:
        finite(evidence.profitFactor) >= policy.minProfitFactor
          ? "Gross winning PnL exceeds gross losing PnL by the current policy margin."
          : "The forward sample does not yet show the required PnL efficiency.",
    },
    {
      id: "EXPECTANCY",
      label: "Forward expectancy per trade",
      passed: finite(evidence.expectancyPerTrade) >= policy.minExpectancyPerTrade,
      observed: format(evidence.expectancyPerTrade),
      required: `>= ${policy.minExpectancyPerTrade}`,
      reason:
        finite(evidence.expectancyPerTrade) >= policy.minExpectancyPerTrade
          ? "Average realized PnL per closed shadow trade is non-negative under the current evidence model."
          : "Average realized PnL per closed shadow trade is negative.",
    },
    {
      id: "DRAWDOWN",
      label: "Maximum forward drawdown",
      passed: finite(evidence.maxDrawdownPercent) <= policy.maxDrawdownPercent,
      observed: format(evidence.maxDrawdownPercent, "%"),
      required: `<= ${policy.maxDrawdownPercent}%`,
      reason:
        finite(evidence.maxDrawdownPercent) <= policy.maxDrawdownPercent
          ? "Observed forward drawdown stayed inside the evidence ceiling."
          : "Observed forward drawdown breached the evidence ceiling.",
    },
    {
      id: "RUNTIME_HEALTH",
      label: "Runtime operational health",
      passed: !["ERROR", "HALTED"].includes(evidence.status),
      observed: evidence.status,
      required: "not ERROR/HALTED",
      reason:
        !["ERROR", "HALTED"].includes(evidence.status)
          ? "The shadow runtime is not currently in an operationally blocked state."
          : "Forward evidence cannot be promoted while the runtime is operationally blocked.",
    },
  ];

  const complete = gates.every((gate) => gate.passed);
  const hasSample =
    evidence.closedTrades >= policy.minClosedTrades ||
    evidence.forwardCalendarDays >= policy.minForwardCalendarDays;

  return {
    status: complete
      ? "PROVISIONALLY_VALIDATED"
      : hasSample
        ? "FAILED"
        : "INSUFFICIENT_EVIDENCE",
    policy: { ...policy },
    evidence: {
      runtimeId: evidence.runtimeId,
      strategyId: evidence.strategyId,
      strategyVersion: evidence.strategyVersion,
      symbol: evidence.symbol,
      status: evidence.status,
      forwardCalendarDays: evidence.forwardCalendarDays,
      observationCount: evidence.observationCount,
      closedTrades: evidence.closedTrades,
      winRatePercent: evidence.winRatePercent,
      profitFactor: evidence.profitFactor,
      expectancyPerTrade: evidence.expectancyPerTrade,
      totalPnl: evidence.totalPnl,
      totalFees: evidence.totalFees,
      maxDrawdownPercent: evidence.maxDrawdownPercent,
      latestEquity: evidence.latestEquity,
    },
    gates,
    evaluatedAt,
  };
}