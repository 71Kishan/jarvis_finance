import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type { LearningResearchResult } from "./researchLoop";
import type { MlShadowModelArtifact } from "./mlBaseline";

export interface LearningExperimentRecord {
  id: string;
  createdAt: number;
  featureSchemaVersion: number;
  datasetRows: number;
  liveMarketRows: number;
  modelFingerprint: string | null;
  researchStatus: LearningResearchResult["status"];
  mlStatus: LearningResearchResult["mlExperiment"]["status"];
  mlRobustnessStatus: LearningResearchResult["mlRobustness"]["status"];
  selectedThreshold: number | null;
  selectedFeatures: string[];
  modelConfig: LearningResearchResult["mlExperiment"]["model"];
  testMetrics: LearningResearchResult["mlExperiment"]["test"];
  baselineMetrics: LearningResearchResult["mlExperiment"]["baselineTest"];
  deterministicTradingBaseline: LearningResearchResult["mlExperiment"]["deterministicTest"];
  modelFilteredTest: LearningResearchResult["mlExperiment"]["modelFilteredTest"];
  robustness: LearningResearchResult["mlRobustness"];
}

interface ExperimentStoreState {
  version: 1;
  records: LearningExperimentRecord[];
}

const MAX_RECORDS = 25;

export class LearningExperimentStore {
  private readonly filePath: string;
  private records: LearningExperimentRecord[] = [];

  constructor(
    filePath = process.env.JARVIS_LEARNING_EXPERIMENT_FILE ||
      path.join(process.cwd(), "data", "learning-experiments.json"),
  ) {
    this.filePath = path.resolve(filePath);
    this.load();
  }

  public getPath(): string {
    return this.filePath;
  }

  public list(limit = 25): LearningExperimentRecord[] {
    return this.records.slice(0, Math.max(1, Math.min(limit, MAX_RECORDS))).map((record) => JSON.parse(JSON.stringify(record)));
  }

  public getLatest(): LearningExperimentRecord | null {
    return this.records[0] ? JSON.parse(JSON.stringify(this.records[0])) : null;
  }

  public record(
    result: LearningResearchResult,
    model: MlShadowModelArtifact | null,
    recordedAt = Date.now(),
  ): LearningExperimentRecord {
    const canonical = JSON.stringify({
      featureSchemaVersion: result.featureResearch.audit.schemaVersion,
      datasetRows: result.featureResearch.audit.rowsValid,
      modelFingerprint: model?.fingerprint ?? null,
      modelConfig: result.mlExperiment.model,
      selectedFeatures: result.mlExperiment.selectedFeatures,
      selectedThreshold: result.mlExperiment.selectedThreshold,
      robustness: result.mlRobustness,
    });
    const digest = createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);

    const record: LearningExperimentRecord = {
      id: "MLX-" + recordedAt + "-" + digest,
      createdAt: recordedAt,
      featureSchemaVersion: result.featureResearch.audit.schemaVersion,
      datasetRows: result.featureResearch.audit.rowsValid,
      liveMarketRows: result.featureResearch.audit.liveMarketRows,
      modelFingerprint: model?.fingerprint ?? null,
      researchStatus: result.status,
      mlStatus: result.mlExperiment.status,
      mlRobustnessStatus: result.mlRobustness.status,
      selectedThreshold: result.mlExperiment.selectedThreshold,
      selectedFeatures: [...result.mlExperiment.selectedFeatures],
      modelConfig: result.mlExperiment.model ? { ...result.mlExperiment.model } : null,
      testMetrics: result.mlExperiment.test ? { ...result.mlExperiment.test } : null,
      baselineMetrics: result.mlExperiment.baselineTest ? { ...result.mlExperiment.baselineTest } : null,
      deterministicTradingBaseline: result.mlExperiment.deterministicTest ? { ...result.mlExperiment.deterministicTest } : null,
      modelFilteredTest: result.mlExperiment.modelFilteredTest ? { ...result.mlExperiment.modelFilteredTest } : null,
      robustness: JSON.parse(JSON.stringify(result.mlRobustness)),
    };

    this.records = [record, ...this.records.filter((item) => item.id !== record.id)].slice(0, MAX_RECORDS);
    this.save();
    return JSON.parse(JSON.stringify(record));
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as ExperimentStoreState;
      if (parsed?.version !== 1 || !Array.isArray(parsed.records)) throw new Error("Unsupported experiment store.");
      this.records = parsed.records.slice(0, MAX_RECORDS);
    } catch {
      try {
        fs.renameSync(this.filePath, this.filePath + ".corrupt-" + Date.now());
      } catch {}
      this.records = [];
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = this.filePath + ".tmp-" + process.pid + "-" + Date.now();
    const payload: ExperimentStoreState = {
      version: 1,
      records: this.records,
    };
    const fd = fs.openSync(tempPath, "w", 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(payload), 0, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, this.filePath);
  }
}
