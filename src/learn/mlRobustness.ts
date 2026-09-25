import type { LearningFeatureDatasetRow } from "./dataset";
import type { LearningTradeRecord } from "./types";
import { buildLearningFeatureDataset } from "./dataset";
import { FirstMlExperiment } from "./mlBaseline";
import type { MlExperimentResult } from "./mlBaseline";

export interface MlRobustnessFold {
  fold: number;
  trainRows: number;
  validationRows: number;
  testRows: number;
  selectedThreshold: number | null;
  model: MlExperimentResult["model"];
  test: MlExperimentResult["test"];
  deterministicTest: MlExperimentResult["deterministicTest"];
  modelFilteredTest: MlExperimentResult["modelFilteredTest"];
}

export interface MlRobustnessResult {
  status: "READY" | "INSUFFICIENT_HISTORY";
  requiredRows: number;
  foldsRequired: number;
  foldsCompleted: number;
  totalTestRows: number;
  meanTestLogLoss: number;
  meanTestBrierScore: number;
  meanTestRocAuc: number | null;
  positiveFilteredPnlFoldRate: number;
  deterministicPnlUsd: number;
  filteredPnlUsd: number;
  stableAcrossFolds: boolean;
  folds: MlRobustnessFold[];
  notes: string[];
}

const TRAIN_ROWS = 90;
const VALIDATION_ROWS = 30;
const TEST_ROWS = 30;
const STEP_ROWS = 30;
const REQUIRED_FOLDS = 3;
const REQUIRED_ROWS =
  TRAIN_ROWS +
  VALIDATION_ROWS +
  TEST_ROWS +
  STEP_ROWS * (REQUIRED_FOLDS - 1);

function rowToFeatures(row: LearningFeatureDatasetRow) {
  return {
    schemaVersion: 1 as const,
    decisionTimestamp: row.decisionTimestamp,
    asset: row.asset,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    signalDirection:
      row.features.signal_direction === -1
        ? "SHORT" as const
        : row.features.signal_direction === 1
          ? "LONG" as const
          : "NEUTRAL" as const,
    signalScore: Number(row.features.signal_score) || 0,
    eligible: true,
    price: 0,
    priceVsEma9Pct: row.features.price_vs_ema9_pct,
    priceVsEma21Pct: row.features.price_vs_ema21_pct,
    priceVsEma50Pct: row.features.price_vs_ema50_pct,
    ema9Vs21Pct: row.features.ema9_vs_21_pct,
    ema21Vs50Pct: row.features.ema21_vs_50_pct,
    rsi: row.features.rsi,
    macd: null,
    macdSignal: null,
    macdHist: row.features.macd_hist,
    bollingerPosition: row.features.bollinger_position,
    bollingerWidthPct: row.features.bollinger_width_pct,
    atrPct: row.features.atr_pct,
    volumeRatio: row.features.volume_ratio,
    candleReturnPct: row.features.candle_return_pct,
    candleRangePct: null,
    candleBodyToRange: row.features.candle_body_to_range,
    trendAlignment: Number(row.features.trend_alignment) as -1 | 0 | 1,
    momentumAlignment: Number(row.features.momentum_alignment) as -1 | 0 | 1,
    rsiAlignment: Number(row.features.rsi_alignment) as -1 | 0 | 1,
    volatilityStructureAlignment: Number(row.features.volatility_structure_alignment) as -1 | 0 | 1,
    volumeConfirmed: Number(row.features.volume_confirmed) === 1,
    spreadBps: row.features.spread_bps,
    marketOpen: row.features.market_open === null ? null : Number(row.features.market_open) === 1,
    marketDataTimestamp: row.decisionTimestamp,
    marketDataSource: "LIVE_MARKET_DATA" as const,
    marketDataAgeMs: row.features.market_data_age_ms,
  };
}

function rowToRecord(row: LearningFeatureDatasetRow): LearningTradeRecord {
  return {
    tradeId: row.tradeId,
    recordedAt: row.recordedAt,
    asset: row.asset,
    side: row.features.signal_direction === -1 ? "SHORT" : "LONG",
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    strategyName: row.strategyId,
    signalScore: Number(row.features.signal_score) || 0,
    entryPrice: 0,
    exitPrice: 0,
    quantity: 0,
    sizeUsd: 0,
    feesUsd: 0,
    slippageUsd: 0,
    pnlUsd: row.pnlUsd,
    pnlPercent: row.pnlPercent,
    outcome: row.outcome,
    entryTime: row.entryTime,
    exitTime: row.exitTime,
    holdingPeriodMs: row.holdingPeriodMs,
    exitStatus: "CLOSED_MANUAL",
    rationale: "Rolling research reconstruction.",
    features: rowToFeatures(row),
  };
}

