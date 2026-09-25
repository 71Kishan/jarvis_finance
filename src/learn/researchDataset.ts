import type { LearningTradeRecord } from "./types";
import {
  buildLearningFeatureDataset,
  LEARNING_FEATURE_NAMES,
  LearningFeatureDataset,
  LearningFeatureDatasetRow,
  toNumericFeatureVector,
} from "./dataset";
import { LEARNING_FEATURE_SCHEMA_VERSION, DecisionFeatureSnapshot } from "./features";

export const LEARNING_RESEARCH_MIN_ROWS = 90 as const;

export interface FeatureQualityStat {
  name: string;
  nonNull: number;
  missing: number;
  uniqueValues: number;
  min: number | null;
  max: number | null;
  constant: boolean;
}

export interface LearningFeatureAudit {
  schemaVersion: typeof LEARNING_FEATURE_SCHEMA_VERSION;
  rowsConsidered: number;
  rowsValid: number;
  rowsInvalid: number;
  rowsMissingFeatures: number;
  leakageIssues: string[];
  duplicateTradeIds: number;
  featureStats: FeatureQualityStat[];
  isUsable: boolean;
}

export interface LearningFeatureSplit {
  totalRows: number;
  train: LearningFeatureDatasetRow[];
  validation: LearningFeatureDatasetRow[];
  test: LearningFeatureDatasetRow[];
}

export interface LearningFeatureResearchPreparation {
  dataset: LearningFeatureDataset;
  audit: LearningFeatureAudit;
  split: LearningFeatureSplit;
  readyForFirstExperiment: boolean;
  blockedReasons: string[];
}

const TARGET_FIELD_NAMES = new Set([
  "outcome",
  "pnl",
  "pnl_usd",
  "pnl_percent",
  "exit_price",
  "exit_time",
  "holding_period_ms",
  "trade_id",
]);

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? Number(value)
    : null;
}

function auditRecord(
  record: LearningTradeRecord,
  expectedFeatureNames: readonly string[],
  duplicateIds: Set<string>,
): string[] {
  const issues: string[] = [];
  if (!record.features) {
    issues.push("missing_features");
    return issues;
  }

  if (record.features.schemaVersion !== LEARNING_FEATURE_SCHEMA_VERSION) {
    issues.push(`unsupported_feature_schema:${record.features.schemaVersion}`);
  }
  if (!Number.isFinite(record.features.decisionTimestamp)) {
    issues.push("invalid_decision_timestamp");
  }
  if (!Number.isFinite(record.entryTime) || record.features.decisionTimestamp > record.entryTime) {
    issues.push("decision_after_entry");
  }
  if (!Number.isFinite(record.exitTime) || record.exitTime < record.entryTime) {
    issues.push("invalid_exit_time");
  }
  if (!Number.isFinite(record.pnlUsd) || !Number.isFinite(record.pnlPercent)) {
    issues.push("invalid_target");
  }

  const numericVector = toNumericFeatureVector(record.features);
  const vectorKeys = Object.keys(numericVector);
  for (const [name, value] of Object.entries(numericVector)) {
    if (value !== null && !Number.isFinite(value)) {
      issues.push(`non_finite_feature:${name}`);
    }
  }

  const unknown = vectorKeys.filter((name) => !expectedFeatureNames.includes(name as typeof LEARNING_FEATURE_NAMES[number]));
  const missing = expectedFeatureNames.filter((name) => !vectorKeys.includes(name));
  if (unknown.length) issues.push(`unknown_features:${unknown.join(",")}`);
  if (missing.length) issues.push(`missing_feature_names:${missing.join(",")}`);

  for (const name of vectorKeys) {
    if (TARGET_FIELD_NAMES.has(name)) issues.push(`target_field_in_features:${name}`);
  }

  if (duplicateIds.has(record.tradeId)) issues.push("duplicate_trade_id");

  const age = finiteOrNull(record.features.marketDataAgeMs);
  if (age !== null && age < 0) issues.push("negative_market_data_age");
  const spread = finiteOrNull(record.features.spreadBps);
  if (spread !== null && spread < 0) issues.push("negative_spread");
  const volumeRatio = finiteOrNull(record.features.volumeRatio);
  if (volumeRatio !== null && volumeRatio < 0) issues.push("negative_volume_ratio");
  const atrPct = finiteOrNull(record.features.atrPct);
  if (atrPct !== null && atrPct < 0) issues.push("negative_atr");

  return issues;
}

