import type { PoolClient } from "pg";
import type { AccountConnection, BrokerOrder, Fill, Instrument, OrderIntent, OrderStatus, TradingPermission } from "./types";
import type { Trade } from "../types/trading";
import { PlatformDatabase } from "../server/platformDatabase";
import { canTransitionOrderStatus } from "./orderStateMachine";

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


interface ExecutionInstrument {
  instrumentId: string;
  provider: string;
  venue: string;
  providerSymbol: string;
  tradable: boolean;
  status: "ACTIVE" | "SUSPENDED" | "DELISTED";
}

export interface PersistedOrder {
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
  reduceOnly: boolean;
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
  idempotencyKey?: string;
  idempotencyFingerprint?: string;
}

export interface ShadowRuntimeRecord {
  id: string;
  userId: string;
  strategyId: string;
  strategyVersion: number;
  symbol: string;
  status: "STOPPED" | "STARTING" | "RUNNING" | "WAITING_FOR_DATA" | "HALTED" | "ERROR";
  runtimeState: Record<string, unknown>;
  lastProcessedCandleAt?: number;
  startedAt?: number;
  updatedAt: number;
}

export interface ShadowEvidenceSummary {
  runtimeId: string;
  strategyId: string;
  strategyVersion: number;
  symbol: string;
  status: ShadowRuntimeRecord["status"];
  firstObservationAt: number | null;
  lastObservationAt: number | null;
  observationCount: number;
  forwardCalendarDays: number;
  maxDrawdownPercent: string;
  latestEquity: string | null;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: string;
  profitFactor: string;
  expectancyPerTrade: string;
  totalPnl: string;
  totalFees: string;
}

export interface StrategyValidationRecord {
  id: string;
  userId: string;
  strategyId: string;
  strategyVersion: number;
  strategyName: string;
  status: "INSUFFICIENT_EVIDENCE" | "FAILED" | "PROVISIONALLY_VALIDATED";
  evaluatedAt: number;
  evidenceHash: string;
  policy: Record<string, unknown>;
  metrics: Record<string, unknown>;
  source: "CLIENT_SUBMITTED" | "SERVER_RECOMPUTED";
  strategy?: Record<string, unknown>;
  createdAt: number;
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