export class MlRollingRobustness {
  public static run(records: LearningTradeRecord[]): MlRobustnessResult {
    const dataset = buildLearningFeatureDataset(records);
    const rows = dataset.rows
      .slice()
      .sort((a, b) => a.decisionTimestamp - b.decisionTimestamp);

    if (rows.length < REQUIRED_ROWS) {
      return {
        status: "INSUFFICIENT_HISTORY",
        requiredRows: REQUIRED_ROWS,
        foldsRequired: REQUIRED_FOLDS,
        foldsCompleted: 0,
        totalTestRows: 0,
        meanTestLogLoss: 0,
        meanTestBrierScore: 0,
        meanTestRocAuc: null,
        positiveFilteredPnlFoldRate: 0,
        deterministicPnlUsd: 0,
        filteredPnlUsd: 0,
        stableAcrossFolds: false,
        folds: [],
        notes: [
          "At least " + REQUIRED_ROWS + " valid live-market feature rows are required for rolling robustness.",
        ],
      };
    }

    const folds: MlRobustnessFold[] = [];
    for (
      let start = 0;
      start + TRAIN_ROWS + VALIDATION_ROWS + TEST_ROWS <= rows.length &&
      folds.length < REQUIRED_FOLDS;
      start += STEP_ROWS
    ) {
      const window = rows.slice(
        start,
        start + TRAIN_ROWS + VALIDATION_ROWS + TEST_ROWS,
      );
      const result = FirstMlExperiment.run(window.map(rowToRecord));
      if (result.status !== "READY") continue;

      folds.push({
        fold: folds.length + 1,
        trainRows: TRAIN_ROWS,
        validationRows: VALIDATION_ROWS,
        testRows: TEST_ROWS,
        selectedThreshold: result.selectedThreshold,
        model: result.model,
        test: result.test,
        deterministicTest: result.deterministicTest,
        modelFilteredTest: result.modelFilteredTest,
      });
    }

    const aucs = folds
      .map((fold) => fold.test?.rocAuc)
      .filter((value): value is number => value !== null);
    const positivePnlFolds = folds.filter(
      (fold) => (fold.modelFilteredTest?.totalPnlUsd || 0) > 0,
    ).length;
    const deterministicPnlUsd = Number(
      folds.reduce(
        (sum, fold) => sum + (fold.deterministicTest?.totalPnlUsd || 0),
        0,
      ).toFixed(2),
    );
    const filteredPnlUsd = Number(
      folds.reduce(
        (sum, fold) => sum + (fold.modelFilteredTest?.totalPnlUsd || 0),
        0,
      ).toFixed(2),
    );

    return {
      status: folds.length === REQUIRED_FOLDS ? "READY" : "INSUFFICIENT_HISTORY",
      requiredRows: REQUIRED_ROWS,
      foldsRequired: REQUIRED_FOLDS,
      foldsCompleted: folds.length,
      totalTestRows: folds.reduce((sum, fold) => sum + (fold.test?.rows || 0), 0),
      meanTestLogLoss: folds.length
        ? Number(
            (
              folds.reduce((sum, fold) => sum + (fold.test?.logLoss || 0), 0) /
              folds.length
            ).toFixed(6),
          )
        : 0,
      meanTestBrierScore: folds.length
        ? Number(
            (
              folds.reduce((sum, fold) => sum + (fold.test?.brierScore || 0), 0) /
              folds.length
            ).toFixed(6),
          )
        : 0,
      meanTestRocAuc: aucs.length
        ? Number((aucs.reduce((sum, value) => sum + value, 0) / aucs.length).toFixed(6))
        : null,
      positiveFilteredPnlFoldRate: folds.length
        ? Number((positivePnlFolds / folds.length).toFixed(4))
        : 0,
      deterministicPnlUsd,
      filteredPnlUsd,
      stableAcrossFolds:
        folds.length === REQUIRED_FOLDS &&
        folds.every((fold) => (fold.modelFilteredTest?.tradesTaken || 0) > 0),
      folds,
      notes: [
        "Each rolling fold independently selects model settings and thresholds using only earlier data.",
        "Class weighting and probability calibration are repeated inside each fold.",
        "Rolling evidence is descriptive research evidence and cannot promote or deploy the model.",
      ],
    };
  }
}