export function auditLearningFeatureDataset(
  records: LearningTradeRecord[],
): LearningFeatureAudit {
  const sorted = records
    .filter((record) => record && Number.isFinite(record.recordedAt))
    .slice()
    .sort((a, b) => (a.features?.decisionTimestamp ?? a.recordedAt) - (b.features?.decisionTimestamp ?? b.recordedAt));

  const ids = sorted.map((record) => record.tradeId);
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicateIds.add(id);
    seen.add(id);
  }

  const dataset = buildLearningFeatureDataset(sorted);
  const issues = new Set<string>();
  let rowsValid = 0;
  let rowsMissingFeatures = 0;

  for (const record of sorted) {
    const rowIssues = auditRecord(record, dataset.featureNames, duplicateIds);
    for (const issue of rowIssues) issues.add(issue);
    if (!record.features) rowsMissingFeatures += 1;
    else if (rowIssues.length === 0) rowsValid += 1;
  }

  const featureStats: FeatureQualityStat[] = dataset.featureNames.map((name) => {
    const values = dataset.rows
      .map((row) => finiteOrNull(row.features[name]))
      .filter((value): value is number => value !== null);
    const uniqueValues = new Set(values.map((value) => value.toString())).size;
    return {
      name,
      nonNull: values.length,
      missing: dataset.rows.length - values.length,
      uniqueValues,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      constant: values.length > 0 && uniqueValues <= 1,
    };
  });

  const leakageIssues = Array.from(issues).filter((issue) =>
    issue.includes("target_field") ||
    issue.includes("decision_after_entry") ||
    issue.includes("unsupported_feature_schema") ||
    issue.includes("unknown_features") ||
    issue.includes("missing_feature_names") ||
    issue.includes("non_finite_feature"),
  );

  const rowsInvalid = sorted.length - rowsValid - rowsMissingFeatures;

  return {
    schemaVersion: LEARNING_FEATURE_SCHEMA_VERSION,
    rowsConsidered: sorted.length,
    rowsValid,
    rowsInvalid: Math.max(0, rowsInvalid),
    rowsMissingFeatures,
    leakageIssues,
    duplicateTradeIds: duplicateIds.size,
    featureStats,
    isUsable:
      dataset.rows.length >= LEARNING_RESEARCH_MIN_ROWS &&
      rowsValid >= LEARNING_RESEARCH_MIN_ROWS &&
      leakageIssues.length === 0 &&
      duplicateIds.size === 0,
  };
}

export function splitLearningFeatureDataset(
  dataset: LearningFeatureDataset,
  ratios = { train: 0.6, validation: 0.2, test: 0.2 },
): LearningFeatureSplit {
  const rows = dataset.rows
    .slice()
    .sort((a, b) => a.decisionTimestamp - b.decisionTimestamp);

  const totalRatio = ratios.train + ratios.validation + ratios.test;
  if (
    !Number.isFinite(totalRatio) ||
    totalRatio <= 0 ||
    ratios.train <= 0 ||
    ratios.validation <= 0 ||
    ratios.test <= 0
  ) {
    throw new Error("Split ratios must be positive finite values.");
  }

  const trainEnd = Math.max(1, Math.floor(rows.length * (ratios.train / totalRatio)));
  const validationEnd = Math.max(
    trainEnd + 1,
    Math.floor(rows.length * ((ratios.train + ratios.validation) / totalRatio)),
  );

  return {
    totalRows: rows.length,
    train: rows.slice(0, Math.min(trainEnd, rows.length)),
    validation: rows.slice(Math.min(trainEnd, rows.length), Math.min(validationEnd, rows.length)),
    test: rows.slice(Math.min(validationEnd, rows.length)),
  };
}

export function prepareLearningFeatureResearch(
  records: LearningTradeRecord[],
  ratios?: { train: number; validation: number; test: number },
): LearningFeatureResearchPreparation {
  const dataset = buildLearningFeatureDataset(records);
  const audit = auditLearningFeatureDataset(records);
  const split = splitLearningFeatureDataset(dataset, ratios);
  const blockedReasons: string[] = [];

  if (audit.rowsValid < LEARNING_RESEARCH_MIN_ROWS) {
    blockedReasons.push(`Need at least ${LEARNING_RESEARCH_MIN_ROWS} valid feature rows; currently have ${audit.rowsValid}.`);
  }
  if (audit.leakageIssues.length) {
    blockedReasons.push("Feature leakage/schema audit has unresolved issues.");
  }
  if (audit.duplicateTradeIds > 0) {
    blockedReasons.push("Duplicate trade IDs must be resolved before experimentation.");
  }

  return {
    dataset,
    audit,
    split,
    readyForFirstExperiment: blockedReasons.length === 0,
    blockedReasons,
  };
}
