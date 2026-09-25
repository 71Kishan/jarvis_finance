import type { DecisionFeatureSnapshot } from "./features";
import { toNumericFeatureVector } from "./dataset";
import type { LearningFeatureDatasetRow } from "./dataset";
import { LEARNING_FEATURE_NAMES } from "./dataset";
import { LEARNING_RESEARCH_MIN_ROWS, prepareLearningFeatureResearch } from "./researchDataset";
import type { LearningTradeRecord } from "./types";

export type MlExperimentStatus = "READY" | "BLOCKED" | "INSUFFICIENT_CLASS_VARIETY";

export interface LogisticModelConfig {
  regularization: number;
  learningRate: number;
  iterations: number;
  classWeighting: "NONE" | "BALANCED";
}

export interface MlCalibrationMetrics {
  method: "PLATT" | "IDENTITY";
  fitRows: number;
  rawLogLoss: number;
  calibratedLogLoss: number;
  rawBrierScore: number;
  calibratedBrierScore: number;
}

export interface MlClassificationMetrics {
  rows: number;
  wins: number;
  nonWins: number;
  accuracy: number;
  balancedAccuracy: number;
  precision: number;
  recall: number;
  logLoss: number;
  brierScore: number;
  rocAuc: number | null;
}

export interface MlTradingOverlayMetrics {
  rowsConsidered: number;
  tradesTaken: number;
  tradesSkipped: number;
  winRate: number;
  totalPnlUsd: number;
  profitFactor: number;
  maxDrawdownUsd: number;
  averagePnlUsd: number;
}

export interface MlShadowModelArtifact {
  schemaVersion: 1;
  modelType: "LOGISTIC_META_LABELER";
  featureNames: string[];
  means: number[];
  scales: number[];
  weights: number[];
  bias: number;
  calibrationSlope: number;
  calibrationIntercept: number;
  threshold: number;
  config: LogisticModelConfig;
  trainedThrough: number;
  fingerprint: string;
}

export interface MlShadowPrediction {
  modelFingerprint: string;
  probability: number;
  accepted: boolean;
}

export interface MlExperimentResult {
  status: MlExperimentStatus;
  model: LogisticModelConfig | null;
  selectedThreshold: number | null;
  selectedValidationLogLoss: number | null;
  selectedFeatures: string[];
  train: MlClassificationMetrics | null;
  validation: MlClassificationMetrics | null;
  test: MlClassificationMetrics | null;
  rawTest?: MlClassificationMetrics | null;
  baselineTest?: MlClassificationMetrics | null;
  calibration?: MlCalibrationMetrics | null;
  deterministicTest: MlTradingOverlayMetrics | null;
  modelFilteredTest: MlTradingOverlayMetrics | null;
  blockedReasons: string[];
  notes: string[];
}

interface PreparedMatrix {
  names: string[];
  means: number[];
  scales: number[];
  train: number[][];
  validation: number[][];
  test: number[][];
}

interface FittedModel {
  names: string[];
  weights: number[];
  bias: number;
}

const CONFIGS: LogisticModelConfig[] = [
  { regularization: 0.25, learningRate: 0.05, iterations: 700, classWeighting: "NONE" },
  { regularization: 1, learningRate: 0.05, iterations: 700, classWeighting: "NONE" },
  { regularization: 4, learningRate: 0.03, iterations: 900, classWeighting: "NONE" },
  { regularization: 0.25, learningRate: 0.05, iterations: 700, classWeighting: "BALANCED" },
  { regularization: 1, learningRate: 0.05, iterations: 700, classWeighting: "BALANCED" },
  { regularization: 4, learningRate: 0.03, iterations: 900, classWeighting: "BALANCED" },
];

const THRESHOLDS = [0.5, 0.55, 0.6, 0.65];
const EPSILON = 1e-9;

