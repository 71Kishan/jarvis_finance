import { describe, expect, test } from "bun:test";
import { PlatformRepository } from "../src/platform/platformRepository";

function makeRepository(validation: any, deployment?: any) {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("FROM strategy_validation_runs")) {
        return { rows: validation ? [validation] : [], rowCount: validation ? 1 : 0 };
      }
      if (sql.startsWith("UPDATE strategy_deployments")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO strategy_deployments")) {
        return {
          rows: deployment ? [deployment] : [],
          rowCount: deployment ? 1 : 0,
        };
      }
      throw new Error("Unexpected deployment test query.");
    },
  };

  const database = {
    isReady: () => true,
    transaction: async (callback: (client: typeof client) => Promise<unknown>) => callback(client),
  };

  return {
    repository: new PlatformRepository(database as any),
    queries,
  };
}

const strategy = {
  id: "strat-1",
  version: 7,
  name: "Validated Momentum",
  asset: "BTC/USD",
};

describe("server-owned shadow strategy deployment", () => {
  test("rejects client-submitted validation evidence", async () => {
    const { repository, queries } = makeRepository({
      id: "run-1",
      status: "PROVISIONALLY_VALIDATED",
      source: "CLIENT_SUBMITTED",
      strategy_id: strategy.id,
      strategy_version: strategy.version,
      strategy,
    });

    await expect(
      repository.deployShadowStrategy({
        userId: "user-1",
        validationRunId: "run-1",
      }),
    ).rejects.toThrow("Only server-recomputed validation evidence");

    expect(queries.some((query) => query.startsWith("UPDATE strategy_deployments"))).toBe(false);
  });

  test("rejects a validation run that did not pass", async () => {
    const { repository } = makeRepository({
      id: "run-2",
      status: "FAILED",
      source: "SERVER_RECOMPUTED",
      strategy_id: strategy.id,
      strategy_version: strategy.version,
      strategy,
    });

    await expect(
      repository.deployShadowStrategy({
        userId: "user-1",
        validationRunId: "run-2",
      }),
    ).rejects.toThrow("Only a provisionally validated strategy");
  });

  test("deploys the exact strategy stored on the server validation run", async () => {
    const now = new Date();
    const deploymentRow = {
      id: "deployment-1",
      user_id: "user-1",
      strategy_id: strategy.id,
      strategy_version: strategy.version,
      environment: "SHADOW",
      status: "ACTIVE",
      validation_run_id: "run-3",
      strategy,
      activated_at: now,
      deactivated_at: null,
      reason: "operator request",
      created_at: now,
      updated_at: now,
    };

    const { repository, queries } = makeRepository({
      id: "run-3",
      status: "PROVISIONALLY_VALIDATED",
      source: "SERVER_RECOMPUTED",
      strategy_id: strategy.id,
      strategy_version: strategy.version,
      strategy,
    }, deploymentRow);

    const result = await repository.deployShadowStrategy({
      userId: "user-1",
      validationRunId: "run-3",
      reason: "operator request",
    });

    expect(result.id).toBe("deployment-1");
    expect(result.status).toBe("ACTIVE");
    expect(result.strategy).toEqual(strategy);
    expect(queries.some((query) => query.startsWith("UPDATE strategy_deployments"))).toBe(true);
    expect(queries.some((query) => query.startsWith("INSERT INTO strategy_deployments"))).toBe(true);
  });

  test("returns no active deployment when the read has no row", async () => {
    const database = {
      isReady: () => true,
      query: async () => ({ rows: [], rowCount: 0 }),
    };
    const repository = new PlatformRepository(database as any);

    expect(await repository.getActiveShadowStrategyDeployment("user-1")).toBeNull();
  });
});
