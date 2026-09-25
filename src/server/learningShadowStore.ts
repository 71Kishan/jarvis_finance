import fs from "fs";
import path from "path";
import type { Trade, LearningShadowSnapshot } from "../types/learningShadow";
import type { DecisionFeatureSnapshot } from "../learn/features";
import type { MlShadowModelArtifact, MlShadowPrediction } from "../learn/mlBaseline";

export interface ShadowPredictionRecord {
  id: string;
  createdAt: number;
  modelFingerprint: string;
  strategyId: string;
  strategyVersion: number;
  asset: string;
  decisionTimestamp: number;
  tradeId: string | null;
  probability: number;
  acceptedByModel: boolean;
  features: Record<string, number | null>;
  outcome: "WIN" | "LOSS" | "FLAT" | null;
  pnlUsd: number | null;
  resolvedAt: number | null;
}

export interface ShadowPerformanceSummary {
  predictions: number;
  resolvedPredictions: number;
  wins: number;
  losses: number;
  flats: number;
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

export interface ShadowStoreState {
  version: 1;
  model: MlShadowModelArtifact | null;
  predictions: ShadowPredictionRecord[];
}

const MAX_PREDICTIONS = 1000;
const DRIFT_WINDOW = 100;
const DRIFT_THRESHOLD = 2;
const MISSING_THRESHOLD = 0.1;
const EPSILON = 1e-9;

function clamp(value: number): number {
  return Math.max(EPSILON, Math.min(1 - EPSILON, value));
}

export class LearningShadowStore {
  private readonly filePath: string;
  private state: ShadowStoreState = { version: 1, model: null, predictions: [] };

  constructor(
    filePath = process.env.JARVIS_LEARNING_SHADOW_FILE ||
      path.join(process.cwd(), "data", "learning-shadow.json"),
  ) {
    this.filePath = path.resolve(filePath);
    this.load();
  }

  public getPath(): string {
    return this.filePath;
  }

  public getModel(): MlShadowModelArtifact | null {
    return this.state.model ? JSON.parse(JSON.stringify(this.state.model)) : null;
  }

  public setModel(model: MlShadowModelArtifact): void {
    this.state.model = JSON.parse(JSON.stringify(model));
    this.state.predictions = this.state.predictions.slice(0, MAX_PREDICTIONS);
    this.save();
  }

  public record(
    snapshot: DecisionFeatureSnapshot,
    prediction: MlShadowPrediction,
    tradeId: string | null,
    recordedAt = Date.now(),
  ): ShadowPredictionRecord {
    const features: Record<string, number | null> = {};
    for (const name of Object.keys(prediction)) {
      void name;
    }
    const numeric = predictionFeatureVector(snapshot);
    const record: ShadowPredictionRecord = {
      id: "SHADOW-" + recordedAt + "-" + Math.random().toString(36).slice(2, 8),
      createdAt: recordedAt,
      modelFingerprint: prediction.modelFingerprint,
      strategyId: snapshot.strategyId,
      strategyVersion: snapshot.strategyVersion,
      asset: snapshot.asset,
      decisionTimestamp: snapshot.decisionTimestamp,
      tradeId,
      probability: prediction.probability,
      acceptedByModel: prediction.accepted,
      features: numeric,
      outcome: null,
      pnlUsd: null,
      resolvedAt: null,
    };
    this.state.predictions = [record, ...this.state.predictions].slice(0, MAX_PREDICTIONS);
    this.save();
    return JSON.parse(JSON.stringify(record));
  }

