import { describe, expect, test } from "bun:test";
import { hashMigration } from "../src/server/platformDatabase";
import { mapAccountConnectionRow } from "../src/platform/platformRepository";

describe("platform persistence primitives", () => {
  test("migration checksum is deterministic", () => {
    const one = hashMigration("CREATE TABLE example;");
    const two = hashMigration("CREATE TABLE example;");
    const changed = hashMigration("CREATE TABLE example2;");
    expect(one).toBe(two);
    expect(one).not.toBe(changed);
    expect(one).toMatch(/^[a-f0-9]{64}$/);
  });

  test("database account rows map without converting financial values to JS numbers", () => {
    const mapped = mapAccountConnectionRow({
      id: "account-1",
      provider: "BINANCE_SPOT",
      account_type: "EXCHANGE",
      label: "Binance testnet",
      external_account_id: "external-1",
      status: "CONNECTED",
      permissions: ["READ", "TRADE"],
      last_synced_at: new Date("2026-09-24T09:00:00.000Z"),
      created_at: new Date("2026-09-20T09:00:00.000Z"),
      updated_at: new Date("2026-09-24T09:00:00.000Z"),
    });

    expect(mapped).toEqual({
      id: "account-1",
      provider: "BINANCE_SPOT",
      accountType: "EXCHANGE",
      label: "Binance testnet",
      externalAccountId: "external-1",
      status: "CONNECTED",
      permissions: ["READ", "TRADE"],
      lastSyncedAt: Date.parse("2026-09-24T09:00:00.000Z"),
      createdAt: Date.parse("2026-09-20T09:00:00.000Z"),
      updatedAt: Date.parse("2026-09-24T09:00:00.000Z"),
    });
  });
});
