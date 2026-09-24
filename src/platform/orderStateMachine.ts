import type { OrderStatus } from "./types";

const transitions: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  PENDING_SUBMIT: new Set(["PENDING_SUBMIT", "SUBMITTED", "PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING", "CANCELLED", "REJECTED", "EXPIRED", "UNKNOWN_RECONCILIATION", "SUBMISSION_FAILED"]),
  SUBMITTED: new Set(["SUBMITTED", "PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING", "CANCELLED", "REJECTED", "EXPIRED", "UNKNOWN_RECONCILIATION"]),
  PARTIALLY_FILLED: new Set(["PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING", "CANCELLED", "EXPIRED", "UNKNOWN_RECONCILIATION"]),
  CANCEL_PENDING: new Set(["CANCEL_PENDING", "SUBMITTED", "PARTIALLY_FILLED", "CANCELLED", "FILLED", "EXPIRED", "UNKNOWN_RECONCILIATION"]),
  FILLED: new Set(["FILLED"]),
  CANCELLED: new Set(["CANCELLED"]),
  REJECTED: new Set(["REJECTED"]),
  EXPIRED: new Set(["EXPIRED"]),
  UNKNOWN_RECONCILIATION: new Set(["UNKNOWN_RECONCILIATION", "SUBMITTED", "PARTIALLY_FILLED", "FILLED", "CANCEL_PENDING", "CANCELLED", "REJECTED", "EXPIRED"]),
  SUBMISSION_FAILED: new Set(["SUBMISSION_FAILED"]),
};

export function canTransitionOrderStatus(current: OrderStatus, incoming: OrderStatus): boolean {
  return transitions[current]?.has(incoming) ?? false;
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === "FILLED" || status === "CANCELLED" || status === "REJECTED" || status === "EXPIRED" || status === "SUBMISSION_FAILED";
}