function targetFor(row: LearningFeatureDatasetRow): number {
  return row.outcome === "WIN" ? 1 : 0;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[], average: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function clampProbability(value: number): number {
  return Math.max(EPSILON, Math.min(1 - EPSILON, value));
}

function usableFeatureNames(rows: LearningFeatureDatasetRow[]): string[] {
  return LEARNING_FEATURE_NAMES.filter((name) => {
    const values = rows
      .map((row) => row.features[name])
      .filter((value): value is number => value !== null && Number.isFinite(value));
    return values.length > 0 && new Set(values.map((value) => value.toString())).size > 1;
  });
}

function buildMatrix(
  names: string[],
  trainRows: LearningFeatureDatasetRow[],
  validationRows: LearningFeatureDatasetRow[],
  testRows: LearningFeatureDatasetRow[],
): PreparedMatrix {
  const innerFitCount = Math.max(2, Math.floor(trainRows.length * 0.8));
  const fitRows = trainRows.slice(0, innerFitCount);

  const means = names.map((name) => {
    const values = fitRows
      .map((row) => row.features[name])
      .filter((value): value is number => value !== null && Number.isFinite(value));
    return mean(values);
  });

  const scales = names.map((name, index) => {
    const values = fitRows.map((row) => {
      const value = row.features[name];
      return value !== null && Number.isFinite(value) ? value : means[index];
    });
    const sd = standardDeviation(values, means[index]);
    return sd > EPSILON ? sd : 1;
  });

  const transform = (rows: LearningFeatureDatasetRow[]): number[][] =>
    rows.map((row) =>
      names.map((name, index) => {
        const raw = row.features[name];
        const value = raw !== null && Number.isFinite(raw) ? raw : means[index];
        return (value - means[index]) / scales[index];
      }),
    );

  return {
    names,
    means,
    scales,
    train: transform(trainRows),
    validation: transform(validationRows),
    test: transform(testRows),
  };
}

function fit(
  x: number[][],
  y: number[],
  names: string[],
  config: LogisticModelConfig,
): FittedModel {
  const weights = new Array(names.length).fill(0) as number[];
  const classMean = Math.max(0.001, Math.min(0.999, mean(y)));
  let bias = Math.log(classMean / (1 - classMean));

  const positives = y.filter((value) => value === 1).length;
  const negatives = y.length - positives;
  const positiveWeight = config.classWeighting === "BALANCED" && positives > 0
    ? y.length / (2 * positives)
    : 1;
  const negativeWeight = config.classWeighting === "BALANCED" && negatives > 0
    ? y.length / (2 * negatives)
    : 1;

  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    const grad = new Array(names.length).fill(0) as number[];
    let gradBias = 0;
    let totalWeight = 0;

    for (let rowIndex = 0; rowIndex < x.length; rowIndex += 1) {
      let linear = bias;
      for (let featureIndex = 0; featureIndex < names.length; featureIndex += 1) {
        linear += weights[featureIndex] * x[rowIndex][featureIndex];
      }

      const observationWeight = y[rowIndex] === 1 ? positiveWeight : negativeWeight;
      const error = (sigmoid(linear) - y[rowIndex]) * observationWeight;
      gradBias += error;
      totalWeight += observationWeight;
      for (let featureIndex = 0; featureIndex < names.length; featureIndex += 1) {
        grad[featureIndex] += error * x[rowIndex][featureIndex];
      }
    }

    const normalizer = Math.max(1, totalWeight);
    gradBias /= normalizer;
    for (let featureIndex = 0; featureIndex < names.length; featureIndex += 1) {
      grad[featureIndex] =
        grad[featureIndex] / normalizer +
        config.regularization * weights[featureIndex];
      weights[featureIndex] -= config.learningRate * grad[featureIndex];
    }
    bias -= config.learningRate * gradBias;
  }

  return { names, weights, bias };
}

function rawLogits(model: FittedModel, x: number[][]): number[] {
  return x.map((row) => {
    let linear = model.bias;
    for (let i = 0; i < model.weights.length; i += 1) {
      linear += model.weights[i] * row[i];
    }
    return linear;
  });
}

function predict(model: FittedModel, x: number[][]): number[] {
  return rawLogits(model, x).map((logit) => clampProbability(sigmoid(logit)));
}

function fitPlattCalibration(logits: number[], y: number[]): { slope: number; intercept: number } {
  if (logits.length < 8 || new Set(y).size < 2) return { slope: 1, intercept: 0 };

  let slope = 1;
  let intercept = 0;
  for (let iteration = 0; iteration < 500; iteration += 1) {
    let slopeGradient = 0;
    let interceptGradient = 0;
    for (let i = 0; i < logits.length; i += 1) {
      const p = sigmoid(slope * logits[i] + intercept);
      const error = p - y[i];
      slopeGradient += error * logits[i];
      interceptGradient += error;
    }
    slope -= 0.02 * slopeGradient / logits.length;
    intercept -= 0.02 * interceptGradient / logits.length;
  }
  return { slope, intercept };
}

function calibratedPredict(
  model: FittedModel,
  calibration: { slope: number; intercept: number },
  x: number[][],
): number[] {
  return rawLogits(model, x).map((logit) =>
    clampProbability(sigmoid(calibration.slope * logit + calibration.intercept)),
  );
}

function deterministicHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function shadowVector(
  artifact: MlShadowModelArtifact,
  snapshot: DecisionFeatureSnapshot,
): number[] {
  const numeric = toNumericFeatureVector(snapshot);
  return artifact.featureNames.map((name, index) => {
    const raw = numeric[name];
    const value = raw !== null && Number.isFinite(raw) ? raw : artifact.means[index];
    return (value - artifact.means[index]) / artifact.scales[index];
  });
}

function logLoss(y: number[], p: number[]): number {
  if (!y.length) return 0;
  const loss = mean(y.map((actual, index) => {
    const probability = clampProbability(p[index]);
    return -(actual * Math.log(probability) + (1 - actual) * Math.log(1 - probability));
  }));
  return Number(loss.toFixed(6));
}

function brier(y: number[], p: number[]): number {
  if (!y.length) return 0;
  return Number(mean(y.map((actual, index) => (p[index] - actual) ** 2)).toFixed(6));
}

function auc(y: number[], p: number[]): number | null {
  const positives = y.filter((value) => value === 1).length;
  const negatives = y.length - positives;
  if (!positives || !negatives) return null;

  const ordered = y
    .map((actual, index) => ({ actual, probability: p[index], index }))
    .sort((a, b) => a.probability - b.probability || a.index - b.index);

  let positiveRanks = 0;
  ordered.forEach((item, index) => {
    if (item.actual === 1) positiveRanks += index + 1;
  });

  return Number(
    ((positiveRanks - positives * (positives + 1) / 2) / (positives * negatives)).toFixed(6),
  );
}

function classification(
  rows: LearningFeatureDatasetRow[],
  probabilities: number[],
): MlClassificationMetrics {
  const y = rows.map(targetFor);
  const predictions = probabilities.map((value) => value >= 0.5 ? 1 : 0);
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (let i = 0; i < y.length; i += 1) {
    if (y[i] === 1 && predictions[i] === 1) tp += 1;
    else if (y[i] === 0 && predictions[i] === 0) tn += 1;
    else if (y[i] === 0 && predictions[i] === 1) fp += 1;
    else fn += 1;
  }

  const wins = y.reduce((sum, value) => sum + value, 0);
  const nonWins = y.length - wins;
  const total = Math.max(1, y.length);
  const tpr = wins ? tp / wins : 0;
  const tnr = nonWins ? tn / nonWins : 0;

  return {
    rows: y.length,
    wins,
    nonWins,
    accuracy: Number(((tp + tn) / total).toFixed(4)),
    balancedAccuracy: Number(((tpr + tnr) / 2).toFixed(4)),
    precision: Number((tp / Math.max(1, tp + fp)).toFixed(4)),
    recall: Number(tpr.toFixed(4)),
    logLoss: logLoss(y, probabilities),
    brierScore: brier(y, probabilities),
    rocAuc: auc(y, probabilities),
  };
}

function tradingOverlay(
  rows: LearningFeatureDatasetRow[],
  probabilities: number[],
  threshold: number,
): MlTradingOverlayMetrics {
  const taken = rows.filter((_, index) => probabilities[index] >= threshold);
  const pnl = taken.map((row) => Number(row.pnlUsd) || 0);
  const profits = pnl.filter((value) => value > 0);
  const losses = pnl.filter((value) => value < 0).map((value) => Math.abs(value));

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of pnl) {
    cumulative += value;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }

  const total = Number(pnl.reduce((sum, value) => sum + value, 0).toFixed(2));
  const profitFactor = losses.length
    ? profits.reduce((sum, value) => sum + value, 0) / losses.reduce((sum, value) => sum + value, 0)
    : profits.length ? Infinity : 0;

  return {
    rowsConsidered: rows.length,
    tradesTaken: taken.length,
    tradesSkipped: rows.length - taken.length,
    winRate: taken.length ? Number((profits.length / taken.length * 100).toFixed(2)) : 0,
    totalPnlUsd: total,
    profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(4)) : 999,
    maxDrawdownUsd: Number(maxDrawdown.toFixed(2)),
    averagePnlUsd: taken.length ? Number((total / taken.length).toFixed(4)) : 0,
  };
}

function bothClasses(rows: LearningFeatureDatasetRow[]): boolean {
  const classes = new Set(rows.map(targetFor));
  return classes.has(0) && classes.has(1);
}

