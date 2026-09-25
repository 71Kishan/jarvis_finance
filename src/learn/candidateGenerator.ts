import type { StrategyConfig } from "../types/trading";

function normalizeWeights(strategy: StrategyConfig): StrategyConfig["indicatorWeights"] {
  const raw = {
    trendEMA: Math.max(0, Number(strategy.indicatorWeights.trendEMA) || 0),
    rsiReversal: Math.max(0, Number(strategy.indicatorWeights.rsiReversal) || 0),
    bollingerMeanReversion: Math.max(0, Number(strategy.indicatorWeights.bollingerMeanReversion) || 0),
    macdMomentum: Math.max(0, Number(strategy.indicatorWeights.macdMomentum) || 0),
    volumeConfirmation: Math.max(0, Number(strategy.indicatorWeights.volumeConfirmation) || 0),
  };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return {
      trendEMA: 0.3,
      rsiReversal: 0.2,
      bollingerMeanReversion: 0.15,
      macdMomentum: 0.25,
      volumeConfirmation: 0.1,
    };
  }
  return {
    trendEMA: raw.trendEMA / total,
    rsiReversal: raw.rsiReversal / total,
    bollingerMeanReversion: raw.bollingerMeanReversion / total,
    macdMomentum: raw.macdMomentum / total,
    volumeConfirmation: raw.volumeConfirmation / total,
  };
}

function candidate(base: StrategyConfig, suffix: string, changes: Partial<StrategyConfig>): StrategyConfig {
  return {
    ...base,
    ...changes,
    id: base.id + "-research-" + suffix,
    version: base.version + 1,
    name: base.name + " / " + suffix,
    indicatorWeights: changes.indicatorWeights
      ? normalizeWeights({ ...base, ...changes, indicatorWeights: changes.indicatorWeights })
      : { ...base.indicatorWeights },
  };
}

/**
 * Deterministic research candidates.
 *
 * This intentionally uses small, auditable perturbations instead of random
 * hyperparameter search. The optimizer can therefore reproduce the exact same
 * candidate set for the same base strategy.
 */
export function generateResearchCandidates(baseStrategy: StrategyConfig): StrategyConfig[] {
  const base = {
    ...baseStrategy,
    indicatorWeights: normalizeWeights(baseStrategy),
    maxRiskPerTrade: Math.min(1, Math.max(0.05, Number(baseStrategy.maxRiskPerTrade) || 0.5)),
    minConfidence: Math.max(50, Math.min(100, Number(baseStrategy.minConfidence) || 50)),
  };

  const trendWeight = {
    ...base.indicatorWeights,
    trendEMA: base.indicatorWeights.trendEMA + 0.1,
    macdMomentum: Math.max(0, base.indicatorWeights.macdMomentum - 0.1),
  };

  const momentumWeight = {
    ...base.indicatorWeights,
    macdMomentum: base.indicatorWeights.macdMomentum + 0.1,
    bollingerMeanReversion: Math.max(0, base.indicatorWeights.bollingerMeanReversion - 0.1),
  };

  const meanReversionWeight = {
    ...base.indicatorWeights,
    bollingerMeanReversion: base.indicatorWeights.bollingerMeanReversion + 0.1,
    trendEMA: Math.max(0, base.indicatorWeights.trendEMA - 0.1),
  };

  return [
    { ...base, id: base.id, name: base.name },
    candidate(base, "Higher-Threshold", { minConfidence: Math.min(90, base.minConfidence + 8) }),
    candidate(base, "Lower-Risk", { maxRiskPerTrade: Math.max(0.1, base.maxRiskPerTrade * 0.8) }),
    candidate(base, "Trend-Weighted", { indicatorWeights: trendWeight }),
    candidate(base, "Momentum-Weighted", { indicatorWeights: momentumWeight }),
    candidate(base, "Mean-Reversion-Weighted", { indicatorWeights: meanReversionWeight }),
  ];
}
