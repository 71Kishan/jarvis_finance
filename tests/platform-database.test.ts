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


describe("Binance Spot testnet adapter", () => {
  test("signs percent-encoded parameters using HMAC SHA-256", async () => {
    const { buildBinanceSignature } = await import("../src/platform/binanceSpotAccountAdapter");
    const signature = buildBinanceSignature("secret", [
      ["symbol", "BTCUSDT"],
      ["note", "hello world"],
      ["timestamp", "1700000000000"],
    ]);

    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(signature).toBe(
      "5ea5c0f28f3b1b8e1f1bd0f7d0c7d2c7cfd8f4c0d04d1f53e4c78e7189b0b2a1",
    );
  });
});
