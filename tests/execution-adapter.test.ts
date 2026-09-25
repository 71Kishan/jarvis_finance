import { describe, expect, test } from "bun:test";
import { paperExecutionAdapter } from "../src/execution/paperExecutionAdapter";
import type { PaperTradingSettings } from "../src/types/trading";

const settings: PaperTradingSettings = {
  slippageBps: 2,
  feeTierPercent: 0.04,
  leverage: 1,
  soundAlerts: false,
};

describe("paper execution adapter", () => {
  test("models adverse entry and exit slippage by side", () => {
    const longEntry = paperExecutionAdapter.entryFill({
      expectedPrice: 100,
      side: "LONG",
      notionalUsd: 1000,
      settings,
    });
    const longExit = paperExecutionAdapter.exitFill({
      expectedPrice: 100,
      side: "LONG",
      notionalUsd: 1000,
      settings,
    });
    const shortEntry = paperExecutionAdapter.entryFill({
      expectedPrice: 100,
      side: "SHORT",
      notionalUsd: 1000,
      settings,
    });
    const shortExit = paperExecutionAdapter.exitFill({
      expectedPrice: 100,
      side: "SHORT",
      notionalUsd: 1000,
      settings,
    });

    expect(longEntry.fillPrice).toBeCloseTo(100.02, 8);
    expect(longExit.fillPrice).toBeCloseTo(99.98, 8);
    expect(shortEntry.fillPrice).toBeCloseTo(99.98, 8);
    expect(shortExit.fillPrice).toBeCloseTo(100.02, 8);
    expect(longEntry.feeUsd).toBeCloseTo(0.4, 8);
  });

  test("rejects invalid expected prices instead of fabricating a fill", () => {
    expect(() =>
      paperExecutionAdapter.entryFill({
        expectedPrice: 0,
        side: "LONG",
        notionalUsd: 1000,
        settings,
      }),
    ).toThrow("positive finite expected price");
  });

  test("resolves ambiguous OHLC exits conservatively stop-first", () => {
    const result = paperExecutionAdapter.resolveStopTarget(
      "LONG",
      { open: 100, high: 110, low: 90, close: 105 },
      95,
      108,
    );

    expect(result).toEqual({
      kind: "STOP",
      price: 95,
      ambiguous: true,
    });
  });

  test("uses the observed gap-open as the conservative stop fill", () => {
    const result = paperExecutionAdapter.resolveStopTarget(
      "LONG",
      { open: 90, high: 96, low: 89, close: 92 },
      95,
      108,
    );

    expect(result.kind).toBe("STOP");
    expect(result.price).toBe(90);
    expect(result.ambiguous).toBe(false);
  });

  test("keeps gross PnL directionally correct", () => {
    expect(paperExecutionAdapter.grossPnL("LONG", 100, 110, 2)).toBe(20);
    expect(paperExecutionAdapter.grossPnL("SHORT", 100, 90, 2)).toBe(20);
  });
});
