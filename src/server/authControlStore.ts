import type { PoolClient } from "pg";
import { hashPassword, verifyPassword } from "./auth";
import { PlatformDatabase } from "./platformDatabase";
import type {
  AccountConnection,
  BrokerOrder,
  TradingPermission,
  WalletBalance,
} from "../platform/types";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  status: "ACTIVE" | "LOCKED" | "CLOSED";
}

export interface AuthSession {
  sessionId: string;
  expiresAt: number;
  user: AuthUser;
}

export interface AuthenticatedAccountOverview {
  connections: AccountConnection[];
  balances: Array<WalletBalance & { total: string }>;
  openOrders: BrokerOrder[];
}

export interface BinanceReadOnlySyncInput {
  account: {
    accountType?: string;
    canTrade?: boolean;
    canWithdraw?: boolean;
    permissions?: string[];
    updateTime?: number;
  };
  accountId: string;
  balances: Array<WalletBalance & { total: string }>;
  openOrders: BrokerOrder[];
}

interface AuthUserRow {
  id: string;
  email: string;
  display_name: string;
  status: "ACTIVE" | "LOCKED" | "CLOSED";
  password_hash: string | null;
  last_login_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
}

interface AccountConnectionRow {
  id: string;
  provider: string;
  account_type: AccountConnection["accountType"];
  label: string;
  external_account_id: string | null;
  status: AccountConnection["status"];
  permissions: TradingPermission[] | null;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapUser(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
  };
}

