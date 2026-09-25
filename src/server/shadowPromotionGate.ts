import type { LearningExperimentRecord } from "./learningExperimentStore";
import type { ShadowPerformanceSummary } from "./learningShadowStore";

export const MIN_SHADOW_PREDICTIONS = 100;
export const MIN_SHADOW_RESOLVED = 50;

export function evaluateShadowPromotionGate(
  experiment: LearningExperimentRecord | null,
  shadow: ShadowPerformanceSummary,
): {
  eligibleForReview: boolean;
  modelReady: boolean;
  robustnessReady: boolean;
  shadowSampleReady: boolean;
  shadowPerformanceReady: boolean;
  driftClear: boolean;
  reasons: string[];
} {
  const modelReady = Boolean(
    experiment &&
    experiment.mlStatus === "READY" &&
    experiment.modelFingerprint,
  );
  const robustnessReady = Boolean(
    experiment &&
    experiment.mlRobustnessStatus === "READY" &&
    experiment.robustness.stableAcrossFolds,
  );
  const shadowSampleReady =
    shadow.predictions >= MIN_SHADOW_PREDICTIONS &&
    shadow.resolvedPredictions >= MIN_SHADOW_RESOLVED;
  const shadowPerformanceReady = Boolean(
    shadow.resolvedPredictions >= MIN_SHADOW_RESOLVED &&
    shadow.logLoss !== null &&
    shadow.baselineLogLoss !== null &&
    shadow.brierScore !== null &&
    shadow.baselineBrierScore !== null &&
    shadow.logLoss <= shadow.baselineLogLoss &&
    shadow.brierScore <= shadow.baselineBrierScore,
  );
  const driftClear = !shadow.driftFlag;

  const reasons: string[] = [];
  if (!modelReady) reasons.push("No current READY ML experiment with a model fingerprint.");
  if (!robustnessReady) reasons.push("Rolling robustness gate has not cleared.");
  if (!shadowSampleReady) reasons.push(
    "Shadow sample is too small. Need at least " + MIN_SHADOW_PREDICTIONS + " predictions and " + MIN_SHADOW_RESOLVED + " resolved outcomes.",
  );
  if (!shadowPerformanceReady) reasons.push("Shadow performance has not beaten or matched the resolved-sample prevalence baseline on both log loss and Brier score.");
  if (!driftClear) reasons.push("Recent shadow feature drift is above the configured monitoring threshold.");

  return {
    eligibleForReview: modelReady && robustnessReady && shadowSampleReady && shadowPerformanceReady && driftClear,
    modelReady,
    robustnessReady,
    shadowSampleReady,
    shadowPerformanceReady,
    driftClear,
    reasons,
  };
}
