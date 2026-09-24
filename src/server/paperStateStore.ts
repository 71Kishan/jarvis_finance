import fs from "fs";
import path from "path";
import { TradingEngine } from "../engine/tradingEngine";
import { TradingEngineRuntimeState } from "../types/trading";

export interface PaperStateStoreResult {
  restored: boolean;
  recoveredFromCorruptFile: boolean;
  error?: string;
}

export class PaperStateStore {
  private readonly filePath: string;

  constructor(filePath = process.env.JARVIS_PAPER_STATE_FILE || path.join(process.cwd(), "data", "paper-runtime.json")) {
    this.filePath = path.resolve(filePath);
  }

  public getPath(): string {
    return this.filePath;
  }

  public loadInto(engine: TradingEngine): PaperStateStoreResult {
    if (!fs.existsSync(this.filePath)) {
      return { restored: false, recoveredFromCorruptFile: false };
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as TradingEngineRuntimeState;

      if (parsed?.version !== 1 || !engine.hydrateRuntimeState(parsed)) {
        throw new Error("Unsupported or invalid paper runtime state.");
      }

      return { restored: true, recoveredFromCorruptFile: false };
    } catch (error: any) {
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.filePath, corruptPath);
      } catch {}

      return {
        restored: false,
        recoveredFromCorruptFile: true,
        error: error?.message || "Paper runtime state could not be restored.",
      };
    }
  }

  public save(engine: TradingEngine): void {
    const state = engine.exportRuntimeState();
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const payload = JSON.stringify(state);

    // Atomic replacement prevents readers from observing a partially written
    // account snapshot. fsync makes the completed snapshot durable before rename.
    const fd = fs.openSync(tempPath, "w", 0o600);
    try {
      fs.writeSync(fd, payload, 0, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    fs.renameSync(tempPath, this.filePath);
  }
}