function selectModel(
  matrix: PreparedMatrix,
  trainRows: LearningFeatureDatasetRow[],
  validationRows: LearningFeatureDatasetRow[],
): {
  model: FittedModel;
  calibrator: { slope: number; intercept: number };
  config: LogisticModelConfig;
  threshold: number;
  validationLogLoss: number;
  calibration: MlCalibrationMetrics;
} {
  let best: {
    model: FittedModel;
    calibrator: { slope: number; intercept: number };
    config: LogisticModelConfig;
    threshold: number;
    validationLogLoss: number;
    validationBrier: number;
    validationTrades: number;
    validationPnl: number;
  } | null = null;

  const innerFitCount = Math.max(2, Math.floor(trainRows.length * 0.8));
  const yFit = trainRows.slice(0, innerFitCount).map(targetFor);
  const yCalibration = trainRows.slice(innerFitCount).map(targetFor);
  const yValidation = validationRows.map(targetFor);

  for (const config of CONFIGS) {
    const model = fit(
      matrix.train.slice(0, innerFitCount),
      yFit,
      matrix.names,
      config,
    );
    const calibrator = fitPlattCalibration(
      rawLogits(model, matrix.train.slice(innerFitCount)),
      yCalibration,
    );
    const probabilities = calibratedPredict(model, calibrator, matrix.validation);
    const loss = logLoss(yValidation, probabilities);
    const brierScore = brier(yValidation, probabilities);

    for (const threshold of THRESHOLDS) {
      const overlay = tradingOverlay(validationRows, probabilities, threshold);
      const candidate = {
        model,
        calibrator,
        config,
        threshold,
        validationLogLoss: loss,
        validationBrier: brierScore,
        validationTrades: overlay.tradesTaken,
        validationPnl: overlay.totalPnlUsd,
      };

      if (!best ||
        candidate.validationLogLoss < best.validationLogLoss ||
        (candidate.validationLogLoss === best.validationLogLoss && candidate.validationBrier < best.validationBrier) ||
        (candidate.validationLogLoss === best.validationLogLoss && candidate.validationBrier === best.validationBrier && candidate.validationTrades > best.validationTrades) ||
        (candidate.validationLogLoss === best.validationLogLoss && candidate.validationBrier === best.validationBrier && candidate.validationTrades === best.validationTrades && candidate.validationPnl > best.validationPnl)
      ) {
        best = candidate;
      }
    }
  }

  if (!best) throw new Error("No deterministic ML candidate could be selected.");

  const rawCalibration = predict(best.model, matrix.train.slice(innerFitCount));
  const calibratedCalibration = calibratedPredict(best.model, best.calibrator, matrix.train.slice(innerFitCount));

  return {
    model: best.model,
    calibrator: best.calibrator,
    config: best.config,
    threshold: best.threshold,
    validationLogLoss: best.validationLogLoss,
    calibration: {
      method: best.calibrator.slope === 1 && best.calibrator.intercept === 0 ? "IDENTITY" : "PLATT",
      fitRows: yCalibration.length,
      rawLogLoss: logLoss(yCalibration, rawCalibration),
      calibratedLogLoss: logLoss(yCalibration, calibratedCalibration),
      rawBrierScore: brier(yCalibration, rawCalibration),
      calibratedBrierScore: brier(yCalibration, calibratedCalibration),
    },
  };
}

export class FirstMlExperiment {
  public static createShadowModel(records: LearningTradeRecord[]): MlShadowModelArtifact | null {
    const preparation = prepareLearningFeatureResearch(records);
    if (!preparation.readyForFirstExperiment || preparation.split.validation.length === 0) return null;

    const result = FirstMlExperiment.run(records);
    if (result.status !== "READY" || !result.model || !result.selectedThreshold || !result.selectedFeatures.length) {
      return null;
    }

    const historyRows = preparation.split.train.concat(preparation.split.validation);
    if (historyRows.length < 30 || new Set(historyRows.map(targetFor)).size < 2) return null;

    const names = result.selectedFeatures;
    const matrix = buildMatrix(names, historyRows, [], []);
    const innerFitCount = Math.max(2, Math.floor(historyRows.length * 0.8));
    const yFit = historyRows.slice(0, innerFitCount).map(targetFor);
    const yCalibration = historyRows.slice(innerFitCount).map(targetFor);
    const model = fit(matrix.train.slice(0, innerFitCount), yFit, names, result.model);
    const calibrator = fitPlattCalibration(
      rawLogits(model, matrix.train.slice(innerFitCount)),
      yCalibration,
    );

    const artifactBase = {
      schemaVersion: 1 as const,
      modelType: "LOGISTIC_META_LABELER" as const,
      featureNames: names,
      means: matrix.means,
      scales: matrix.scales,
      weights: model.weights,
      bias: model.bias,
      calibrationSlope: calibrator.slope,
      calibrationIntercept: calibrator.intercept,
      threshold: result.selectedThreshold,
      config: result.model,
      trainedThrough: Math.max(...historyRows.map((row) => row.decisionTimestamp)),
    };
    const fingerprint = deterministicHash(JSON.stringify(artifactBase));

    return { ...artifactBase, fingerprint };
  }

