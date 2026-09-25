export interface LearningShadowSnapshot {
  modelAvailable: boolean;
  modelFingerprint: string | null;
  predictions: number;
  resolvedPredictions: number;
  wins: number;
  losses: number;
  meanProbability: number | null;
  logLoss: number | null;
  brierScore: number | null;
  baselineLogLoss: number | null;
  baselineBrierScore: number | null;
  featureDriftScore: number | null;
  missingFeatureRate: number;
  driftFlag: boolean;
  lastPredictionAt: number | null;
  lastResolvedAt: number | null;
}

export interface LearningPromotionGateSnapshot {
  eligibleForReview: boolean;
  modelReady: boolean;
  robustnessReady: boolean;
  shadowSampleReady: boolean;
  shadowPerformanceReady: boolean;
  driftClear: boolean;
  reasons: string[];
}
