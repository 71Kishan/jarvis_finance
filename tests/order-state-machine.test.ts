import { describe, expect, test } from "bun:test";
import { canTransitionOrderStatus, isTerminalOrderStatus } from "../src/platform/orderStateMachine";

describe("order state machine execution safety", () => {
  test("allows pre-submit failure but does not allow resurrection from terminal states", () => {
    expect(canTransitionOrderStatus("PENDING_SUBMIT", "SUBMISSION_FAILED")).toBe(true);
    expect(canTransitionOrderStatus("SUBMISSION_FAILED", "SUBMITTED")).toBe(false);
    expect(canTransitionOrderStatus("FILLED", "CANCELLED")).toBe(false);
    expect(isTerminalOrderStatus("SUBMISSION_FAILED")).toBe(true);
  });

  test("unknown reconciliation can only resolve through an explicit reconciled status", () => {
    expect(canTransitionOrderStatus("UNKNOWN_RECONCILIATION", "SUBMITTED")).toBe(true);
    expect(canTransitionOrderStatus("UNKNOWN_RECONCILIATION", "PARTIALLY_FILLED")).toBe(true);
    expect(canTransitionOrderStatus("UNKNOWN_RECONCILIATION", "FILLED")).toBe(true);
    expect(canTransitionOrderStatus("UNKNOWN_RECONCILIATION", "UNKNOWN_RECONCILIATION")).toBe(true);
  });
});