  public static predictShadow(
    artifact: MlShadowModelArtifact,
    snapshot: DecisionFeatureSnapshot,
  ): MlShadowPrediction {
    const vector = shadowVector(artifact, snapshot);
    const logit = artifact.bias + artifact.weights.reduce((sum, weight, index) => sum + weight * vector[index], 0);
    const probability = clampProbability(
      sigmoid(artifact.calibrationSlope * logit + artifact.calibrationIntercept),
    );
    return {
      modelFingerprint: artifact.fingerprint,
      probability,
      accepted: probability >= artifact.threshold,
    };
  }

  public static run(records: LearningTradeRecord[]): MlExperimentResult {
    const preparation = prepareLearningFeatureResearch(records);

    if (!preparation.readyForFirstExperiment) {
      return {
        status: "BLOCKED",
        model: null,
        selectedThreshold: null,
        selectedValidationLogLoss: null,
        selectedFeatures: [],
        train: null,
        validation: null,
        test: null,
        deterministicTest: null,
        modelFilteredTest: null,
        blockedReasons: preparation.blockedReasons,
        notes: [
          "No model is fitted while the feature dataset gate is blocked.",
          "The first experiment requires at least 90 valid rows plus a clean leakage/schema audit.",
        ],
      };
    }

    const split = preparation.split;
    if (!bothClasses(split.train)) {
      return {
        status: "INSUFFICIENT_CLASS_VARIETY",
        model: null,
        selectedThreshold: null,
        selectedValidationLogLoss: null,
        selectedFeatures: [],
        train: null,
        validation: null,
        test: null,
        deterministicTest: null,
        modelFilteredTest: null,
        blockedReasons: ["Training partition must contain both WIN and non-WIN outcomes."],
        notes: ["A binary classifier cannot be fitted from a single-class training partition."],
      };
    }

    const names = usableFeatureNames(split.train);
    if (!names.length) {
      return {
        status: "BLOCKED",
        model: null,
        selectedThreshold: null,
        selectedValidationLogLoss: null,
        selectedFeatures: [],
        train: null,
        validation: null,
        test: null,
        deterministicTest: null,
        modelFilteredTest: null,
        blockedReasons: ["No non-constant numeric features are available in the training partition."],
        notes: [],
      };
    }

    const matrix = buildMatrix(names, split.train, split.validation, split.test);
    const selected = selectModel(matrix, split.train, split.validation);

    const trainProbabilities = calibratedPredict(selected.model, selected.calibrator, matrix.train);
    const validationProbabilities = calibratedPredict(selected.model, selected.calibrator, matrix.validation);
    const testProbabilities = calibratedPredict(selected.model, selected.calibrator, matrix.test);
    const rawTestProbabilities = predict(selected.model, matrix.test);
    const baselineWinRate = split.train.filter((row) => targetFor(row) === 1).length / Math.max(1, split.train.length);
    const baselineProbabilities = split.test.map(() => baselineWinRate);

    return {
      status: "READY",
      model: selected.config,
      selectedThreshold: selected.threshold,
      selectedValidationLogLoss: selected.validationLogLoss,
      selectedFeatures: names,
      calibration: selected.calibration,
      train: classification(split.train, trainProbabilities),
      validation: classification(split.validation, validationProbabilities),
      test: classification(split.test, testProbabilities),
      rawTest: classification(split.test, rawTestProbabilities),
      baselineTest: classification(split.test, baselineProbabilities),
      deterministicTest: tradingOverlay(split.test, split.test.map(() => 1), 0),
      modelFilteredTest: tradingOverlay(split.test, testProbabilities, selected.threshold),
      blockedReasons: [],
      notes: [
        "This is a logistic-regression meta-labeler: it predicts WIN versus non-WIN for an existing deterministic eligible trade.",
        "It does not choose direction, position size, exits, or submit orders.",
        "Missing-value imputation and normalization use TRAIN statistics only.",
        "Balanced class weighting is tested as a deterministic alternative using TRAIN-only class counts.",
        "The first experiment uses a fixed auditable feature subset through the existing feature-name selection, excluding constant training features.",
        "Missing-value imputation and normalization use TRAIN statistics only.",
        "The base model is fit on the inner 80% of TRAIN and Platt calibration is fit on the remaining 20% of TRAIN.",
        "Regularization and the filter threshold are selected on VALIDATION only; TEST remains held out.",
        "The test overlay compares all deterministic test trades with the subset accepted by the model.",
        "Predicted probabilities are research estimates, not guarantees or proof of live calibration.",
      ],
    };
  }
}
