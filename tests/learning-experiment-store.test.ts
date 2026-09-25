import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { LearningExperimentStore } from "../src/server/learningExperimentStore";

test("learning experiment registry persists the model fingerprint and latest research record", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-experiment-"));
  const file = path.join(dir, "experiments.json");
  try {
    const store = new LearningExperimentStore(file);
    const result = {
      status: "RESEARCH_ONLY",
      featureResearch: { audit: { schemaVersion: 1, rowsValid: 120, liveMarketRows: 120 } },
      mlExperiment: {
        status: "READY",
        selectedThreshold: 0.6,
        selectedFeatures: ["signal_score"],
        model: { regularization: 1, learningRate: 0.05, iterations: 700, classWeighting: "NONE" },
        test: { rows: 24 },
        baselineTest: { rows: 24 },
        deterministicTest: { rowsConsidered: 24 },
        modelFilteredTest: { rowsConsidered: 24 },
      },
      mlRobustness: { status: "READY", stableAcrossFolds: true },
    } as any;
    const model = {
      fingerprint: "fp-test",
    } as any;

    store.record(result, model, 1000);
    const restored = new LearningExperimentStore(file);
    expect(restored.getLatest()?.modelFingerprint).toBe("fp-test");
    expect(restored.getLatest()?.selectedThreshold).toBe(0.6);
    expect(restored.list()).toHaveLength(1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
