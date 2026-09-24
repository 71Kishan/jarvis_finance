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
    if (!this.database.isReady() || !instruments.length) return;

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