  public resolveTrade(trade: Trade, resolvedAt = Date.now()): void {
    const outcome = trade.pnl > 0 ? "WIN" : trade.pnl < 0 ? "LOSS" : "FLAT";
    let changed = false;
    for (const record of this.state.predictions) {
      if (record.tradeId === trade.id && record.outcome === null) {
        record.outcome = outcome;
        record.pnlUsd = Number(trade.pnl.toFixed(2));
        record.resolvedAt = resolvedAt;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  public getSummary(now = Date.now()): ShadowPerformanceSummary {
    const model = this.state.model;
    const relevantPredictions = model
      ? this.state.predictions.filter((record) => record.modelFingerprint === model.fingerprint)
      : [];
    const resolved = relevantPredictions.filter((record) => record.outcome !== null);
    const wins = resolved.filter((record) => record.outcome === "WIN").length;
    const losses = resolved.filter((record) => record.outcome === "LOSS").length;
    const flats = resolved.filter((record) => record.outcome === "FLAT").length;
    const probabilities = resolved.map((record) => record.probability);
    const meanProbability = resolved.length
      ? Number((probabilities.reduce((sum, value) => sum + value, 0) / resolved.length).toFixed(6))
      : null;
    const logLoss = resolved.length
      ? Number((
        resolved.reduce((sum, record) => {
          const y = record.outcome === "WIN" ? 1 : 0;
          const p = clamp(record.probability);
          return sum - (y * Math.log(p) + (1 - y) * Math.log(1 - p));
        }, 0) / resolved.length
      ).toFixed(6))
      : null;
    const brierScore = resolved.length
      ? Number((resolved.reduce((sum, record) => {
        const y = record.outcome === "WIN" ? 1 : 0;
        return sum + (record.probability - y) ** 2;
      }, 0) / resolved.length).toFixed(6))
      : null;
    const winRate = wins / Math.max(1, resolved.length);
    const baselineLogLoss = resolved.length
      ? Number((resolved.reduce((sum, record) => {
        const p = winRate;
        const y = record.outcome === "WIN" ? 1 : 0;
        const probability = clamp(p);
        return sum - (y * Math.log(probability) + (1 - y) * Math.log(1 - probability));
      }, 0) / resolved.length).toFixed(6))
      : null;
    const baselineBrierScore = resolved.length
      ? Number((resolved.reduce((sum, record) => {
        const y = record.outcome === "WIN" ? 1 : 0;
        return sum + (winRate - y) ** 2;
      }, 0) / resolved.length).toFixed(6))
      : null;

    const recent = relevantPredictions.slice(0, DRIFT_WINDOW);
    let driftScore: number | null = null;
    let missingRate = 0;
    if (model && recent.length) {
      let totalShift = 0;
      let usedFeatures = 0;
      let missing = 0;
      for (let index = 0; index < model.featureNames.length; index += 1) {
        const name = model.featureNames[index];
        const values = recent
          .map((record) => record.features[name])
          .filter((value): value is number => value !== null && Number.isFinite(value));
        missing += recent.length - values.length;
        if (!values.length) continue;
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        const scale = Math.max(EPSILON, model.scales[index]);
        totalShift += Math.abs((average - model.means[index]) / scale);
        usedFeatures += 1;
      }
      driftScore = usedFeatures
        ? Number((totalShift / usedFeatures).toFixed(4))
        : null;
      missingRate = model.featureNames.length && recent.length
        ? Math.min(1, missing / (model.featureNames.length * recent.length))
        : 0;
    }

    return {
      predictions: relevantPredictions.length,
      resolvedPredictions: resolved.length,
      wins,
      losses,
      flats,
      meanProbability,
      logLoss,
      brierScore,
      baselineLogLoss,
      baselineBrierScore,
      featureDriftScore: driftScore,
      missingFeatureRate: Number(missingRate.toFixed(4)),
      driftFlag: (driftScore !== null && driftScore > DRIFT_THRESHOLD) || missingRate > MISSING_THRESHOLD,
      lastPredictionAt: this.state.predictions[0]?.createdAt ?? null,
      lastResolvedAt: resolved[0]?.resolvedAt ?? null,
    };
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as ShadowStoreState;
      if (parsed?.version !== 1 || !Array.isArray(parsed.predictions)) throw new Error("Unsupported shadow store.");
      this.state = {
        version: 1,
        model: parsed.model ?? null,
        predictions: parsed.predictions.slice(0, MAX_PREDICTIONS),
      };
    } catch {
      try {
        fs.renameSync(this.filePath, this.filePath + ".corrupt-" + Date.now());
      } catch {}
      this.state = { version: 1, model: null, predictions: [] };
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = this.filePath + ".tmp-" + process.pid + "-" + Date.now();
    const fd = fs.openSync(tempPath, "w", 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(this.state), 0, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, this.filePath);
  }
}

function predictionFeatureVector(snapshot: DecisionFeatureSnapshot): Record<string, number | null> {
  return {
    signal_score: snapshot.signalScore,
    signal_direction: snapshot.signalDirection === "LONG" ? 1 : snapshot.signalDirection === "SHORT" ? -1 : 0,
    price_vs_ema9_pct: snapshot.priceVsEma9Pct,
    price_vs_ema21_pct: snapshot.priceVsEma21Pct,
    price_vs_ema50_pct: snapshot.priceVsEma50Pct,
    ema9_vs_21_pct: snapshot.ema9Vs21Pct,
    ema21_vs_50_pct: snapshot.ema21Vs50Pct,
    rsi: snapshot.rsi,
    macd: snapshot.macd,
    macd_hist: snapshot.macdHist,
    bollinger_position: snapshot.bollingerPosition,
    bollinger_width_pct: snapshot.bollingerWidthPct,
    atr_pct: snapshot.atrPct,
    volume_ratio: snapshot.volumeRatio,
    candle_return_pct: snapshot.candleReturnPct,
    candle_body_to_range: snapshot.candleBodyToRange,
    trend_alignment: snapshot.trendAlignment,
    momentum_alignment: snapshot.momentumAlignment,
    rsi_alignment: snapshot.rsiAlignment,
    volatility_structure_alignment: snapshot.volatilityStructureAlignment,
    volume_confirmed: snapshot.volumeConfirmed ? 1 : 0,
    spread_bps: snapshot.spreadBps,
    market_open: snapshot.marketOpen === null ? null : snapshot.marketOpen ? 1 : 0,
    market_data_age_ms: snapshot.marketDataAgeMs,
  };
}
