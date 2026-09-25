import type { StrategyConfig, Trade } from "../types/trading";
import type { DecisionFeatureSnapshot } from "../learn/features";
import { FirstMlExperiment, MlShadowModelArtifact } from "../learn/mlBaseline";
import { LearningResearchLoop } from "../learn/researchLoop";
import { LearningExperimentStore, LearningExperimentRecord } from "./learningExperimentStore";
import { LearningShadowStore, ShadowPerformanceSummary } from "./learningShadowStore";
import { evaluateShadowPromotionGate } from "./shadowPromotionGate";

export interface LearningShadowRuntimeSnapshot {
  modelAvailable: boolean;
  modelFingerprint: string | null;
  experiment: LearningExperimentRecord | null;
  performance: ShadowPerformanceSummary;
  gate: ReturnType<typeof evaluateShadowPromotionGate>;
  lastRefreshAt: number | null;
}

export class LearningShadowRuntime {
  private readonly experimentStore: LearningExperimentStore;
  private readonly shadowStore: LearningShadowStore;
  private readonly refreshIntervalMs: number;
  private lastRefreshAt: number | null = null;
  private model: MlShadowModelArtifact | null = null;

  constructor(options?: {
    experimentFile?: string;
    shadowFile?: string;
    refreshIntervalMs?: number;
  }) {
    this.experimentStore = new LearningExperimentStore(options?.experimentFile);
    this.shadowStore = new LearningShadowStore(options?.shadowFile);
    this.model = this.shadowStore.getModel();
    this.refreshIntervalMs = Math.max(
      60_000,
      options?.refreshIntervalMs ?? Number(process.env.JARVIS_LEARNING_MODEL_REFRESH_MS) || 300_000,
    );
  }

  public async refresh(
    strategy: StrategyConfig,
    candles: Parameters<typeof LearningResearchLoop.run>[1],
    learningRecords: Parameters<typeof LearningResearchLoop.run>[2],
    now = Date.now(),
    force = false,
  ): Promise<void> {
    if (!force && this.lastRefreshAt !== null && now - this.lastRefreshAt < this.refreshIntervalMs) return;

    if (learningRecords.length < 90) {
      this.lastRefreshAt = now;
      return;
    }

    const research = LearningResearchLoop.run(strategy, candles, learningRecords);
    this.lastRefreshAt = now;

    const shadowModel = FirstMlExperiment.createShadowModel(learningRecords);
    if (shadowModel) {
      this.model = shadowModel;
      this.shadowStore.setModel(shadowModel);
    }
    this.experimentStore.record(research, shadowModel, now);
  }

  public recordDecision(snapshot: DecisionFeatureSnapshot, tradeId: string | null, now = Date.now()): void {
    if (!this.model) return;
    const prediction = FirstMlExperiment.predictShadow(this.model, snapshot);
    this.shadowStore.record(snapshot, prediction, tradeId, now);
  }

  public resolveTrade(trade: Trade, now = Date.now()): void {
    this.shadowStore.resolveTrade(trade, now);
  }

  public getSnapshot(): LearningShadowRuntimeSnapshot {
    const performance = this.shadowStore.getSummary();
    const experiment = this.experimentStore.getLatest();
    const gate = evaluateShadowPromotionGate(experiment, performance);
    return {
      modelAvailable: Boolean(this.model),
      modelFingerprint: this.model?.fingerprint ?? null,
      experiment,
      performance,
      gate,
      lastRefreshAt: this.lastRefreshAt,
    };
  }
}
