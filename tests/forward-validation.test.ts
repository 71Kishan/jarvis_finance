import { describe, expect, test } from "bun:test";
import { evaluateForwardValidation, DEFAULT_FORWARD_VALIDATION_POLICY } from "../src/engine/forwardValidation";
import type { ShadowEvidenceSummary } from "../src/platform/platformRepository";

const baseEvidence: ShadowEvidenceSummary = {
  runtimeId: "runtime-1",
  strategyId: "strategy-1",
  strategyVersion: 2,
  symbol: "BTC/USD",
  status: "RUNNING",
  firstObservationAt: 1_700_000_000_000,
  lastObservationAt: 1_700_000_000_000 + 31 * 86_400_000,
  observationCount: 31 * 24,
  forwardCalendarDays: 31,
  maxDrawdownPercent: "8.4",
  latestEquity: "10400",
  closedTrades: 30,
  winningTrades: 18,
  losingTrades: 12,
  winRatePercent: "60.00",
  profitFactor: "1.25",
  expectancyPerTrade: "13.3333",
  totalPnl: "400",
  totalFees: "30",
};

describe("deterministic forward validation", () => {
  test("requires enough time and closed trades", () => {
    const result = evaluateForwardValidation({
      ...baseEvidence,
      closedTrades: 12,
      forwardCalendarDays: 10,
    });

    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.gates.find((gate) => gate.id === "CLOSED_TRADES")?.passed).toBe(false);
    expect(result.gates.find((gate) => gate.id === "FORWARD_CALENDAR")?.passed).toBe(false);
  });

  test("fails when a mature sample violates profit factor or drawdown", () => {
    const result = evaluateForwardValidation({
      ...baseEvidence,
      profitFactor: "0.91",
      maxDrawdownPercent: "12.1",
    });

    expect(result.status).toBe("FAILED");
    expect(result.gates.find((gate) => gate.id === "PROFIT_FACTOR")?.passed).toBe(false);
    expect(result.gates.find((gate) => gate.id === "DRAWDOWN")?.passed).toBe(false);
  });

  test("passes when all forward evidence gates pass", () => {
    const result = evaluateForwardValidation(baseEvidence, DEFAULT_FORWARD_VALIDATION_POLICY);

    expect(result.status).toBe("PROVISIONALLY_VALIDATED");
    expect(result.gates.every((gate) => gate.passed)).toBe(true);
  });

  test("does not treat a runtime halt as promotion-ready", () => {
    const result = evaluateForwardValidation({ ...baseEvidence, status: "HALTED" });

    expect(result.status).toBe("FAILED");
    expect(result.gates.find((gate) => gate.id === "RUNTIME_HEALTH")?.passed).toBe(false);
  });
});