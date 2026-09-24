import { describe, expect, test } from "bun:test";
import { DEFAULT_STRATEGY } from "../src/engine/tradingEngine";
import {
  DEFAULT_STRATEGY_VALIDATION_POLICY,
  evaluateStrategyValidation,
} from "../src/engine/strategyValidation";
import {
  DEFAULT_PORTFOLIO_RISK_POLICY,
  evaluateSpotPortfolioRisk,
} from "../src/platform/portfolioRisk";
import { subtractDecimals } from "../src/platform/decimal";

describe("deterministic strategy validation", () => {
  const baseResult = {
    strategyName: DEFAULT_STRATEGY.name,
    totalTrades: 40,
    winRate: 52,
    totalPnl: 180,
    profitFactor: 1.3,
    maxDrawdown: 6,
    sharpeRatio: 0.4,
    verdict: "SURVIVED_AND_PROFITABLE" as const,
  };

  test("does not promote a strategy when rolling OOS evidence is missing", () => {
    const result = evaluateStrategyValidation({
      bestStrategy: DEFAULT_STRATEGY,
      bestResult: baseResult,
      walkForwardReliable: false,
    });

    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.gates.some((gate) => gate.id === "WALK_FORWARD_FOLDS" && !gate.passed)).toBe(true);
  });

  test("rejects a strategy when OOS drawdown breaches the promotion gate", () => {
    const result = evaluateStrategyValidation({
      bestStrategy: DEFAULT_STRATEGY,
      bestResult: baseResult,
      walkForwardReliable: true,
      walkForwardSummary: {
        folds: 4,
        selectedFolds: 4,
        selectedFoldHitRatePercent: 75,
        meanOosReturnPercent: 0.8,
        medianOosReturnPercent: 0.4,
        worstOosDrawdownPercent: 12,
        oosCalendarDays: 60,
      },
    });

    expect(result.status).toBe("FAILED");
    expect(result.gates.find((gate) => gate.id === "OOS_DRAWDOWN")?.passed).toBe(false);
  });

  test("promotes only when every deterministic evidence gate passes", () => {
    const result = evaluateStrategyValidation({
      bestStrategy: DEFAULT_STRATEGY,
      bestResult: baseResult,
      walkForwardReliable: true,
      walkForwardSummary: {
        folds: DEFAULT_STRATEGY_VALIDATION_POLICY.minWalkForwardFolds,
        selectedFolds: DEFAULT_STRATEGY_VALIDATION_POLICY.minSelectedFolds,
        selectedFoldHitRatePercent: 66.7,
        meanOosReturnPercent: 0.7,
        medianOosReturnPercent: 0.3,
        worstOosDrawdownPercent: 7.5,
        oosCalendarDays: 45,
      },
    });

    expect(result.status).toBe("PROVISIONALLY_VALIDATED");
    expect(result.gates.every((gate) => gate.passed)).toBe(true);
  });
});

describe("spot portfolio risk", () => {
  const balances = [
    {
      accountId: "account-1",
      asset: "USDT",
      free: "8000",
      locked: "0",
      total: "8000",
      updatedAt: 1,
    },
    {
      accountId: "account-1",
      asset: "BTC",
      free: "0.02",
      locked: "0",
      total: "0.02",
      updatedAt: 1,
    },
  ];

  test("allows a candidate within gross, concentration and cash-reserve limits", () => {
    const result = evaluateSpotPortfolioRisk({
      baseCurrency: "USDT",
      balances,
      marks: [{ asset: "BTC", valueInBaseCurrency: "100000", updatedAt: 1 }],
      policy: DEFAULT_PORTFOLIO_RISK_POLICY,
      candidate: {
        side: "BUY",
        type: "LIMIT",
        asset: "BTC",
        quoteAsset: "USDT",
        notionalInBaseCurrency: "400",
      },
    });

    expect(result.snapshot.equity).toBe("10000");
    expect(result.allowed).toBe(true);
    expect(result.projected.candidateAssetExposurePercent).toBe("24.00");
  });

  test("blocks a candidate that would breach single-asset concentration", () => {
    const result = evaluateSpotPortfolioRisk({
      baseCurrency: "USDT",
      balances,
      marks: [{ asset: "BTC", valueInBaseCurrency: "100000", updatedAt: 1 }],
      candidate: {
        side: "BUY",
        type: "MARKET",
        asset: "BTC",
        quoteAsset: "USDT",
        notionalInBaseCurrency: "1000",
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("BTC exposure");
  });

  test("fails closed when an existing non-zero asset has no trusted mark", () => {
    const result = evaluateSpotPortfolioRisk({
      baseCurrency: "USDT",
      balances: [
        ...balances,
        {
          accountId: "account-1",
          asset: "XYZ",
          free: "10",
          locked: "0",
          total: "10",
          updatedAt: 1,
        },
      ],
      marks: [{ asset: "BTC", valueInBaseCurrency: "100000", updatedAt: 1 }],
      candidate: {
        side: "BUY",
        type: "LIMIT",
        asset: "BTC",
        quoteAsset: "USDT",
        notionalInBaseCurrency: "100",
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.snapshot.complete).toBe(false);
    expect(result.reasons.join(" ")).toContain("XYZ");
  });

  test("fails closed for a candidate quoted in a different currency", () => {
    const result = evaluateSpotPortfolioRisk({
      baseCurrency: "USDT",
      balances,
      marks: [{ asset: "BTC", valueInBaseCurrency: "100000", updatedAt: 1 }],
      candidate: {
        side: "BUY",
        type: "LIMIT",
        asset: "ETH",
        quoteAsset: "BTC",
        notionalInBaseCurrency: "100",
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain("not the configured portfolio base currency");
  });
});

describe("exact decimal arithmetic", () => {
  test("subtracts without floating point rounding", () => {
    expect(subtractDecimals("100.00000001", "0.00000002")).toBe("99.99999999");
    expect(subtractDecimals("5", "5")).toBe("0");
  });
});
