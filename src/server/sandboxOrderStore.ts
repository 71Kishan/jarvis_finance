import type { PoolClient } from "pg";
import type { BrokerOrder, OrderIntent, OrderStatus } from "../platform/types";
import { PlatformDatabase } from "./platformDatabase";
import { canTransitionOrderStatus } from "../platform/orderStateMachine";

export interface PersistedSandboxOrder extends OrderIntent {
  status: OrderStatus;
  filledQuantity: string;
  averageFillPrice?: string;
  externalOrderId?: string;
  submittedAt?: number;
  updatedAt: number;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  failureReason?: string;
}

export interface SandboxOrderIdentity {
  userId: string;
  accountId: string;
  instrumentId: string;
  idempotencyKey: string;
  clientOrderId: string;
  idempotencyFingerprint: string;
}

interface OrderRow {
  client_order_id: string;
  account_id: string;
  instrument_id: string;
  external_order_id: string | null;
  side: "BUY" | "SELL";
  order_type: OrderIntent["type"];
  quantity: string;
  limit_price: string | null;
  stop_price: string | null;
  time_in_force: OrderIntent["timeInForce"] | null;
  reduce_only: boolean;
  strategy_id: string | null;
  strategy_version: number | null;
  reason: string | null;
  requested_at: Date;
  status: OrderStatus;
  filled_quantity: string;
  average_fill_price: string | null;
  submitted_at: Date | null;
  updated_at: Date;
  idempotency_key: string;
  idempotency_fingerprint: string;
  failure_reason: string | null;
}

function mapOrder(row: OrderRow): PersistedSandboxOrder {
  return {
    clientOrderId: row.client_order_id,
    accountId: row.account_id,
    instrumentId: row.instrument_id,
    side: row.side,
    type: row.order_type,
    quantity: row.quantity,
    limitPrice: row.limit_price ?? undefined,
    stopPrice: row.stop_price ?? undefined,
    timeInForce: row.time_in_force ?? undefined,
    reduceOnly: row.reduce_only,
    strategyId: row.strategy_id ?? undefined,
    strategyVersion: row.strategy_version ?? undefined,
    reason: row.reason ?? undefined,
    requestedAt: row.requested_at.getTime(),
    status: row.status,
    filledQuantity: row.filled_quantity,
    averageFillPrice: row.average_fill_price ?? undefined,
    externalOrderId: row.external_order_id ?? undefined,
    submittedAt: row.submitted_at?.getTime(),
    updatedAt: row.updated_at.getTime(),
    idempotencyKey: row.idempotency_key,
    idempotencyFingerprint: row.idempotency_fingerprint,
    failureReason: row.failure_reason ?? undefined,
  };
}

export class SandboxOrderStore {
  constructor(private readonly database: PlatformDatabase) {}