  public isPersistenceReady(): boolean {
    return this.database.isReady();
  }

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
    fills: Array<{
      id: string;
      accountId: string;
      clientOrderId: string;
      externalOrderId?: string;
      externalTradeId?: string;
      instrumentId: string;
      side: "BUY" | "SELL";
      quantity: string;
      price: string;
      feeAmount?: string;
      feeAsset?: string;
      liquidity?: string;
      executedAt: number;
    }>;
  }> {
    const connections = await this.listAccountConnections(userId);
    if (!connections.length) return { connections, balances: [], openOrders: [], fills: [] };

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

    const fillsResult = await this.database.query<{
      id: string;
      account_id: string;
      client_order_id: string;
      external_order_id: string | null;
      external_trade_id: string | null;
      instrument_id: string;
      side: "BUY" | "SELL";
      quantity: string;
      price: string;
      fee_amount: string | null;
      fee_asset: string | null;
      liquidity: string | null;
      executed_at: Date;
    }>(
      [
        "SELECT id, account_id, client_order_id, external_order_id, external_trade_id, instrument_id, side,",
        "       quantity::text, price::text, fee_amount::text, fee_asset, liquidity, executed_at",
        "FROM fills WHERE account_id = ANY($1::uuid[])",
        "ORDER BY executed_at DESC LIMIT 100",
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
      fills: fillsResult.rows.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        clientOrderId: row.client_order_id,
        externalOrderId: row.external_order_id ?? undefined,
        externalTradeId: row.external_trade_id ?? undefined,
        instrumentId: row.instrument_id,
        side: row.side,
        quantity: row.quantity,
        price: row.price,
        feeAmount: row.fee_amount ?? undefined,
        feeAsset: row.fee_asset ?? undefined,
        liquidity: row.liquidity ?? undefined,
        executedAt: row.executed_at.getTime(),
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

  public async getExecutionInstrument(instrumentId: string): Promise<Instrument | null> {
    if (!this.database.isReady()) return null;

    const result = await this.database.query<any>(
      [
        "SELECT instrument_id, symbol, display_symbol, name, asset_class, venue, venue_kind, market,",
        "       base_asset, quote_asset, currency, provider, provider_symbol, status, tradable,",
        "       shortable, fractionable, tick_size::text, lot_size::text, min_quantity::text,",
        "       max_quantity::text, min_notional::text, price_precision, quantity_precision,",
        "       contract_multiplier::text, listing_time, delisting_time, session, updated_at",
        "FROM instruments WHERE instrument_id = $1 LIMIT 1",
      ].join("\n"),
      [instrumentId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      instrumentId: row.instrument_id,
      symbol: row.symbol,
      displaySymbol: row.display_symbol,
      name: row.name,
      assetClass: row.asset_class,
      venue: row.venue,
      venueKind: row.venue_kind,
      market: row.market,
      baseAsset: row.base_asset ?? undefined,
      quoteAsset: row.quote_asset ?? undefined,
      currency: row.currency ?? undefined,
      provider: row.provider,
      providerSymbol: row.provider_symbol,
      status: row.status,
      tradable: Boolean(row.tradable),
      shortable: row.shortable ?? undefined,
      fractionable: row.fractionable ?? undefined,
      tickSize: row.tick_size ?? undefined,
      lotSize: row.lot_size ?? undefined,
      minQuantity: row.min_quantity ?? undefined,
      maxQuantity: row.max_quantity ?? undefined,
      minNotional: row.min_notional ?? undefined,
      pricePrecision: row.price_precision ?? undefined,
      quantityPrecision: row.quantity_precision ?? undefined,
      contractMultiplier: row.contract_multiplier ?? undefined,
      listingTime: row.listing_time ? new Date(row.listing_time).getTime() : undefined,
      delistingTime: row.delisting_time ? new Date(row.delisting_time).getTime() : undefined,
      session: row.session ?? undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    };
  }

  public async recordStrategyValidation(input: {
    userId: string;
    strategyId: string;
    strategyVersion: number;
    strategyName: string;
    status: StrategyValidationRecord["status"];
    evaluatedAt: number;
    evidenceHash: string;
    policy: Record<string, unknown>;
    metrics: Record<string, unknown>;
    source?: StrategyValidationRecord["source"];
    strategy?: Record<string, unknown>;
  }): Promise<StrategyValidationRecord> {
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL is required for strategy validation persistence.");
    }

    const result = await this.database.query<{
      id: string;
      user_id: string;
      strategy_id: string;
      strategy_version: number;
      strategy_name: string;
      status: StrategyValidationRecord["status"];
      evaluated_at: Date;
      evidence_hash: string;
      policy: Record<string, unknown>;
      metrics: Record<string, unknown>;
      source: StrategyValidationRecord["source"];
      strategy: Record<string, unknown> | null;
      created_at: Date;
    }>(
      [
        "INSERT INTO strategy_validation_runs(",
        "  user_id, strategy_id, strategy_version, strategy_name, status, evaluated_at,",
        "  evidence_hash, policy, metrics, source, strategy",
        ") VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0),$7,$8::jsonb,$9::jsonb,$10,$11::jsonb)",
        "ON CONFLICT (user_id, strategy_id, strategy_version, evidence_hash)",
        "DO UPDATE SET",
        "  status = EXCLUDED.status, evaluated_at = EXCLUDED.evaluated_at,",
        "  policy = EXCLUDED.policy, metrics = EXCLUDED.metrics, source = EXCLUDED.source,",
        "  strategy = COALESCE(EXCLUDED.strategy, strategy_validation_runs.strategy)",
        "RETURNING id, user_id, strategy_id, strategy_version, strategy_name, status, evaluated_at,",
        "          evidence_hash, policy, metrics, source, strategy, created_at",
      ].join("\n"),
      [
        input.userId,
        input.strategyId,
        input.strategyVersion,
        input.strategyName,
        input.status,
        input.evaluatedAt,
        input.evidenceHash,
        JSON.stringify(input.policy),
        JSON.stringify(input.metrics),
        input.source || "CLIENT_SUBMITTED",
        input.strategy ? JSON.stringify(input.strategy) : null,
      ],
    );

    const row = result.rows[0];
    if (!row) throw new Error("Strategy validation evidence could not be persisted.");
    return {
      id: row.id,
      userId: row.user_id,
      strategyId: row.strategy_id,
      strategyVersion: row.strategy_version,
      strategyName: row.strategy_name,
      status: row.status,
      evaluatedAt: row.evaluated_at.getTime(),
      evidenceHash: row.evidence_hash,
      policy: row.policy,
      metrics: row.metrics,
      source: row.source,
      strategy: row.strategy || undefined,
      createdAt: row.created_at.getTime(),
    };
  }

  public async getLatestStrategyValidation(
    userId: string,
    strategyId: string,
  ): Promise<StrategyValidationRecord | null> {
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL is required for strategy validation persistence.");
    }

    const result = await this.database.query<{
      id: string;
      user_id: string;
      strategy_id: string;
      strategy_version: number;
      strategy_name: string;
      status: StrategyValidationRecord["status"];
      evaluated_at: Date;
      evidence_hash: string;
      policy: Record<string, unknown>;
      metrics: Record<string, unknown>;
      source: StrategyValidationRecord["source"];
      strategy: Record<string, unknown> | null;
      created_at: Date;
    }>(
      [
        "SELECT id, user_id, strategy_id, strategy_version, strategy_name, status, evaluated_at,",
        "       evidence_hash, policy, metrics, source, strategy, created_at",
        "FROM strategy_validation_runs",
        "WHERE user_id = $1 AND strategy_id = $2",
        "ORDER BY strategy_version DESC, evaluated_at DESC",
        "LIMIT 1",
      ].join("\n"),
      [userId, strategyId],
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      strategyId: row.strategy_id,
      strategyVersion: row.strategy_version,
      strategyName: row.strategy_name,
      status: row.status,
      evaluatedAt: row.evaluated_at.getTime(),
      evidenceHash: row.evidence_hash,
      policy: row.policy,
      metrics: row.metrics,
      source: row.source,
      strategy: row.strategy || undefined,
      createdAt: row.created_at.getTime(),
    };
  }

  public async loadShadowRuntime(
    userId: string,
    strategyId: string,
    symbol: string,
  ): Promise<ShadowRuntimeRecord | null> {
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL is required for durable shadow runtime state.");
    }

    const result = await this.database.query<{
      id: string;
      user_id: string;
      strategy_id: string;
      strategy_version: number;
      symbol: string;
      status: ShadowRuntimeRecord["status"];
      runtime_state: Record<string, unknown>;
      last_processed_candle_at: Date | null;
      started_at: Date | null;
      updated_at: Date;
    }>(
      [
        "SELECT id, user_id, strategy_id, strategy_version, symbol, status, runtime_state,",
        "       last_processed_candle_at, started_at, updated_at",
        "FROM shadow_runtime_states",
        "WHERE user_id = $1 AND strategy_id = $2 AND symbol = $3",
        "LIMIT 1",
      ].join("\n"),
      [userId, strategyId, symbol],
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      strategyId: row.strategy_id,
      strategyVersion: row.strategy_version,
      symbol: row.symbol,
      status: row.status,
      runtimeState: row.runtime_state,
      lastProcessedCandleAt: dateToMs(row.last_processed_candle_at),
      startedAt: dateToMs(row.started_at),
      updatedAt: row.updated_at.getTime(),
    };
  }

  public async saveShadowRuntime(input: {
    userId: string;
    strategyId: string;
    strategyVersion: number;
    symbol: string;
    status: ShadowRuntimeRecord["status"];
    runtimeState: Record<string, unknown>;
    lastProcessedCandleAt?: number;
    startedAt?: number;
  }): Promise<ShadowRuntimeRecord> {
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL is required for durable shadow runtime state.");
    }

    const result = await this.database.query<{
      id: string;
      user_id: string;
      strategy_id: string;
      strategy_version: number;
      symbol: string;
      status: ShadowRuntimeRecord["status"];
      runtime_state: Record<string, unknown>;
      last_processed_candle_at: Date | null;
      started_at: Date | null;
      updated_at: Date;
    }>(
      [
        "INSERT INTO shadow_runtime_states(",
        "  user_id, strategy_id, strategy_version, symbol, status, runtime_state,",
        "  last_processed_candle_at, started_at, updated_at",
        ") VALUES ($1,$2,$3,$4,$5,$6::jsonb,",
        "  CASE WHEN $7::bigint > 0 THEN to_timestamp($7 / 1000.0) ELSE NULL END,",
        "  CASE WHEN $8::bigint > 0 THEN to_timestamp($8 / 1000.0) ELSE NULL END,",
        "  now())",
        "ON CONFLICT (user_id, strategy_id, symbol)",
        "DO UPDATE SET",
        "  strategy_version = EXCLUDED.strategy_version, status = EXCLUDED.status,",
        "  runtime_state = EXCLUDED.runtime_state,",
        "  last_processed_candle_at = EXCLUDED.last_processed_candle_at,",
        "  started_at = COALESCE(EXCLUDED.started_at, shadow_runtime_states.started_at),",
        "  updated_at = now()",
        "RETURNING id, user_id, strategy_id, strategy_version, symbol, status, runtime_state,",
        "          last_processed_candle_at, started_at, updated_at",
      ].join("\n"),
      [
        input.userId,
        input.strategyId,
        input.strategyVersion,
        input.symbol,
        input.status,
        JSON.stringify(input.runtimeState),
        input.lastProcessedCandleAt ?? 0,
        input.startedAt ?? 0,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Shadow runtime state could not be persisted.");
    return {
      id: row.id,
      userId: row.user_id,
      strategyId: row.strategy_id,
      strategyVersion: row.strategy_version,
      symbol: row.symbol,
      status: row.status,
      runtimeState: row.runtime_state,
      lastProcessedCandleAt: dateToMs(row.last_processed_candle_at),
      startedAt: dateToMs(row.started_at),
      updatedAt: row.updated_at.getTime(),
    };
  }

  public async recordShadowObservation(input: {
    runtimeId: string;
    candleTimestamp: number;
    closePrice: string;
    equity: string;
    cash: string;
    drawdownPercent: string;
    dailyDrawdownPercent: string;
    botState: string;
    eventType: "HEARTBEAT" | "SIGNAL" | "ENTRY" | "EXIT" | "HALT";
    signal?: Record<string, unknown> | null;
    activeTrade?: Record<string, unknown> | null;
    tradeEvent?: Record<string, unknown> | null;
  }): Promise<void> {
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL is required for shadow evidence persistence.");
    }

    await this.database.query(
      [
        "INSERT INTO shadow_equity_snapshots(",
        "  runtime_id, candle_timestamp, processed_at, close_price, equity, cash,",
        "  drawdown_percent, daily_drawdown_percent, bot_state, event_type, signal,",
        "  active_trade, trade_event",
        ") VALUES ($1,to_timestamp($2 / 1000.0),now(),$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb)",
        "ON CONFLICT (runtime_id, candle_timestamp)",
        "DO UPDATE SET",
        "  processed_at = now(), close_price = EXCLUDED.close_price,",
        "  equity = EXCLUDED.equity, cash = EXCLUDED.cash,",
        "  drawdown_percent = EXCLUDED.drawdown_percent,",
        "  daily_drawdown_percent = EXCLUDED.daily_drawdown_percent,",
        "  bot_state = EXCLUDED.bot_state, event_type = EXCLUDED.event_type,",
        "  signal = EXCLUDED.signal, active_trade = EXCLUDED.active_trade,",
        "  trade_event = EXCLUDED.trade_event",
      ].join("\n"),
      [
        input.runtimeId,
        input.candleTimestamp,
        input.closePrice,
        input.equity,
        input.cash,
        input.drawdownPercent,
        input.dailyDrawdownPercent,
        input.botState,
        input.eventType,
        input.signal ? JSON.stringify(input.signal) : null,
        input.activeTrade ? JSON.stringify(input.activeTrade) : null,
        input.tradeEvent ? JSON.stringify(input.tradeEvent) : null,
      ],
    );
  }

  public async upsertShadowTrade(runtimeId: string, trade: Trade): Promise<void> {
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL is required for shadow trade persistence.");
    }

    await this.database.query(
      [
        "INSERT INTO shadow_trades(",
        "  runtime_id, trade_id, asset, trade_type, entry_price, exit_price, amount, size_usd,",
        "  margin_usd, entry_time, exit_time, stop_loss, take_profit, highest_price, lowest_price,",
        "  pnl, pnl_percent, fees_usd, slippage_usd, status, signal_score, confidence, rationale",
        ") VALUES (",
        "  $1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10 / 1000.0),",
        "  CASE WHEN $11::bigint > 0 THEN to_timestamp($11 / 1000.0) ELSE NULL END,",
        "  $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23",
        ")",
        "ON CONFLICT (runtime_id, trade_id)",
        "DO UPDATE SET",
        "  exit_price = EXCLUDED.exit_price, amount = EXCLUDED.amount, size_usd = EXCLUDED.size_usd,",
        "  margin_usd = EXCLUDED.margin_usd, exit_time = EXCLUDED.exit_time,",
        "  stop_loss = EXCLUDED.stop_loss, take_profit = EXCLUDED.take_profit,",
        "  highest_price = EXCLUDED.highest_price, lowest_price = EXCLUDED.lowest_price,",
        "  pnl = EXCLUDED.pnl, pnl_percent = EXCLUDED.pnl_percent, fees_usd = EXCLUDED.fees_usd,",
        "  slippage_usd = EXCLUDED.slippage_usd, status = EXCLUDED.status,",
        "  signal_score = EXCLUDED.signal_score, confidence = EXCLUDED.confidence,",
        "  rationale = EXCLUDED.rationale, updated_at = now()",
      ].join("\n"),
      [
        runtimeId,
        trade.id,
        trade.asset,
        trade.type,
        String(trade.entryPrice),
        trade.exitPrice === undefined ? null : String(trade.exitPrice),
        String(trade.amount),
        String(trade.sizeUsd),
        trade.marginUsd === undefined ? null : String(trade.marginUsd),
        trade.entryTime,
        trade.exitTime ?? 0,
        String(trade.stopLoss),
        String(trade.takeProfit),
        trade.highestPrice === undefined ? null : String(trade.highestPrice),
        trade.lowestPrice === undefined ? null : String(trade.lowestPrice),
        String(trade.pnl),
        String(trade.pnlPercent),
        trade.feesUsd === undefined ? null : String(trade.feesUsd),
        trade.slippageUsd === undefined ? null : String(trade.slippageUsd),
        trade.status,
        String(trade.signalScore),
        String(trade.confidence),
        trade.rationale,
      ],
    );
  }

  public async getShadowEvidenceSummary(
    userId: string,
    strategyId: string,
    symbol: string,
  ): Promise<ShadowEvidenceSummary | null> {
    if (!this.database.isReady()) {
      throw new Error("PostgreSQL is required for shadow evidence reads.");
    }

    const runtimeResult = await this.database.query<{
      id: string;
      strategy_id: string;
      strategy_version: number;
      symbol: string;
      status: ShadowRuntimeRecord["status"];
      first_observation_at: Date | null;
      last_observation_at: Date | null;
      observation_count: string;
      max_drawdown_percent: string | null;
      latest_equity: string | null;
    }>(
      [
        "SELECT r.id, r.strategy_id, r.strategy_version, r.symbol, r.status,",
        "       MIN(s.candle_timestamp) AS first_observation_at,",
        "       MAX(s.candle_timestamp) AS last_observation_at,",
        "       COUNT(s.id)::text AS observation_count,",
        "       COALESCE(MAX(s.drawdown_percent), 0)::text AS max_drawdown_percent,",
        "       (SELECT s2.equity::text FROM shadow_equity_snapshots s2",
        "        WHERE s2.runtime_id = r.id ORDER BY s2.candle_timestamp DESC LIMIT 1) AS latest_equity",
        "FROM shadow_runtime_states r",
        "LEFT JOIN shadow_equity_snapshots s ON s.runtime_id = r.id",
        "WHERE r.user_id = $1 AND r.strategy_id = $2 AND r.symbol = $3",
        "GROUP BY r.id, r.strategy_id, r.strategy_version, r.symbol, r.status",
        "ORDER BY r.updated_at DESC",
        "LIMIT 1",
      ].join("\n"),
      [userId, strategyId, symbol],
    );

    const runtime = runtimeResult.rows[0];
    if (!runtime) return null;

    const tradeResult = await this.database.query<{
      closed_trades: string;
      winning_trades: string;
      losing_trades: string;
      gross_wins: string | null;
      gross_losses: string | null;
      total_pnl: string | null;
      total_fees: string | null;
    }>(
      [
        "SELECT",
        "  COUNT(*) FILTER (WHERE status <> 'OPEN')::text AS closed_trades,",
        "  COUNT(*) FILTER (WHERE status <> 'OPEN' AND pnl > 0)::text AS winning_trades,",
        "  COUNT(*) FILTER (WHERE status <> 'OPEN' AND pnl < 0)::text AS losing_trades,",
        "  COALESCE(SUM(pnl) FILTER (WHERE status <> 'OPEN' AND pnl > 0), 0)::text AS gross_wins,",
        "  COALESCE(SUM(CASE WHEN status <> 'OPEN' AND pnl < 0 THEN ABS(pnl) ELSE 0 END), 0)::text AS gross_losses,",
        "  COALESCE(SUM(pnl) FILTER (WHERE status <> 'OPEN'), 0)::text AS total_pnl,",
        "  COALESCE(SUM(fees_usd) FILTER (WHERE status <> 'OPEN'), 0)::text AS total_fees",
        "FROM shadow_trades",
        "WHERE runtime_id = $1",
      ].join("\n"),
      [runtime.id],
    );

    const trades = tradeResult.rows[0];
    const closedTrades = Number(trades?.closed_trades || 0);
    const winningTrades = Number(trades?.winning_trades || 0);
    const losingTrades = Number(trades?.losing_trades || 0);
    const firstAt = runtime.first_observation_at?.getTime() ?? null;
    const lastAt = runtime.last_observation_at?.getTime() ?? null;
    const forwardCalendarDays =
      firstAt !== null && lastAt !== null
        ? Math.max(0, (lastAt - firstAt) / 86_400_000)
        : 0;
    const winRatePercent =
      closedTrades > 0 ? ((winningTrades / closedTrades) * 100).toFixed(2) : "0";
    const grossWins = trades?.gross_wins || "0";
    const grossLosses = trades?.gross_losses || "0";
    const profitFactor =
      Number(grossLosses) > 0
        ? (Number(grossWins) / Number(grossLosses)).toFixed(4)
        : Number(grossWins) > 0
          ? "INF"
          : "0";
    const expectancyPerTrade =
      closedTrades > 0
        ? (Number(trades?.total_pnl || "0") / closedTrades).toFixed(8)
        : "0";

    return {
      runtimeId: runtime.id,
      strategyId: runtime.strategy_id,
      strategyVersion: runtime.strategy_version,
      symbol: runtime.symbol,
      status: runtime.status,
      firstObservationAt: firstAt,
      lastObservationAt: lastAt,
      observationCount: Number(runtime.observation_count || 0),
      forwardCalendarDays: Number(forwardCalendarDays.toFixed(2)),
      maxDrawdownPercent: runtime.max_drawdown_percent || "0",
      latestEquity: runtime.latest_equity,
      closedTrades,
      winningTrades,
      losingTrades,
      winRatePercent,
      profitFactor,
      expectancyPerTrade,
      totalPnl: trades?.total_pnl || "0",
      totalFees: trades?.total_fees || "0",
    };
  }

  public async getUserAccountConnection(userId: string, accountId: string): Promise<AccountConnection | null> {
    const result = await this.database.query<AccountConnectionRow>(
      [
        "SELECT id, provider, account_type, label, external_account_id, status, permissions,",
        "       last_synced_at, created_at, updated_at",
        "FROM account_connections WHERE id = $1 AND user_id = $2 LIMIT 1",
      ].join("\n"),
      [accountId, userId],
    );
    return result.rows[0] ? mapAccountConnectionRow(result.rows[0]) : null;
  }

  public async listActiveOrdersForUser(userId: string): Promise<PersistedOrder[]> {
    const result = await this.database.query<any>(
      [
        "SELECT o.client_order_id, o.account_id, o.instrument_id, o.external_order_id, o.side, o.order_type,",
        "       o.quantity::text, o.limit_price::text, o.stop_price::text, o.time_in_force, o.reduce_only,",
        "       o.strategy_id, o.strategy_version, o.reason, o.requested_at, o.status,",
        "       o.filled_quantity::text, o.average_fill_price::text, o.submitted_at, o.updated_at,",
        "       o.last_provider_event_at, o.idempotency_key, o.idempotency_fingerprint",
        "FROM orders o",
        "JOIN account_connections a ON a.id = o.account_id",
        "WHERE a.user_id = $1",
        "  AND a.provider = 'BINANCE_SPOT_TESTNET'",
        "  AND o.status IN ('PENDING_SUBMIT','SUBMITTED','PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN_RECONCILIATION')",
        "ORDER BY o.updated_at ASC",
        "LIMIT 100",
      ].join("\n"),
      [userId],
    );
    return result.rows.map((row) => this.mapPersistedOrderRow(row));
  }

  public async getUserOrder(userId: string, clientOrderId: string): Promise<PersistedOrder | null> {
    const result = await this.database.query<any>(
      [
        "SELECT o.client_order_id, o.account_id, o.instrument_id, o.external_order_id, o.side, o.order_type,",
        "       o.quantity::text, o.limit_price::text, o.stop_price::text, o.time_in_force, o.reduce_only,",
        "       o.strategy_id, o.strategy_version, o.reason, o.requested_at, o.status,",
        "       o.filled_quantity::text, o.average_fill_price::text, o.submitted_at, o.updated_at,",
        "       o.last_provider_event_at, o.idempotency_key, o.idempotency_fingerprint",
        "FROM orders o",
        "JOIN account_connections a ON a.id = o.account_id",
        "WHERE o.client_order_id = $1 AND a.user_id = $2",
        "LIMIT 1",
      ].join("\n"),
      [clientOrderId, userId],
    );
    return result.rows[0] ? this.mapPersistedOrderRow(result.rows[0]) : null;
  }

  public async getOrderByIdempotencyKey(userId: string, accountId: string, idempotencyKey: string): Promise<PersistedOrder | null> {
    const result = await this.database.query<any>(
      [
        "SELECT o.client_order_id, o.account_id, o.instrument_id, o.external_order_id, o.side, o.order_type,",
        "       o.quantity::text, o.limit_price::text, o.stop_price::text, o.time_in_force, o.reduce_only,",
        "       o.strategy_id, o.strategy_version, o.reason, o.requested_at, o.status,",
        "       o.filled_quantity::text, o.average_fill_price::text, o.submitted_at, o.updated_at,",
        "       o.last_provider_event_at, o.idempotency_key, o.idempotency_fingerprint",
        "FROM orders o",
        "JOIN account_connections a ON a.id = o.account_id",
        "WHERE o.account_id = $1 AND a.user_id = $2 AND o.idempotency_key = $3",
        "LIMIT 1",
      ].join("\n"),
      [accountId, userId, idempotencyKey],
    );
    return result.rows[0] ? this.mapPersistedOrderRow(result.rows[0]) : null;
  }

  public async createPendingOrder(
    userId: string,
    accountId: string,
    idempotencyKey: string,
    idempotencyFingerprint: string,
    order: OrderIntent,
  ): Promise<{ order: PersistedOrder; created: boolean }> {
    if (!this.database.isReady()) throw new Error("PostgreSQL is required for sandbox order persistence.");

    return this.database.transaction(async (client) => {
      const account = await client.query<AccountConnectionRow>(
        [
          "SELECT id, provider, account_type, label, external_account_id, status, permissions,",
          "       last_synced_at, created_at, updated_at",
          "FROM account_connections WHERE id = $1 AND user_id = $2 FOR UPDATE",
        ].join("\n"),
        [accountId, userId],
      );
      if (!account.rows[0]) throw new Error("Connected provider account was not found.");
      if (account.rows[0].status !== "CONNECTED") throw new Error("Provider account is not connected.");
      if (account.rows[0].provider !== "BINANCE_SPOT_TESTNET") throw new Error("Unsupported execution provider.");
      if (!Array.isArray(account.rows[0].permissions) || !account.rows[0].permissions.includes("TRADE")) {
        throw new Error("Provider account does not have the Jarvis sandbox TRADE permission.");
      }

      const duplicate = await client.query<any>(
        [
          "SELECT client_order_id, account_id, instrument_id, external_order_id, side, order_type,",
          "       quantity::text, limit_price::text, stop_price::text, time_in_force, reduce_only,",
          "       strategy_id, strategy_version, reason, requested_at, status,",
          "       filled_quantity::text, average_fill_price::text, submitted_at, updated_at,",
          "       last_provider_event_at, idempotency_key, idempotency_fingerprint",
          "FROM orders WHERE account_id = $1 AND idempotency_key = $2 LIMIT 1",
        ].join("\n"),
        [accountId, idempotencyKey],
      );
      if (duplicate.rows[0]) {
        const existing = this.mapPersistedOrderRow(duplicate.rows[0]);
        if (
          existing.idempotencyFingerprint &&
          existing.idempotencyFingerprint !== idempotencyFingerprint
        ) {
          throw new Error("Idempotency-Key was already used for a different order intent.");
        }
        return { order: existing, created: false };
      }

      await client.query(
        [
          "INSERT INTO orders(",
          "  client_order_id, account_id, instrument_id, side, order_type, quantity, limit_price, stop_price,",
          "  time_in_force, reduce_only, strategy_id, strategy_version, reason, status, filled_quantity,",
          "  requested_at, updated_at, idempotency_key, idempotency_fingerprint",
          ") VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9,$10,$11,$12,$13,'PENDING_SUBMIT',0,to_timestamp($14 / 1000.0),now(),$15,$16)",
        ].join("\n"),
        [
          order.clientOrderId,
          accountId,
          order.instrumentId,
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
          idempotencyKey,
          idempotencyFingerprint,
        ],
      );

      const inserted = await client.query<any>(
        [
          "SELECT client_order_id, account_id, instrument_id, external_order_id, side, order_type,",
          "       quantity::text, limit_price::text, stop_price::text, time_in_force, reduce_only,",
          "       strategy_id, strategy_version, reason, requested_at, status,",
          "       filled_quantity::text, average_fill_price::text, submitted_at, updated_at,",
          "       last_provider_event_at, idempotency_key, idempotency_fingerprint",
          "FROM orders WHERE client_order_id = $1",
        ].join("\n"),
        [order.clientOrderId],
      );
      if (!inserted.rows[0]) throw new Error("Sandbox order reservation could not be persisted.");
      return { order: this.mapPersistedOrderRow(inserted.rows[0]), created: true };
    });
  }

  public async applyBinanceBalanceEvent(
    userId: string,
    externalAccountId: string,
    balances: Array<{ asset: string; free: string; locked: string; total: string; updatedAt: number }>,
  ): Promise<void> {
    if (!balances.length || !this.database.isReady()) return;

    await this.database.transaction(async (client) => {
      const account = await client.query<{ id: string }>(
        [
          "SELECT id FROM account_connections",
          "WHERE user_id = $1 AND provider = 'BINANCE_SPOT_TESTNET' AND external_account_id = $2",
          "LIMIT 1 FOR UPDATE",
        ].join("\n"),
        [userId, externalAccountId],
      );
      const accountId = account.rows[0]?.id;
      if (!accountId) return;

      for (const balance of balances) {
        await client.query(
          [
            "INSERT INTO balances(account_id, asset, free, locked, provider_updated_at, updated_at)",
            "VALUES ($1, $2, $3::numeric, $4::numeric, to_timestamp($5 / 1000.0), now())",
            "ON CONFLICT (account_id, asset)",
            "DO UPDATE SET",
            "  free = EXCLUDED.free, locked = EXCLUDED.locked,",
            "  provider_updated_at = EXCLUDED.provider_updated_at, updated_at = now()",
            "WHERE balances.provider_updated_at IS NULL",
            "   OR EXCLUDED.provider_updated_at >= balances.provider_updated_at",
          ].join("\n"),
          [accountId, balance.asset, balance.free, balance.locked, balance.updatedAt],
        );
      }
    });
  }

  public async updateOrderFromProvider(userId: string, clientOrderId: string, brokerOrder: BrokerOrder): Promise<PersistedOrder> {
    const current = await this.getUserOrder(userId, clientOrderId);
    if (!current) {
      throw new Error("Persisted sandbox order was not found for the authenticated user.");
    }

    const providerEventAt = brokerOrder.lastProviderEventAt ?? brokerOrder.updatedAt;
    const currentProviderEventAt = current.lastProviderEventAt ?? 0;
    const sameEvent = providerEventAt > 0 && currentProviderEventAt > 0 && providerEventAt === currentProviderEventAt;
    const newer = currentProviderEventAt === 0 || providerEventAt >= currentProviderEventAt;
    const transitionAllowed = canTransitionOrderStatus(
      current.status as import("./types").OrderStatus,
      brokerOrder.status,
    );

    if (!transitionAllowed || (!sameEvent && !newer)) {
      await this.persistFills(userId, brokerOrder.fills || []);
      return current;
    }

    const result = await this.database.query<any>(
      [
        "UPDATE orders o SET",
        "  external_order_id = COALESCE($2, o.external_order_id), status = $3, filled_quantity = $4::numeric,",
        "  average_fill_price = $5::numeric, submitted_at = CASE WHEN $6::bigint > 0 THEN to_timestamp($6 / 1000.0) ELSE o.submitted_at END,",
        "  updated_at = to_timestamp($7 / 1000.0), last_provider_event_at = to_timestamp($8 / 1000.0)",
        "FROM account_connections a",
        "WHERE o.client_order_id = $1 AND o.account_id = a.id AND a.user_id = $9",
        "  AND (o.last_provider_event_at IS NULL OR to_timestamp($8 / 1000.0) >= o.last_provider_event_at)",
        "RETURNING o.client_order_id, o.account_id, o.instrument_id, o.external_order_id, o.side, o.order_type,",
        "          o.quantity::text, o.limit_price::text, o.stop_price::text, o.time_in_force, o.reduce_only,",
        "          o.strategy_id, o.strategy_version, o.reason, o.requested_at, o.status,",
        "          o.filled_quantity::text, o.average_fill_price::text, o.submitted_at, o.updated_at,",
        "          o.last_provider_event_at, o.idempotency_key, o.idempotency_fingerprint",
      ].join("\n"),
      [
        clientOrderId,
        brokerOrder.externalOrderId ?? null,
        brokerOrder.status,
        brokerOrder.filledQuantity,
        brokerOrder.averageFillPrice ?? null,
        brokerOrder.submittedAt ?? 0,
        brokerOrder.updatedAt,
        providerEventAt,
        userId,
      ],
    );
    await this.persistFills(userId, brokerOrder.fills || []);
    if (!result.rows[0]) {
      return (await this.getUserOrder(userId, clientOrderId)) ?? current;
    }
    return this.mapPersistedOrderRow(result.rows[0]);
  }

  public async markOrderStatus(userId: string, clientOrderId: string, status: OrderStatus, message?: string): Promise<PersistedOrder> {
    const current = await this.getUserOrder(userId, clientOrderId);
    if (!current) throw new Error("Persisted sandbox order was not found.");

    if (!canTransitionOrderStatus(current.status as OrderStatus, status)) {
      throw new Error(
        `Invalid order state transition: ${current.status} -> ${status}.`,
      );
    }

    const result = await this.database.query<any>(
      [
        "UPDATE orders o SET status = $2, updated_at = now(), last_provider_event_at = now()",
        "FROM account_connections a",
        "WHERE o.client_order_id = $1 AND o.account_id = a.id AND a.user_id = $3",
        "RETURNING o.client_order_id, o.account_id, o.instrument_id, o.external_order_id, o.side, o.order_type,",
        "          o.quantity::text, o.limit_price::text, o.stop_price::text, o.time_in_force, o.reduce_only,",
        "          o.strategy_id, o.strategy_version, o.reason, o.requested_at, o.status,",
        "          o.filled_quantity::text, o.average_fill_price::text, o.submitted_at, o.updated_at,",
        "          o.last_provider_event_at, o.idempotency_key, o.idempotency_fingerprint",
      ].join("\n"),
      [clientOrderId, status, userId],
    );
    if (!result.rows[0]) throw new Error("Persisted sandbox order was not found.");
    if (message) {
      await this.recordAuditEvent({
        userId,
        accountId: result.rows[0].account_id,
        eventType: "ORDER_STATE_NOTE",
        idempotencyKey: result.rows[0].idempotency_key ?? undefined,
        payload: { clientOrderId, status, message },
      });
    }
    return this.mapPersistedOrderRow(result.rows[0]);
  }

  public async persistFills(userId: string, fills: Fill[]): Promise<void> {
    if (!fills.length || !this.database.isReady()) return;

    await this.database.transaction(async (client) => {
      for (const fill of fills) {
        const owner = await client.query<{ user_id: string }>(
          [
            "SELECT a.user_id FROM account_connections a",
            "JOIN orders o ON o.account_id = a.id",
            "WHERE o.client_order_id = $1 AND a.user_id = $2 LIMIT 1",
          ].join("\n"),
          [fill.orderClientId, userId],
        );
        if (!owner.rows[0]) throw new Error("Fill does not belong to the authenticated user.");

        const inserted = await client.query<{ id: string }>(
          [
            "INSERT INTO fills(",
            "  id, account_id, client_order_id, external_order_id, external_trade_id, instrument_id, side,",
            "  quantity, price, fee_amount, fee_asset, liquidity, executed_at",
            ") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9::numeric, $10, $11, to_timestamp($12 / 1000.0))",
            "ON CONFLICT (account_id, external_trade_id) WHERE external_trade_id IS NOT NULL DO NOTHING",
            "RETURNING id",
          ].join("\n"),
          [
            fill.accountId,
            fill.orderClientId,
            fill.externalOrderId ?? null,
            fill.externalTradeId ?? null,
            fill.instrumentId,
            fill.side,
            fill.quantity,
            fill.price,
            fill.feeAmount ?? null,
            fill.feeAsset ?? null,
            fill.liquidity ?? null,
            fill.executedAt,
          ],
        );

        if (!inserted.rows[0]) continue;

        const instrument = await client.query<{
          base_asset: string | null;
          quote_asset: string | null;
        }>(
          "SELECT base_asset, quote_asset FROM instruments WHERE instrument_id = $1 LIMIT 1",
          [fill.instrumentId],
        );
        const baseAsset = instrument.rows[0]?.base_asset;
        const quoteAsset = instrument.rows[0]?.quote_asset;
        if (!baseAsset || !quoteAsset) {
          throw new Error("Cannot post a fill to the ledger without canonical base/quote assets.");
        }

        const ledgerIdempotencyKey = "fill:" + fill.accountId + ":" + (fill.externalTradeId || fill.id);
        const transaction = await client.query<{ id: string }>(
          [
            "INSERT INTO ledger_transactions(",
            "  account_id, transaction_type, external_reference, idempotency_key, status, memo, posted_at",
            ") VALUES ($1, 'TRADE', $2, $3, 'POSTED', $4, to_timestamp($5 / 1000.0))",
            "ON CONFLICT (idempotency_key) DO NOTHING",
            "RETURNING id",
          ].join("\n"),
          [
            fill.accountId,
            fill.externalTradeId ?? fill.externalOrderId ?? fill.id,
            ledgerIdempotencyKey,
            "Spot fill " + fill.orderClientId,
            fill.executedAt,
          ],
        );

        if (!transaction.rows[0]) continue;

        if (fill.side === "BUY") {
          await client.query(
            [
              "INSERT INTO ledger_entries(transaction_id, account_id, asset, direction, amount, entry_type)",
              "VALUES ($1, $2, $3, 'DEBIT', $4::numeric * $5::numeric, 'CASH'),",
              "       ($1, $2, $6, 'CREDIT', $4::numeric, 'ASSET')",
            ].join("\n"),
            [
              transaction.rows[0].id,
              fill.accountId,
              quoteAsset,
              fill.quantity,
              fill.price,
              baseAsset,
            ],
          );
        } else {
          await client.query(
            [
              "INSERT INTO ledger_entries(transaction_id, account_id, asset, direction, amount, entry_type)",
              "VALUES ($1, $2, $3, 'DEBIT', $4::numeric, 'ASSET'),",
              "       ($1, $2, $6, 'CREDIT', $4::numeric * $5::numeric, 'CASH')",
            ].join("\n"),
            [
              transaction.rows[0].id,
              fill.accountId,
              baseAsset,
              fill.quantity,
              fill.price,
              quoteAsset,
            ],
          );
        }

        if (fill.feeAmount && fill.feeAsset) {
          await client.query(
            [
              "INSERT INTO ledger_entries(transaction_id, account_id, asset, direction, amount, entry_type)",
              "VALUES ($1, $2, $3, 'DEBIT', $4::numeric, 'FEE')",
            ].join("\n"),
            [transaction.rows[0].id, fill.accountId, fill.feeAsset.toUpperCase(), fill.feeAmount],
          );
        }
      }
    });
  }


  public async grantSandboxTradePermission(userId: string, accountId: string): Promise<AccountConnection> {
    const result = await this.database.query<AccountConnectionRow>(
      [
        "UPDATE account_connections",
        "SET permissions = '[\"READ\",\"TRADE\"]'::jsonb, updated_at = now()",
        "WHERE id = $1 AND user_id = $2 AND provider = 'BINANCE_SPOT_TESTNET'",
        "RETURNING id, provider, account_type, label, external_account_id, status, permissions, last_synced_at, created_at, updated_at",
      ].join("\n"),
      [accountId, userId],
    );
    if (!result.rows[0]) throw new Error("Connected Binance Spot Testnet account was not found.");
    return mapAccountConnectionRow(result.rows[0]);
  }

  private mapPersistedOrderRow(row: any): PersistedOrder {
    return {
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
      idempotencyKey: row.idempotency_key ?? undefined,
      idempotencyFingerprint: row.idempotency_fingerprint ?? undefined,
    };
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