function mapAccountConnection(row: AccountConnectionRow): AccountConnection {
  return {
    id: row.id,
    provider: row.provider,
    accountType: row.account_type,
    label: row.label,
    externalAccountId: row.external_account_id ?? undefined,
    status: row.status,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    lastSyncedAt: row.last_synced_at?.getTime(),
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(displayName: string, email: string): string {
  return displayName.trim() || email;
}

function normalizeProviderPermissions(input: BinanceReadOnlySyncInput["account"]): TradingPermission[] {
  const permissions: TradingPermission[] = ["READ"];
  if (input.canTrade === true) permissions.push("TRADE");
  if (input.canWithdraw === true) permissions.push("WITHDRAW");
  return permissions;
}

export class AuthControlStore {
  constructor(private readonly database: PlatformDatabase) {}

  private requireDatabase(): void {
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL authenticated control-plane persistence is not ready.");
    }
  }

  public async isAuthenticationConfigured(): Promise<boolean> {
    if (!this.database.isReady()) return false;
    const result = await this.database.query<{ configured: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM app_users WHERE password_hash IS NOT NULL AND status <> 'CLOSED') AS configured",
    );
    return Boolean(result.rows[0]?.configured);
  }

  public async bootstrapOperator(input: {
    email: string;
    displayName: string;
    password: string;
    resetExistingPassword?: boolean;
  }): Promise<string> {
    this.requireDatabase();
    const email = normalizeEmail(input.email);
    if (!email || !email.includes("@")) throw new Error("A valid bootstrap operator email is required.");

    const existing = await this.database.query<AuthUserRow>(
      [
        "SELECT id, email, display_name, status, password_hash, last_login_at,",
        "       failed_login_count, locked_until",
        "FROM app_users WHERE lower(email) = lower($1) LIMIT 1",
      ].join("\n"),
      [email],
    );

    if (!existing.rows[0]) {
      const passwordHash = hashPassword(input.password);
      const created = await this.database.query<{ id: string }>(
        [
          "INSERT INTO app_users(email, display_name, status, password_hash)",
          "VALUES ($1, $2, 'ACTIVE', $3)",
          "RETURNING id",
        ].join("\n"),
        [email, normalizeDisplayName(input.displayName, email), passwordHash],
      );
      if (!created.rows[0]) throw new Error("Unable to create Jarvis operator account.");
      return created.rows[0].id;
    }

    const user = existing.rows[0];
    if (user.status === "CLOSED") {
      throw new Error("The configured Jarvis operator account is closed and will not be silently reactivated.");
    }

    if (!user.password_hash || input.resetExistingPassword === true) {
      const passwordHash = hashPassword(input.password);
      await this.database.query(
        [
          "UPDATE app_users",
          "SET password_hash = $2, status = 'ACTIVE', failed_login_count = 0, locked_until = NULL, updated_at = now()",
          "WHERE id = $1",
        ].join("\n"),
        [user.id, passwordHash],
      );
    }

    return user.id;
  }

  public async authenticate(
    emailInput: string,
    password: string,
  ): Promise<{ status: "AUTHENTICATED" | "INVALID" | "LOCKED"; user?: AuthUser; lockedUntil?: number }> {
    this.requireDatabase();
    const email = normalizeEmail(emailInput);
    if (!email || !email.includes("@")) return { status: "INVALID" };

    const result = await this.database.query<AuthUserRow>(
      [
        "SELECT id, email, display_name, status, password_hash, last_login_at,",
        "       failed_login_count, locked_until",
        "FROM app_users WHERE lower(email) = lower($1) LIMIT 1",
      ].join("\n"),
      [email],
    );
    const user = result.rows[0];
    if (!user || !user.password_hash || user.status !== "ACTIVE") return { status: "INVALID" };

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      return { status: "LOCKED", lockedUntil: user.locked_until.getTime() };
    }

    if (!verifyPassword(password, user.password_hash)) {
      const failed = await this.database.query<{ locked_until: Date | null }>(
        [
          "UPDATE app_users",
          "SET",
          "  failed_login_count = CASE",
          "    WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1",
          "    ELSE failed_login_count + 1",
          "  END,",
          "  locked_until = CASE",
          "    WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_login_count + 1 END) >= 5",
          "      THEN now() + interval '15 minutes'",
          "    ELSE NULL",
          "  END,",
          "  updated_at = now()",
          "WHERE id = $1",
          "RETURNING locked_until",
        ].join("\n"),
        [user.id],
      );
      const lockedUntil = failed.rows[0]?.locked_until?.getTime();
      return lockedUntil && lockedUntil > Date.now()
        ? { status: "LOCKED", lockedUntil }
        : { status: "INVALID" };
    }

    await this.database.query(
      [
        "UPDATE app_users",
        "SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now()",
        "WHERE id = $1",
      ].join("\n"),
      [user.id],
    );

    return { status: "AUTHENTICATED", user: mapUser(user) };
  }

  public async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: number;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuthSession> {
    this.requireDatabase();
    const result = await this.database.query<{ id: string; expires_at: Date }>(
      [
        "INSERT INTO user_sessions(user_id, token_hash, expires_at, ip_address, user_agent)",
        "VALUES ($1, $2, to_timestamp($3 / 1000.0), $4::inet, $5)",
        "RETURNING id, expires_at",
      ].join("\n"),
      [input.userId, input.tokenHash, input.expiresAt, input.ipAddress || null, input.userAgent || null],
    );
    if (!result.rows[0]) throw new Error("Unable to create Jarvis authenticated session.");
    return {
      sessionId: result.rows[0].id,
      expiresAt: result.rows[0].expires_at.getTime(),
      user: (await this.getUserById(input.userId))!,
    };
  }

  public async getSession(tokenHash: string): Promise<AuthSession | null> {
    if (!this.database.isReady()) return null;
    const result = await this.database.query<{
      session_id: string;
      session_expires_at: Date;
      user_id: string;
      email: string;
      display_name: string;
      status: "ACTIVE" | "LOCKED" | "CLOSED";
    }>(
      [
        "SELECT s.id AS session_id, s.expires_at AS session_expires_at,",
        "       u.id AS user_id, u.email, u.display_name, u.status",
        "FROM user_sessions s",
        "JOIN app_users u ON u.id = s.user_id",
        "WHERE s.token_hash = $1",
        "  AND s.revoked_at IS NULL",
        "  AND s.expires_at > now()",
        "  AND u.status = 'ACTIVE'",
        "LIMIT 1",
      ].join("\n"),
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sessionId: row.session_id,
      expiresAt: row.session_expires_at.getTime(),
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name,
        status: row.status,
      },
    };
  }

  public async touchSession(sessionId: string): Promise<void> {
    await this.database.query("UPDATE user_sessions SET last_seen_at = now() WHERE id = $1", [sessionId]);
  }

  public async revokeSession(tokenHash: string): Promise<void> {
    await this.database.query(
      "UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1",
      [tokenHash],
    );
  }

  public async recordAuditEvent(input: {
    userId?: string;
    accountId?: string;
    eventType: string;
    requestId?: string;
    idempotencyKey?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    if (!this.database.isReady()) return;
    await this.database.query(
      [
        "INSERT INTO audit_events(user_id, account_id, event_type, request_id, idempotency_key, payload)",
        "VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
      ].join("\n"),
      [
        input.userId ?? null,
        input.accountId ?? null,
        input.eventType,
        input.requestId ?? null,
        input.idempotencyKey ?? null,
        JSON.stringify(input.payload),
      ],
    );
  }

  public async getAccountOverview(userId: string): Promise<AuthenticatedAccountOverview> {
    this.requireDatabase();

    const connectionsResult = await this.database.query<AccountConnectionRow>(
      [
        "SELECT id, provider, account_type, label, external_account_id,",
        "       status, permissions, last_synced_at, created_at, updated_at",
        "FROM account_connections",
        "WHERE user_id = $1",
        "ORDER BY created_at ASC",
      ].join("\n"),
      [userId],
    );
    const connections = connectionsResult.rows.map(mapAccountConnection);

    if (!connections.length) return { connections, balances: [], openOrders: [] };

    const accountIds = connections.map((connection) => connection.id);
    const balancesResult = await this.database.query<{
      account_id: string;
      asset: string;
      free: string;
      locked: string;
      total: string;
      valuation_currency: string | null;
      valuation_amount: string | null;
      provider_updated_at: Date | null;
      updated_at: Date;
    }>(
      [
        "SELECT account_id, asset, free::text, locked::text, total::text,",
        "       valuation_currency, valuation_amount::text, provider_updated_at, updated_at",
        "FROM balances WHERE account_id = ANY($1::uuid[]) ORDER BY asset ASC",
      ].join("\n"),
      [accountIds],
    );

    const ordersResult = await this.database.query<any>(
      [
        "SELECT client_order_id, account_id, instrument_id, external_order_id, side, order_type,",
        "       quantity::text, limit_price::text, stop_price::text, time_in_force, reduce_only,",
        "       strategy_id, strategy_version, reason, requested_at, status,",
        "       filled_quantity::text, average_fill_price::text, submitted_at, updated_at, last_provider_event_at",
        "FROM orders WHERE account_id = ANY($1::uuid[])",
        "  AND status IN ('SUBMITTED','PARTIALLY_FILLED','PENDING_SUBMIT','CANCEL_PENDING','UNKNOWN_RECONCILIATION')",
        "ORDER BY requested_at DESC",
      ].join("\n"),
      [accountIds],
    );

    return {
      connections,
      balances: balancesResult.rows.map((row: any) => ({
        accountId: row.account_id,
        asset: row.asset,
        free: row.free,
        locked: row.locked,
        total: row.total,
        valuationCurrency: row.valuation_currency ?? undefined,
        valuationAmount: row.valuation_amount ?? undefined,
        updatedAt: (row.provider_updated_at ?? row.updated_at).getTime(),
      })),
      openOrders: ordersResult.rows.map((row: any) => ({
        clientOrderId: row.client_order_id,
        accountId: row.account_id,
        instrumentId: row.instrument_id,
        externalOrderId: row.external_order_id ?? undefined,
        side: row.side,
        type: row.order_type,
        quantity: row.quantity,
        limitPrice: row.limit_price ?? undefined,
        stopPrice: row.stop_price ?? undefined,
        timeInForce: row.time_in_force ?? undefined,
        reduceOnly: Boolean(row.reduce_only),
        strategyId: row.strategy_id ?? undefined,
        strategyVersion: row.strategy_version ?? undefined,
        reason: row.reason ?? undefined,
        requestedAt: row.requested_at.getTime(),
        status: row.status,
        filledQuantity: row.filled_quantity,
        averageFillPrice: row.average_fill_price ?? undefined,
        submittedAt: row.submitted_at?.getTime(),
        updatedAt: row.updated_at.getTime(),
        lastProviderEventAt: row.last_provider_event_at?.getTime(),
      })),
    };
  }

  public async persistBinanceReadOnlySync(
    userId: string,
    input: BinanceReadOnlySyncInput,
    label = "Binance Spot Testnet",
  ): Promise<AccountConnection> {
    this.requireDatabase();

    return this.database.transaction(async (client: PoolClient) => {
      const existingGlobal = await client.query<{ id: string; user_id: string }>(
        [
          "SELECT id, user_id FROM account_connections",
          "WHERE provider = 'BINANCE_SPOT_TESTNET' AND external_account_id = $1",
          "LIMIT 1",
        ].join("\n"),
        [input.accountId],
      );
      if (existingGlobal.rows[0] && existingGlobal.rows[0].user_id !== userId) {
        throw new Error("This Binance provider account is already owned by another Jarvis user.");
      }

      let accountId = existingGlobal.rows[0]?.id;
      const permissions = normalizeProviderPermissions(input.account);

      if (accountId) {
        await client.query(
          [
            "UPDATE account_connections",
            "SET label = $2, status = 'CONNECTED', permissions = $3::jsonb, last_synced_at = now(), updated_at = now()",
            "WHERE id = $1",
          ].join("\n"),
          [accountId, label, JSON.stringify(permissions)],
        );
      } else {
        const created = await client.query<{ id: string }>(
          [
            "INSERT INTO account_connections(user_id, provider, account_type, label, external_account_id, status, permissions, last_synced_at)",
            "VALUES ($1, 'BINANCE_SPOT_TESTNET', 'EXCHANGE', $2, $3, 'CONNECTED', $4::jsonb, now())",
            "RETURNING id",
          ].join("\n"),
          [userId, label, input.accountId, JSON.stringify(permissions)],
        );
        accountId = created.rows[0]?.id;
      }

      if (!accountId) throw new Error("Unable to persist Binance testnet account connection.");

      const assets = input.balances.map((balance) => balance.asset.toUpperCase());
      await client.query(
        [
          "DELETE FROM balances",
          "WHERE account_id = $1",
          "  AND NOT (asset = ANY($2::text[]))",
        ].join("\n"),
        [accountId, assets],
      );

      for (const balance of input.balances) {
        await client.query(
          [
            "INSERT INTO balances(account_id, asset, free, locked, provider_updated_at, updated_at)",
            "VALUES ($1, $2, $3::numeric, $4::numeric, to_timestamp($5 / 1000.0), now())",
            "ON CONFLICT (account_id, asset)",
            "DO UPDATE SET free = EXCLUDED.free, locked = EXCLUDED.locked,",
            "              provider_updated_at = EXCLUDED.provider_updated_at, updated_at = now()",
          ].join("\n"),
          [
            accountId,
            balance.asset.toUpperCase(),
            balance.free,
            balance.locked,
            Number(balance.updatedAt) || Date.now(),
          ],
        );
      }

      const clientOrderIds = input.openOrders.map((order) => order.clientOrderId);
      await client.query(
        [
          "UPDATE orders",
          "SET status = 'UNKNOWN_RECONCILIATION', updated_at = now(), last_provider_event_at = now()",
          "WHERE account_id = $1",
          "  AND status IN ('SUBMITTED','PARTIALLY_FILLED','PENDING_SUBMIT','CANCEL_PENDING')",
          "  AND NOT (client_order_id = ANY($2::text[]))",
        ].join("\n"),
        [accountId, clientOrderIds],
      );

      for (const order of input.openOrders) {
        const instrumentExists = await client.query(
          "SELECT 1 FROM instruments WHERE instrument_id = $1 LIMIT 1",
          [order.instrumentId],
        );
        if (!instrumentExists.rows[0]) {
          await client.query(
            "INSERT INTO audit_events(user_id, account_id, event_type, payload) VALUES ($1, $2, 'PROVIDER_ORDER_SKIPPED_UNKNOWN_INSTRUMENT', $3::jsonb)",
            [userId, accountId, JSON.stringify({
              provider: "BINANCE_SPOT_TESTNET",
              clientOrderId: order.clientOrderId,
              instrumentId: order.instrumentId,
              reason: "Provider returned an order for an instrument not present in the server catalog.",
            })],
          );
          continue;
        }

        await client.query(
          [
            "INSERT INTO orders(",
            "  client_order_id, account_id, instrument_id, external_order_id, side, order_type,",
            "  quantity, limit_price, stop_price, time_in_force, reduce_only, strategy_id, strategy_version,",
            "  reason, requested_at, status, filled_quantity, average_fill_price, submitted_at, updated_at, last_provider_event_at",
            ")",
            "VALUES (",
            "  $1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9::numeric, $10,",
            "  $11, $12, $13, $14, to_timestamp($15 / 1000.0), $16, $17::numeric, $18::numeric, $19, to_timestamp($20 / 1000.0), $21",
            ")",
            "ON CONFLICT (client_order_id)",
            "DO UPDATE SET",
            "  account_id = EXCLUDED.account_id, instrument_id = EXCLUDED.instrument_id,",
            "  external_order_id = EXCLUDED.external_order_id, side = EXCLUDED.side, order_type = EXCLUDED.order_type,",
            "  quantity = EXCLUDED.quantity, limit_price = EXCLUDED.limit_price, stop_price = EXCLUDED.stop_price,",
            "  time_in_force = EXCLUDED.time_in_force, reduce_only = EXCLUDED.reduce_only,",
            "  strategy_id = EXCLUDED.strategy_id, strategy_version = EXCLUDED.strategy_version, reason = EXCLUDED.reason,",
            "  status = EXCLUDED.status, filled_quantity = EXCLUDED.filled_quantity,",
            "  average_fill_price = EXCLUDED.average_fill_price, submitted_at = EXCLUDED.submitted_at,",
            "  updated_at = EXCLUDED.updated_at, last_provider_event_at = EXCLUDED.last_provider_event_at",
            "WHERE orders.status NOT IN ('FILLED','CANCELLED','REJECTED','EXPIRED','SUBMISSION_FAILED')",
          ].join("\n"),
          [
            order.clientOrderId,
            accountId,
            order.instrumentId,
            order.externalOrderId ?? null,
            order.side,
            order.type,
            order.quantity,
            order.limitPrice ?? null,
            order.stopPrice ?? null,
            order.timeInForce ?? null,
            order.reduceOnly === true,
            order.strategyId ?? null,
            order.strategyVersion ?? null,
            order.reason ?? null,
            order.requestedAt,
            order.status,
            order.filledQuantity,
            order.averageFillPrice ?? null,
            order.submittedAt ? new Date(order.submittedAt) : null,
            order.updatedAt || Date.now(),
            order.lastProviderEventAt ?? order.updatedAt ?? Date.now(),
          ],
        );
      }

      await client.query(
        [
          "INSERT INTO audit_events(user_id, account_id, event_type, payload)",
          "VALUES ($1, $2, 'BINANCE_TESTNET_READ_ONLY_SYNC', $3::jsonb)",
        ].join("\n"),
        [
          userId,
          accountId,
          JSON.stringify({
            provider: "BINANCE_SPOT_TESTNET",
            accountId: input.accountId,
            balances: input.balances.length,
            openOrders: input.openOrders.length,
            permissions,
          }),
        ],
      );

      const row = await client.query<AccountConnectionRow>(
        [
          "SELECT id, provider, account_type, label, external_account_id,",
          "       status, permissions, last_synced_at, created_at, updated_at",
          "FROM account_connections WHERE id = $1",
        ].join("\n"),
        [accountId],
      );
      if (!row.rows[0]) throw new Error("Persisted Binance connection could not be reloaded.");
      return mapAccountConnection(row.rows[0]);
    });
  }

  private async getUserById(userId: string): Promise<AuthUser | null> {
    const result = await this.database.query<AuthUserRow>(
      [
        "SELECT id, email, display_name, status, password_hash, last_login_at,",
        "       failed_login_count, locked_until",
        "FROM app_users WHERE id = $1 LIMIT 1",
      ].join("\n"),
      [userId],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }
}
