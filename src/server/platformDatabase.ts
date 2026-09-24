import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type PlatformDatabaseState = "DISABLED" | "STARTING" | "READY" | "ERROR" | "STOPPED";

export interface PlatformDatabaseHealth {
  state: PlatformDatabaseState;
  configured: boolean;
  lastSuccessfulCheckAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  latestMigration: string | null;
  migrationCount: number;
}

export interface PlatformDatabaseOptions {
  connectionString?: string;
  migrationsDir?: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  autoMigrate?: boolean;
  required?: boolean;
}

export function hashMigration(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

export class PlatformDatabase {
  private readonly connectionString: string | undefined;
  private readonly migrationsDir: string;
  private readonly maxConnections: number;
  private readonly connectionTimeoutMs: number;
  private readonly autoMigrate: boolean;
  private readonly required: boolean;
  private pool: Pool | null = null;
  private state: PlatformDatabaseState = "DISABLED";
  private lastSuccessfulCheckAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;
  private latestMigration: string | null = null;
  private migrationCount = 0;

  constructor(options: PlatformDatabaseOptions = {}) {
    this.connectionString = options.connectionString ?? process.env.DATABASE_URL;
    this.migrationsDir = path.resolve(
      options.migrationsDir ?? process.env.JARVIS_DB_MIGRATIONS_PATH ?? path.join(process.cwd(), "db", "migrations"),
    );
    this.maxConnections = Math.min(
      20,
      Math.max(1, options.maxConnections ?? (Number(process.env.JARVIS_DB_MAX_CONNECTIONS) || 8)),
    );
    this.connectionTimeoutMs = Math.max(
      1000,
      options.connectionTimeoutMs ?? (Number(process.env.JARVIS_DB_CONNECTION_TIMEOUT_MS) || 5000),
    );
    this.autoMigrate = options.autoMigrate ?? process.env.JARVIS_DB_AUTO_MIGRATE !== "false";
    this.required = options.required ?? process.env.JARVIS_DB_REQUIRED === "true";
  }

  public isConfigured(): boolean {
    return Boolean(this.connectionString);
  }

  public isReady(): boolean {
    return this.state === "READY" && Boolean(this.pool);
  }

  public async start(): Promise<void> {
    if (!this.connectionString) {
      this.state = "DISABLED";
      this.lastError = null;
      return;
    }

    if (this.pool) return;

    this.state = "STARTING";
    this.lastError = null;

    const ssl =
      process.env.JARVIS_DB_SSL === "true"
        ? { rejectUnauthorized: process.env.JARVIS_DB_SSL_REJECT_UNAUTHORIZED !== "false" }
        : undefined;

    const pool = new Pool({
      connectionString: this.connectionString,
      max: this.maxConnections,
      connectionTimeoutMillis: this.connectionTimeoutMs,
      idleTimeoutMillis: 30_000,
      ssl,
      application_name: "jarvis-finance",
    });

    this.pool = pool;

    try {
      await pool.query("SELECT 1");
      if (this.autoMigrate) await this.runMigrations(pool);
      this.lastSuccessfulCheckAt = Date.now();
      this.state = "READY";
    } catch (error: any) {
      this.lastErrorAt = Date.now();
      this.lastError = error?.message || "PostgreSQL initialization failed.";
      this.state = "ERROR";
      await pool.end().catch(() => undefined);
      this.pool = null;

      if (this.required) {
        throw new Error("Required Jarvis PostgreSQL database is unavailable: " + this.lastError);
      }
    }
  }

  public async stop(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.state = "STOPPED";
  }

  public getHealth(): PlatformDatabaseHealth {
    return {
      state: this.state,
      configured: this.isConfigured(),
      lastSuccessfulCheckAt: this.lastSuccessfulCheckAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      latestMigration: this.latestMigration,
      migrationCount: this.migrationCount,
    };
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const pool = this.requirePool();
    const result = await pool.query<T>(text, values);
    this.lastSuccessfulCheckAt = Date.now();
    return { rows: result.rows, rowCount: result.rowCount };
  }

  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const pool = this.requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      this.lastSuccessfulCheckAt = Date.now();
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private requirePool(): Pool {
    if (!this.pool || this.state !== "READY") {
      throw new Error("PostgreSQL platform persistence is not ready.");
    }
    return this.pool;
  }

  private getMigrationFiles(): string[] {
    if (!fs.existsSync(this.migrationsDir)) {
      throw new Error("Jarvis migration directory does not exist: " + this.migrationsDir);
    }

    return fs
      .readdirSync(this.migrationsDir)
      .filter((file) => /^\d+_[A-Za-z0-9._-]+\.sql$/.test(file))
      .sort((a, b) => a.localeCompare(b));
  }

  private async runMigrations(pool: Pool): Promise<void> {
    const migrationTable = [
      "CREATE TABLE IF NOT EXISTS jarvis_schema_migrations (",
      "  name TEXT PRIMARY KEY,",
      "  checksum TEXT NOT NULL,",
      "  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()",
      ")",
    ].join("\n");

    await pool.query(migrationTable);

    const client = await pool.connect();
    const lockKey = 72918431;

    try {
      await client.query("SELECT pg_advisory_lock($1)", [lockKey]);

      const appliedResult = await client.query<{ name: string; checksum: string }>(
        "SELECT name, checksum FROM jarvis_schema_migrations ORDER BY name ASC",
      );
      const applied = new Map(appliedResult.rows.map((row) => [row.name, row.checksum]));

      for (const name of this.getMigrationFiles()) {
        const filePath = path.join(this.migrationsDir, name);
        const contents = fs.readFileSync(filePath, "utf8");
        const checksum = hashMigration(contents);
        const existing = applied.get(name);

        if (existing) {
          if (existing !== checksum) {
            throw new Error(
              "Migration checksum mismatch for " + name + ". The migration has been changed after it was applied.",
            );
          }
          this.latestMigration = name;
          continue;
        }

        await client.query("BEGIN");
        try {
          await client.query(contents);
          await client.query(
            "INSERT INTO jarvis_schema_migrations(name, checksum) VALUES ($1, $2)",
            [name, checksum],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }

        applied.set(name, checksum);
        this.latestMigration = name;
        this.migrationCount++;
      }

      this.migrationCount = applied.size;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
      client.release();
    }
  }
}
