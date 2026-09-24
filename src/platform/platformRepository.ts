import type { PoolClient } from "pg";
import type { AccountConnection, Instrument, TradingPermission } from "./types";
import { PlatformDatabase } from "../server/platformDatabase";

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

export interface BinanceReadOnlySync {
  accountId: string;
  permissions: TradingPermission[];
  balances: Array<{
    accountId: string;
    asset: string;
    free: string;
    locked: string;
    total: string;
    updatedAt: number;
  }>;
  openOrders: Array<{
    clientOrderId: string;
    accountId: string;
    instrumentId: string;
    externalOrderId?: string;
    side: "BUY" | "SELL";
    type: string;
    quantity: string;
    limitPrice?: string;
    stopPrice?: string;
    timeInForce?: string;
    reduceOnly?: boolean;
    strategyId?: string;
    strategyVersion?: number;
    reason?: string;
    requestedAt: number;
    status: string;
    filledQuantity: string;
    averageFillPrice?: string;
    submittedAt?: number;
    updatedAt: number;
    lastProviderEventAt?: number;
  }>;
}

export interface InstrumentPersistence {
  syncInstruments(instruments: Instrument[]): Promise<void>;
}

function dateToMs(value: Date | null | undefined): number | undefined {
  return value ? value.getTime() : undefined;
}