  private requireDatabase(): void {
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL sandbox order persistence is not ready.");
    }
  }

  public async createOrGetPendingIntent(
    identity: SandboxOrderIdentity,
    intent: Omit<OrderIntent, "clientOrderId">,
  ): Promise<{ created: boolean; order: PersistedSandboxOrder }> {
    this.requireDatabase();

    return this.database.transaction(async (client: PoolClient) => {
      const inserted = await client.query<OrderRow>(
        [
          "INSERT INTO orders(",
          "  client_order_id, account_id, instrument_id, side, order_type, quantity,",
          "  limit_price, stop_price, time_in_force, reduce_only, strategy_id,",
          "  strategy_version, reason, requested_at, status, filled_quantity, updated_at,",
          "  idempotency_key, idempotency_fingerprint",
          ") VALUES (",
          "  $1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9, $10,",
          "  $11, $12, $13, to_timestamp($14 / 1000.0), 'PENDING_SUBMIT', 0, now(), $15, $16",
          ")",
          "ON CONFLICT (account_id, idempotency_key) DO NOTHING",
          "RETURNING client_order_id, account_id, instrument_id, external_order_id, side, order_type,",
          "  quantity::text, limit_price::text, stop_price::text, time_in_force, reduce_only,",
          "  strategy_id, strategy_version, reason, requested_at, status, filled_quantity::text,",
          "  average_fill_price::text, submitted_at, updated_at, idempotency_key,",
          "  idempotency_fingerprint, failure_reason",
        ].join("\n"),
        [
          identity.clientOrderId,
          intent.accountId,
          intent.instrumentId,
          intent.side,
          intent.type,
          intent.quantity,
          intent.limitPrice ?? null,
          intent.stopPrice ?? null,
          intent.timeInForce ?? null,
          intent.reduceOnly === true,
          intent.strategyId ?? null,
          intent.strategyVersion ?? null,
          intent.reason ?? null,
          intent.requestedAt,
          identity.idempotencyKey,
          identity.idempotencyFingerprint,
        ],
      );

      if (inserted.rows[0]) {
        return { created: true, order: mapOrder(inserted.rows[0]) };
      }

      const existing = await client.query<OrderRow>(
        [
          "SELECT client_order_id, account_id, instrument_id, external_order_id, side, order_type,",
          "  quantity::text, limit_price::text, stop_price::text, time_in_force, reduce_only,",
          "  strategy_id, strategy_version, reason, requested_at, status, filled_quantity::text,",
          "  average_fill_price::text, submitted_at, updated_at, idempotency_key,",
          "  idempotency_fingerprint, failure_reason",
          "FROM orders",
          "WHERE account_id = $1 AND idempotency_key = $2",
          "FOR UPDATE",
        ].join("\n"),
        [intent.accountId, identity.idempotencyKey],
      );

      const row = existing.rows[0];
      if (!row) throw new Error("Idempotent sandbox order could not be reloaded.");
      if (row.idempotency_fingerprint !== identity.idempotencyFingerprint) {
        throw new Error("IDEMPOTENCY_KEY_REUSED: the same idempotency key was used for a different order intent.");
      }
      return { created: false, order: mapOrder(row) };
    });
  }

  public async getOwnedOrder(userId: string, clientOrderId: string): Promise<PersistedSandboxOrder | null> {
    this.requireDatabase();
    const result = await this.database.query<OrderRow>(
      [
        "SELECT o.client_order_id, o.account_id, o.instrument_id, o.external_order_id, o.side, o.order_type,",
        "  o.quantity::text, o.limit_price::text, o.stop_price::text, o.time_in_force, o.reduce_only,",
        "  o.strategy_id, o.strategy_version, o.reason, o.requested_at, o.status, o.filled_quantity::text,",
        "  o.average_fill_price::text, o.submitted_at, o.updated_at, o.idempotency_key,",
        "  o.idempotency_fingerprint, o.failure_reason",
        "FROM orders o",
        "JOIN account_connections a ON a.id = o.account_id",
        "WHERE a.user_id = $1 AND o.client_order_id = $2",
        "LIMIT 1",
      ].join("\n"),
      [userId, clientOrderId],
    );
    return result.rows[0] ? mapOrder(result.rows[0]) : null;
  }

  public async markStatus(
    userId: string,
    clientOrderId: string,
    incomingStatus: OrderStatus,
    options: {
      externalOrderId?: string;
      filledQuantity?: string;
      averageFillPrice?: string;
      submittedAt?: number;
      failureReason?: string;
    } = {},
  ): Promise<PersistedSandboxOrder | null> {
    this.requireDatabase();

    return this.database.transaction(async (client: PoolClient) => {
      const current = await client.query<OrderRow>(
        [
          "SELECT o.client_order_id, o.account_id, o.instrument_id, o.external_order_id, o.side, o.order_type,",
          "  o.quantity::text, o.limit_price::text, o.stop_price::text, o.time_in_force, o.reduce_only,",
          "  o.strategy_id, o.strategy_version, o.reason, o.requested_at, o.status, o.filled_quantity::text,",
          "  o.average_fill_price::text, o.submitted_at, o.updated_at, o.idempotency_key,",
          "  o.idempotency_fingerprint, o.failure_reason",
          "FROM orders o",
          "JOIN account_connections a ON a.id = o.account_id",
          "WHERE a.user_id = $1 AND o.client_order_id = $2",
          "FOR UPDATE",
        ].join("\n"),
        [userId, clientOrderId],
      );

      const row = current.rows[0];
      if (!row) return null;

      if (!canTransitionOrderStatus(row.status, incomingStatus)) {
        throw new Error("Invalid sandbox order state transition: " + row.status + " -> " + incomingStatus);
      }

      const updated = await client.query<OrderRow>(
        [
          "UPDATE orders SET",
          "  status = $3,",
          "  external_order_id = COALESCE($4, external_order_id),",
          "  filled_quantity = COALESCE($5::numeric, filled_quantity),",
          "  average_fill_price = COALESCE($6::numeric, average_fill_price),",
          "  submitted_at = COALESCE($7::timestamptz, submitted_at),",
          "  failure_reason = $8,",
          "  updated_at = now(),",
          "  last_provider_event_at = CASE WHEN $3 <> 'PENDING_SUBMIT' THEN now() ELSE last_provider_event_at END",
          "WHERE client_order_id = $1",
          "RETURNING client_order_id, account_id, instrument_id, external_order_id, side, order_type,",
          "  quantity::text, limit_price::text, stop_price::text, time_in_force, reduce_only,",
          "  strategy_id, strategy_version, reason, requested_at, status, filled_quantity::text,",
          "  average_fill_price::text, submitted_at, updated_at, idempotency_key,",
          "  idempotency_fingerprint, failure_reason",
        ].join("\n"),
        [
          clientOrderId,
          userId,
          incomingStatus,
          options.externalOrderId ?? null,
          options.filledQuantity ?? null,
          options.averageFillPrice ?? null,
          options.submittedAt ? new Date(options.submittedAt) : null,
          options.failureReason ?? null,
        ],
      );

      return updated.rows[0] ? mapOrder(updated.rows[0]) : null;
    });
  }

  public async listActiveOrders(): Promise<Array<{ userId: string; order: PersistedSandboxOrder; externalAccountId: string | null }>> {
    this.requireDatabase();
    const result = await this.database.query<OrderRow & { user_id: string; external_account_id: string | null }>(
      [
        "SELECT a.user_id, a.external_account_id,",
        "  o.client_order_id, o.account_id, o.instrument_id, o.external_order_id, o.side, o.order_type,",
        "  o.quantity::text, o.limit_price::text, o.stop_price::text, o.time_in_force, o.reduce_only,",
        "  o.strategy_id, o.strategy_version, o.reason, o.requested_at, o.status, o.filled_quantity::text,",
        "  o.average_fill_price::text, o.submitted_at, o.updated_at, o.idempotency_key,",
        "  o.idempotency_fingerprint, o.failure_reason",
        "FROM orders o",
        "JOIN account_connections a ON a.id = o.account_id",
        "WHERE o.status IN ('PENDING_SUBMIT','SUBMITTED','PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN_RECONCILIATION')",
        "ORDER BY o.updated_at ASC",
      ].join("\n"),
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      externalAccountId: row.external_account_id,
      order: mapOrder(row),
    }));
  }
}
