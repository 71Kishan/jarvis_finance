import { describe, expect, test } from "bun:test";
import { evaluateOperationalHealth } from "../src/server/operationalHealth";

const healthyInput = {
  database: { state: "READY", configured: true, lastSuccessfulCheckAt: 1_000 },
  market: { state: "READY", connected: true, lastMessageAt: 1_000 },
  catalog: { state: "READY" },
  testnetConfigured: true,
  userDataStream: { connected: true, subscribed: true, lastEventAt: 1_000, reconnectCount: 0 },
  reconciliation: { lastRunAt: 1_000, lastSuccessAt: 1_000, ordersChecked: 0 },
  paper: { status: "RUNNING", lastPollAt: 1_000, lastProcessedCandleAt: 1_000 },
  shadow: { status: "RUNNING", lastPollAt: 1_000, lastProcessedCandleAt: 1_000 },
  shadowValidation: { status: "PROVISIONALLY_VALIDATED" as const },
};

describe("operational health", () => {
  test("reports healthy when critical dependencies are fresh", () => {
    const result = evaluateOperationalHealth({ ...healthyInput, now: 5_000 });
    expect(result.state).toBe("HEALTHY");
    expect(result.safeToStartShadow).toBe(true);
  });

  test("degrades when market data is stale", () => {
    const result = evaluateOperationalHealth({
      ...healthyInput,
      market: { ...healthyInput.market, lastMessageAt: 0 },
      now: 30_000,
    });
    expect(result.state).toBe("DEGRADED");
    expect(result.components.find((component) => component.id === "MARKET_DATA")?.state).toBe("DEGRADED");
    expect(result.safeToStartShadow).toBe(false);
  });

  test("blocks shadow start when forward validation is not passed", () => {
    const result = evaluateOperationalHealth({
      ...healthyInput,
      shadowValidation: { status: "INSUFFICIENT_EVIDENCE" },
      now: 5_000,
    });
    expect(result.state).toBe("DEGRADED");
    expect(result.safeToStartShadow).toBe(false);
  });

  test("halts when a runtime is explicitly halted", () => {
    const result = evaluateOperationalHealth({
      ...healthyInput,
      shadow: { ...healthyInput.shadow, status: "HALTED" },
      now: 5_000,
    });
    expect(result.state).toBe("HALTED");
  });
});