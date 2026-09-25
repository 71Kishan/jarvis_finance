import type { Candle, StrategyConfig } from "../types/trading";
import type { LearningTradeRecord } from "./types";
import { StrategyOptimizer } from "../engine/optimizer";
import { generateResearchCandidates } from "./candidateGenerator";

export type ResearchStatus =
  | "INSUFFICIENT_HISTORY"
  | "INSUFFICIENT_LEARNING_DATA"
  | "RESEARCH_ONLY"
  | "REVIEW_REQUIRED";

export interface LearningDatasetSummary {
  tradeRecords: number;
  wins: number;
  losses: number;
  flats: number;
  strategiesObserved: number;
  totalPnlUsd: number;
  sampleStartAt: number | null;
  sampleEndAt: number | null;
}

export interface ResearchCandidateResult {
  strategy: StrategyConfig;
  train: ReturnType<typeof StrategyOptimizer.backtest>;
  validation: ReturnType<typeof StrategyOptimizer.backtest>;
  test: ReturnType<typeof StrategyOptimizer.backtest>;
  selectionScore: number;
}

export interface LearningResearchResult {
  status: ResearchStatus;
  dataset: LearningDatasetSummary;
  historyBars: number;
  candidates: ResearchCandidateResult[];
  proposedCandidate: StrategyConfig | null;
  proposedTestResult: ReturnType<typeof StrategyOptimizer.backtest> | null;
  gates: {
    minimumHistoryBars: boolean;
    minimumLearningTrades: boolean;
    candidateHasValidationEvidence: boolean;
    candidateHasHeldOutTest: boolean;
  };
  notes: string[];
}

export class LearningResearchLoop {
  public static summarizeDataset(records: LearningTradeRecord[]): LearningDatasetSummary {
    const sorted = records
      .filter((record) => record && Number.isFinite(record.recordedAt))
      .slice()
      .sort((a, b) => a.recordedAt - b.recordedAt);

    const wins = sorted.filter((record) => record.outcome === "WIN").length;
    const losses = sorted.filter((record) => record.outcome === "LOSS").length;
    const flats = sorted.filter((record) => record.outcome === "FLAT").length;
    const strategies = new Set(sorted.map((record) => record.strategyId));
    const totalPnlUsd = sorted.reduce((sum, record) => sum + (Number(record.pnlUsd) || 0), 0);

    return {
      tradeRecords: sorted.length,
      wins,
      losses,
      flats,
      strategiesObserved: strategies.size,
      totalPnlUsd: Number(totalPnlUsd.toFixed(2)),
      sampleStartAt: sorted[0]?.recordedAt ?? null,
      sampleEndAt: sorted[sorted.length - 1]?.recordedAt ?? null,
    };
  }

  /**
   * Run a reproducible research experiment. No result mutates the active
   * strategy and no result is an authorization to deploy or trade.
   */
  public static run(
    baseStrategy: StrategyConfig,
    candles: Candle[],
    learningRecords: LearningTradeRecord[],
  ): LearningResearchResult {
    const dataset = this.summarizeDataset(learningRecords);
    const minimumHistoryBars = candles.length >= 360;
    const minimumLearningTrades = dataset.tradeRecords >= 30;

    if (!minimumHistoryBars) {
      return {
        status: "INSUFFICIENT_HISTORY",
        dataset,
        historyBars: candles.length,
        candidates: [],
        proposedCandidate: null,
        proposedTestResult: null,
        gates: {
          minimumHistoryBars,
          minimumLearningTrades,
          candidateHasValidationEvidence: false,
          candidateHasHeldOutTest: false,
        },
        notes: [
          "At least 360 bars are required for the current 60/20/20 walk-forward research split.",
          "No candidate is generated from insufficient history.",
        ],
      };
    }

    const candidates = generateResearchCandidates(baseStrategy);
    const trainEnd = Math.floor(candles.length * 0.6);
    const validationEnd = Math.floor(candles.length * 0.8);

    const results: ResearchCandidateResult[] = candidates.map((strategy) => {
      const train = StrategyOptimizer.backtest(strategy, candles.slice(0, trainEnd));
      const validation = StrategyOptimizer.backtest(
        strategy,
        candles.slice(Math.max(0, trainEnd - 60), validationEnd),
      );
      const test = StrategyOptimizer.backtest(
        strategy,
        candles.slice(Math.max(0, validationEnd - 60)),
      );

      const selectionScore =
        (train.totalTrades >= 20 ? 1 : 0) +
        (train.totalPnl > 0 ? 1 : 0) +
        (validation.totalTrades >= 20 ? 2 : validation.totalTrades >= 10 ? 1 : 0) +
        (validation.totalPnl > 0 ? 2 : 0) +
        (validation.profitFactor >= 1.2 ? 1 : 0) +
        (validation.sharpeRatio > 0 ? 1 : 0) +
        (validation.maxDrawdown < 10 ? 1 : 0);

      return { strategy, train, validation, test, selectionScore };
    });

    const ordered = results.slice().sort(
      (a, b) =>
        b.selectionScore - a.selectionScore ||
        b.validation.sharpeRatio - a.validation.sharpeRatio ||
        b.validation.totalPnl - a.validation.totalPnl ||
        a.strategy.id.localeCompare(b.strategy.id),
    );
    const proposed = minimumLearningTrades ? (ordered[0] ?? null) : null;

    const candidateHasValidationEvidence = Boolean(
      proposed &&
      proposed.validation.totalTrades > 0 &&
      proposed.validation.sampleDays !== undefined,
    );
    const candidateHasHeldOutTest = Boolean(proposed && proposed.test.sampleDays !== undefined);

    return {
      status: proposed && candidateHasValidationEvidence && candidateHasHeldOutTest
        ? "REVIEW_REQUIRED"
        : "RESEARCH_ONLY",
      dataset,
      historyBars: candles.length,
      candidates: ordered,
      proposedCandidate: proposed?.strategy ?? null,
      proposedTestResult: proposed?.test ?? null,
      gates: {
        minimumHistoryBars,
        minimumLearningTrades,
        candidateHasValidationEvidence,
        candidateHasHeldOutTest,
      },
      notes: [
        "Candidate generation is deterministic and uses small auditable perturbations.",
        "Candidate selection uses train/validation evidence; the held-out test remains outside selection.",
        minimumLearningTrades
          ? "The proposed candidate is a research proposal only and is never auto-promoted."
          : "Historical backtest candidates are shown, but no learning-driven proposal is allowed until at least 30 closed-trade records exist.",
        "Forward paper, shadow testing, and independent review remain required before any deployment gate.",
      ],
    };
  }
}