export function mapAccountConnectionRow(row: AccountConnectionRow): AccountConnection {
  return {
    id: row.id,
    provider: row.provider,
    accountType: row.account_type,
    label: row.label,
    externalAccountId: row.external_account_id ?? undefined,
    status: row.status,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    lastSyncedAt: dateToMs(row.last_synced_at),
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

export class PlatformRepository implements InstrumentPersistence {
  constructor(private readonly database: PlatformDatabase) {}

  public async syncInstruments(instruments: Instrument[]): Promise<void> {
    if (!instruments.length || !this.database.isConfigured()) return;
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL is configured but not ready; instrument persistence is unavailable.");
    }

    await this.database.transaction(async (client) => {
      for (const instrument of instruments) {
        await this.upsertInstrument(client, instrument);
      }
    });
  }

  public async ensureUser(email: string, displayName: string): Promise<string> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      throw new Error("A valid user email is required.");
    }

    const result = await this.database.query<{ id: string }>(
      [
        "INSERT INTO app_users(email, display_name, status)",
        "VALUES ($1, $2, 'ACTIVE')",
        "ON CONFLICT (email)",
        "DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()",
        "RETURNING id",
      ].join("\n"),
      [normalizedEmail, displayName.trim() || normalizedEmail],
    );

    if (!result.rows[0]) throw new Error("Unable to create or load Jarvis user.");
    return result.rows[0].id;
  }

  public async bootstrapAdminUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    resetExistingPassword?: boolean;
  }): Promise<string> {
    const normalizedEmail = input.email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      throw new Error("A valid bootstrap admin email is required.");
    }
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL is required for authenticated user bootstrap.");
    }

    const existing = await this.database.query<AuthUserRow>(
      [
        "SELECT id, email, display_name, status, password_hash, last_login_at,",
        "       failed_login_count, locked_until",
        "FROM app_users WHERE lower(email) = lower($1) LIMIT 1",
      ].join("\n"),
      [normalizedEmail],
    );

    if (!existing.rows[0]) {
      const created = await this.database.query<{ id: string }>(
        [
          "INSERT INTO app_users(email, display_name, status, password_hash)",
          "VALUES ($1, $2, 'ACTIVE', $3)",
          "RETURNING id",
        ].join("\n"),
        [normalizedEmail, input.displayName.trim() || normalizedEmail, input.passwordHash],
      );
      if (!created.rows[0]) throw new Error("Unable to create bootstrap Jarvis user.");
      return created.rows[0].id;
    }

    const user = existing.rows[0];
    if (user.status === "CLOSED") {
      throw new Error("The bootstrap user is closed and cannot be silently reactivated.");
    }

    if (!user.password_hash || input.resetExistingPassword === true) {
      await this.database.query(
        [
          "UPDATE app_users",
          "SET password_hash = $2, status = 'ACTIVE', failed_login_count = 0, locked_until = NULL, updated_at = now()",
          "WHERE id = $1",
        ].join("\n"),
        [user.id, input.passwordHash],
      );
    }

    return user.id;
  }

  public async getAuthUserByEmail(email: string): Promise<{
    id: string;
    email: string;
    displayName: string;
    status: "ACTIVE" | "LOCKED" | "CLOSED";
    passwordHash: string | null;
    failedLoginCount: number;
    lockedUntil: number | null;
  } | null> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !this.database.isReady()) return null;

    const result = await this.database.query<AuthUserRow>(
      [
        "SELECT id, email, display_name, status, password_hash, last_login_at,",
        "       failed_login_count, locked_until",
        "FROM app_users WHERE lower(email) = lower($1) LIMIT 1",
      ].join("\n"),
      [normalizedEmail],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      passwordHash: row.password_hash,
      failedLoginCount: Number(row.failed_login_count) || 0,
      lockedUntil: row.locked_until?.getTime() ?? null,
    };
  }

  public async recordFailedLogin(userId: string): Promise<{ lockedUntil: number | null }> {
    const result = await this.database.query<{ locked_until: Date | null }>(
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
      [userId],
    );
    return { lockedUntil: result.rows[0]?.locked_until?.getTime() ?? null };
  }

  public async recordSuccessfulLogin(userId: string): Promise<void> {
    await this.database.query(
      [
        "UPDATE app_users",
        "SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now()",
        "WHERE id = $1",
      ].join("\n"),
      [userId],
    );
  }

  public async createAuthSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: number;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ sessionId: string; expiresAt: number }> {
    const result = await this.database.query<{ id: string; expires_at: Date }>(
      [
        "INSERT INTO user_sessions(user_id, token_hash, expires_at, ip_address, user_agent)",
        "VALUES ($1, $2, to_timestamp($3 / 1000.0), $4::inet, $5)",
        "RETURNING id, expires_at",
      ].join("\n"),
      [input.userId, input.tokenHash, input.expiresAt, input.ipAddress || null, input.userAgent || null],
    );
    if (!result.rows[0]) throw new Error("Unable to create authenticated Jarvis session.");
    return { sessionId: result.rows[0].id, expiresAt: result.rows[0].expires_at.getTime() };
  }

  public async getAuthSession(tokenHash: string): Promise<AuthSession | null> {
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

  public async touchAuthSession(sessionId: string): Promise<void> {
    await this.database.query(
      "UPDATE user_sessions SET last_seen_at = now() WHERE id = $1",
      [sessionId],
    );
  }

  public async revokeAuthSession(tokenHash: string): Promise<void> {
    await this.database.query(
      "UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1",
      [tokenHash],
    );
  }

  public async isAuthenticationConfigured(): Promise<boolean> {
    if (!this.database.isReady()) return false;
    const result = await this.database.query<{ configured: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM app_users WHERE password_hash IS NOT NULL AND status <> 'CLOSED') AS configured",
    );
    return Boolean(result.rows[0]?.configured);
  }

  public async getAccountOverview(userId: string): Promise<{
    connections: AccountConnection[];
    balances: Array<{ accountId: string; asset: string; free: string; locked: string; total: string; updatedAt: number }>;
    openOrders: BinanceReadOnlySync["openOrders"];
  }> {
    const connections = await this.listAccountConnections(userId);
    if (!connections.length) return { connections, balances: [], openOrders: [] };

    const accountIds = connections.map((connection) => connection.id);
    const balancesResult = await this.database.query<{
      account_id: string;
      asset: string;
      free: string;
      locked: string;
      total: string;
      provider_updated_at: Date | null;
      updated_at: Date;
    }>(
      [
        "SELECT account_id, asset, free::text, locked::text, total::text, provider_updated_at, updated_at",
        "FROM balances WHERE account_id = ANY($1::uuid[]) ORDER BY asset ASC",
      ].join("\n"),
      [accountIds],
    );

    const orderResult = await this.database.query<{
      client_order_id: string;
      account_id: string;
      instrument_id: string;
      external_order_id: string | null;
      side: "BUY" | "SELL";
      order_type: string;
      quantity: string;
      limit_price: string | null;
      stop_price: string | null;
      time_in_force: string | null;
      reduce_only: boolean;
      strategy_id: string | null;
      strategy_version: number | null;
      reason: string | null;
      requested_at: Date;
      status: string;
      filled_quantity: string;
      average_fill_price: string | null;
      submitted_at: Date | null;
      updated_at: Date;
      last_provider_event_at: Date | null;
    }>(
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
      balances: balancesResult.rows.map((row) => ({
        accountId: row.account_id,
        asset: row.asset,
        free: row.free,
        locked: row.locked,
        total: row.total,
        updatedAt: (row.provider_updated_at ?? row.updated_at).getTime(),
      })),
      openOrders: orderResult.rows.map((row) => ({
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
        reduceOnly: row.reduce_only,
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

  public async syncBinanceReadOnlyAccount(
    userId: string,
    input: BinanceReadOnlySync,
    label = "Binance Spot Testnet",
  ): Promise<AccountConnection> {
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL is required to persist a connected account.");
    }

    return this.database.transaction(async (client) => {
      const existing = await client.query<AccountConnectionRow>(
        [
          "SELECT id, provider, account_type, label, external_account_id, status, permissions,",
          "       last_synced_at, created_at, updated_at",
          "FROM account_connections",
          "WHERE user_id = $1 AND provider = 'BINANCE_SPOT_TESTNET'",
          "ORDER BY created_at ASC LIMIT 1",
        ].join("\n"),
        [userId],
      );

      let accountId = existing.rows[0]?.id;
      if (accountId) {
        await client.query(
          [
            "UPDATE account_connections",
            "SET label = $2, external_account_id = $3, status = 'CONNECTED',",
            "    permissions = $4::jsonb, last_synced_at = now(), updated_at = now()",
            "WHERE id = $1",
          ].join("\n"),
          [accountId, label, input.accountId, JSON.stringify(input.permissions)],
        );
      } else {
        const created = await client.query<{ id: string }>(
          [
            "INSERT INTO account_connections(",
            "  user_id, provider, account_type, label, external_account_id, status, permissions, last_synced_at",
            ")",
            "VALUES ($1, 'BINANCE_SPOT_TESTNET', 'EXCHANGE', $2, $3, 'CONNECTED', $4::jsonb, now())",
            "RETURNING id",
          ].join("\n"),
          [userId, label, input.accountId, JSON.stringify(input.permissions)],
        );
        accountId = created.rows[0]?.id;
      }

      if (!accountId) throw new Error("Unable to persist Binance testnet account connection.");

      const assets = input.balances.map((balance) => balance.asset);
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
          [accountId, balance.asset, balance.free, balance.locked, balance.updatedAt],
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
        await client.query(
          [
            "INSERT INTO orders(",
            "  client_order_id, account_id, instrument_id, external_order_id, side, order_type,",
            "  quantity, limit_price, stop_price, time_in_force, reduce_only, strategy_id, strategy_version,",
            "  reason, status, filled_quantity, average_fill_price, requested_at, submitted_at, updated_at, last_provider_event_at",
            ")",
            "VALUES (",
            "  $1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9::numeric, $10,",
            "  $11, $12, $13, $14, $15, $16::numeric, $17::numeric,",
            "  to_timestamp($18 / 1000.0), $19, to_timestamp($20 / 1000.0), $21",
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
            order.status,
            order.filledQuantity,
            order.averageFillPrice ?? null,
            order.requestedAt,
            order.submittedAt ? new Date(order.submittedAt) : null,
            order.updatedAt,
            order.lastProviderEventAt ?? order.updatedAt,
          ],
        );
      }

      const row = await client.query<AccountConnectionRow>(
        [
          "SELECT id, provider, account_type, label, external_account_id, status, permissions,",
          "       last_synced_at, created_at, updated_at",
          "FROM account_connections WHERE id = $1",
        ].join("\n"),
        [accountId],
      );
      if (!row.rows[0]) throw new Error("Persisted Binance connection could not be reloaded.");
      return mapAccountConnectionRow(row.rows[0]);
    });
  }

  public async listAccountConnections(userId: string): Promise<AccountConnection[]> {
    const result = await this.database.query<AccountConnectionRow>(
      [
        "SELECT id, provider, account_type, label, external_account_id,",
        "       status, permissions, last_synced_at, created_at, updated_at",
        "FROM account_connections",
        "WHERE user_id = $1",
        "ORDER BY created_at ASC",
      ].join("\n"),
      [userId],
    );
    return result.rows.map(mapAccountConnectionRow);
  }

  public async recordAuditEvent(input: {
    userId?: string;
    accountId?: string;
    eventType: string;
    requestId?: string;
    idempotencyKey?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.database.query(
      [
        "INSERT INTO audit_events(",
        "  user_id, account_id, event_type, request_id, idempotency_key, payload",
        ")",
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

  private async upsertInstrument(client: PoolClient, instrument: Instrument): Promise<void> {
    await client.query(
      [
        "INSERT INTO instruments(",
        "  instrument_id, provider, venue, venue_kind, symbol, display_symbol, name,",
        "  asset_class, market, base_asset, quote_asset, currency, provider_symbol,",
        "  status, tradable, shortable, fractionable, tick_size, lot_size,",
        "  min_quantity, max_quantity, min_notional, price_precision,",
        "  quantity_precision, contract_multiplier, listing_time, delisting_time,",
        "  session, updated_at",
        ")",
        "VALUES (",
        "  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,",
        "  $14, $15, $16, $17, $18::numeric, $19::numeric, $20::numeric,",
        "  $21::numeric, $22::numeric, $23, $24, $25::numeric, $26::timestamptz,",
        "  $27::timestamptz, $28::jsonb, now()",
        ")",
        "ON CONFLICT (instrument_id)",
        "DO UPDATE SET",
        "  provider = EXCLUDED.provider,",
        "  venue = EXCLUDED.venue,",
        "  venue_kind = EXCLUDED.venue_kind,",
        "  symbol = EXCLUDED.symbol,",
        "  display_symbol = EXCLUDED.display_symbol,",
        "  name = EXCLUDED.name,",
        "  asset_class = EXCLUDED.asset_class,",
        "  market = EXCLUDED.market,",
        "  base_asset = EXCLUDED.base_asset,",
        "  quote_asset = EXCLUDED.quote_asset,",
        "  currency = EXCLUDED.currency,",
        "  provider_symbol = EXCLUDED.provider_symbol,",
        "  status = EXCLUDED.status,",
        "  tradable = EXCLUDED.tradable,",
        "  shortable = EXCLUDED.shortable,",
        "  fractionable = EXCLUDED.fractionable,",
        "  tick_size = EXCLUDED.tick_size,",
        "  lot_size = EXCLUDED.lot_size,",
        "  min_quantity = EXCLUDED.min_quantity,",
        "  max_quantity = EXCLUDED.max_quantity,",
        "  min_notional = EXCLUDED.min_notional,",
        "  price_precision = EXCLUDED.price_precision,",
        "  quantity_precision = EXCLUDED.quantity_precision,",
        "  contract_multiplier = EXCLUDED.contract_multiplier,",
        "  listing_time = EXCLUDED.listing_time,",
        "  delisting_time = EXCLUDED.delisting_time,",
        "  session = EXCLUDED.session,",
        "  updated_at = now()",
      ].join("\n"),
      [
        instrument.instrumentId,
        instrument.provider,
        instrument.venue,
        instrument.venueKind,
        instrument.symbol,
        instrument.displaySymbol,
        instrument.name,
        instrument.assetClass,
        instrument.market,
        instrument.baseAsset ?? null,
        instrument.quoteAsset ?? null,
        instrument.currency ?? null,
        instrument.providerSymbol,
        instrument.status,
        instrument.tradable,
        instrument.shortable ?? null,
        instrument.fractionable ?? null,
        instrument.tickSize ?? null,
        instrument.lotSize ?? null,
        instrument.minQuantity ?? null,
        instrument.maxQuantity ?? null,
        instrument.minNotional ?? null,
        instrument.pricePrecision ?? null,
        instrument.quantityPrecision ?? null,
        instrument.contractMultiplier ?? null,
        instrument.listingTime ? new Date(instrument.listingTime) : null,
        instrument.delistingTime ? new Date(instrument.delistingTime) : null,
        instrument.session ? JSON.stringify(instrument.session) : null,
      ],
    );
  }
}
