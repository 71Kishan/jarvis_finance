import { paperExecutionAdapter } from "./paperExecutionAdapter";
import type {
  AccountConnection,
  AdapterHealth,
  BrokerOrder,
  ExecutionAdapter,
  Fill,
  OrderIntent,
  PortfolioPosition,
  WalletBalance,
} from "../platform/types";

export interface PaperBrokerInstrument {
  baseAsset: string;
  quoteAsset: string;
}

export interface PaperBrokerAdapterOptions {
  accountId?: string;
  initialBalances?: Record<string, string | number>;
  feeTierPercent?: number;
  slippageBps?: number;
  resolveInstrument?: (instrumentId: string) => PaperBrokerInstrument | null;
  getMarketPrice?: (instrumentId: string) => number | null;
}

function cloneOrder(order: BrokerOrder): BrokerOrder {
  return { ...order };
}

function now(): number {
  return Date.now();
}

function parsePositive(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Paper execution requires a positive " + field + ".");
  }
  return parsed;
}

/**
 * Provider-neutral paper broker implementation.
 *
 * This adapter is intentionally separate from the existing TradingEngine state.
 * It proves the same OrderIntent/ExecutionAdapter contract that future broker
 * adapters will use, while remaining entirely local and non-custodial.
 */
export class PaperBrokerAdapter implements ExecutionAdapter {
  public readonly provider = "JARVIS_PAPER";

  private readonly accountId: string;
  private readonly feeTierPercent: number;
  private readonly slippageBps: number;
  private readonly resolveInstrument: (instrumentId: string) => PaperBrokerInstrument | null;
  private readonly getMarketPrice: (instrumentId: string) => number | null;
  private readonly balances = new Map<string, { free: number; locked: number }>();
  private readonly orders = new Map<string, BrokerOrder>();
  private readonly fills: Fill[] = [];

  public constructor(options: PaperBrokerAdapterOptions = {}) {
    this.accountId = options.accountId || "jarvis-paper-local";
    this.feeTierPercent = Math.max(0, Number(options.feeTierPercent) || 0.04);
    this.slippageBps = Math.max(0, Number(options.slippageBps) || 2);
    this.resolveInstrument = options.resolveInstrument || (() => null);
    this.getMarketPrice = options.getMarketPrice || (() => null);

    const initialBalances = options.initialBalances || { USD: 10_000 };
    for (const [asset, value] of Object.entries(initialBalances)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 0) {
        this.balances.set(asset.toUpperCase(), { free: numeric, locked: 0 });
      }
    }
  }

  public getHealth(): Promise<AdapterHealth> {
    return Promise.resolve({
      provider: this.provider,
      connected: true,
      authenticated: true,
    });
  }

  public async getBalances(accountId: string): Promise<WalletBalance[]> {
    this.assertAccount(accountId);
    return Array.from(this.balances.entries())
      .filter(([, balance]) => balance.free !== 0 || balance.locked !== 0)
      .map(([asset, balance]) => ({
        accountId: this.accountId,
        asset,
        free: balance.free.toFixed(8),
        locked: balance.locked.toFixed(8),
        total: (balance.free + balance.locked).toFixed(8),
        updatedAt: now(),
      }));
  }

  public async getPositions(accountId: string): Promise<PortfolioPosition[]> {
    this.assertAccount(accountId);
    // Spot positions are represented by WalletBalance. Position reconstruction
    // belongs to the account/portfolio layer once canonical instruments are attached.
    return [];
  }

  public async getOpenOrders(accountId: string): Promise<BrokerOrder[]> {
    this.assertAccount(accountId);
    return Array.from(this.orders.values())
      .filter((order) => order.status === "SUBMITTED" || order.status === "PARTIALLY_FILLED")
      .map(cloneOrder);
  }

  public async submitOrder(order: OrderIntent): Promise<BrokerOrder> {
    this.assertAccount(order.accountId);
    this.validateIntent(order);

    const existing = this.orders.get(order.clientOrderId);
    if (existing) {
      if (!this.sameIntent(existing, order)) {
        throw new Error("Idempotency conflict: clientOrderId is already bound to a different paper order.");
      }
      return cloneOrder(existing);
    }

    const instrument = this.resolveInstrument(order.instrumentId);
    if (!instrument) {
      throw new Error("Paper execution cannot resolve instrument metadata for " + order.instrumentId + ".");
    }

    const createdAt = now();
    const orderRecord: BrokerOrder = {
      ...order,
      status: "SUBMITTED",
      filledQuantity: "0",
      requestedAt: order.requestedAt || createdAt,
      updatedAt: createdAt,
    };

    if (order.type === "MARKET") {
      const marketPrice = this.getMarketPrice(order.instrumentId);
      if (!(marketPrice !== null && Number.isFinite(marketPrice) && marketPrice > 0)) {
        orderRecord.status = "REJECTED";
        orderRecord.updatedAt = now();
        this.orders.set(order.clientOrderId, orderRecord);
        return cloneOrder(orderRecord);
      }

      const quantity = parsePositive(order.quantity, "quantity");
      const side = order.side === "BUY" ? "LONG" : "SHORT";
      const notional = quantity * marketPrice;
      const fill = paperExecutionAdapter.entryFill({
        expectedPrice: marketPrice,
        side,
        notionalUsd: notional,
        settings: {
          slippageBps: this.slippageBps,
          feeTierPercent: this.feeTierPercent,
          leverage: 1,
          soundAlerts: false,
        },
      });

      const requiredQuote = order.side === "BUY"
        ? quantity * fill.fillPrice + fill.feeUsd
        : 0;

      const quote = this.getBalance(instrument.quoteAsset);
      const base = this.getBalance(instrument.baseAsset);

      if (order.side === "BUY") {
        if (quote.free + 1e-10 < requiredQuote) {
          orderRecord.status = "REJECTED";
          orderRecord.updatedAt = now();
          this.orders.set(order.clientOrderId, orderRecord);
          return cloneOrder(orderRecord);
        }
        quote.free -= requiredQuote;
        base.free += quantity;
      } else {
        if (base.free + 1e-10 < quantity) {
          orderRecord.status = "REJECTED";
          orderRecord.updatedAt = now();
          this.orders.set(order.clientOrderId, orderRecord);
          return cloneOrder(orderRecord);
        }
        base.free -= quantity;
        quote.free += quantity * fill.fillPrice - fill.feeUsd;
      }

      const executedAt = now();
      orderRecord.externalOrderId = "PAPER-" + createdAt.toString(36).toUpperCase();
      orderRecord.status = "FILLED";
      orderRecord.filledQuantity = quantity.toString();
      orderRecord.averageFillPrice = fill.fillPrice.toFixed(8);
      orderRecord.submittedAt = createdAt;
      orderRecord.updatedAt = executedAt;

      this.fills.push({
        id: "PFILL-" + executedAt.toString(36).toUpperCase() + "-" + this.fills.length,
        accountId: this.accountId,
        orderClientId: order.clientOrderId,
        externalOrderId: orderRecord.externalOrderId,
        instrumentId: order.instrumentId,
        side: order.side,
        quantity: quantity.toString(),
        price: fill.fillPrice.toFixed(8),
        feeAmount: fill.feeUsd.toFixed(8),
        feeAsset: instrument.quoteAsset,
        liquidity: "TAKER",
        executedAt,
      });
    } else {
      const limitPrice = parsePositive(order.limitPrice || "0", "limit price");
      const quantity = parsePositive(order.quantity, "quantity");
      const quote = this.getBalance(instrument.quoteAsset);
      const base = this.getBalance(instrument.baseAsset);

      if (order.side === "BUY") {
        const reserve = quantity * limitPrice;
        if (quote.free + 1e-10 < reserve) {
          orderRecord.status = "REJECTED";
        } else {
          quote.free -= reserve;
          quote.locked += reserve;
        }
      } else if (base.free + 1e-10 < quantity) {
        orderRecord.status = "REJECTED";
      } else {
        base.free -= quantity;
        base.locked += quantity;
      }

      orderRecord.externalOrderId = "PAPER-" + createdAt.toString(36).toUpperCase();
      orderRecord.submittedAt = createdAt;
      orderRecord.updatedAt = now();
    }

    this.orders.set(order.clientOrderId, orderRecord);
    return cloneOrder(orderRecord);
  }

  public async cancelOrder(accountId: string, clientOrderId: string): Promise<BrokerOrder> {
    this.assertAccount(accountId);
    const order = this.orders.get(clientOrderId);
    if (!order) throw new Error("Unknown paper clientOrderId: " + clientOrderId);

    if (order.status === "SUBMITTED" || order.status === "PARTIALLY_FILLED") {
      const instrument = this.resolveInstrument(order.instrumentId);
      if (!instrument) throw new Error("Paper execution cannot resolve instrument metadata for cancellation.");

      const quantity = Number(order.quantity);
      if (order.side === "BUY" && order.limitPrice) {
        const reserved = quantity * Number(order.limitPrice);
        const quote = this.getBalance(instrument.quoteAsset);
        quote.locked = Math.max(0, quote.locked - reserved);
        quote.free += reserved;
      } else if (order.side === "SELL") {
        const base = this.getBalance(instrument.baseAsset);
        base.locked = Math.max(0, base.locked - quantity);
        base.free += quantity;
      }

      order.status = "CANCELLED";
      order.updatedAt = now();
      this.orders.set(clientOrderId, order);
    }

    return cloneOrder(order);
  }

  public getRecordedFills(): Fill[] {
    return this.fills.map((fill) => ({ ...fill }));
  }

  public getAccountConnection(): AccountConnection {
    const timestamp = now();
    return {
      id: this.accountId,
      provider: this.provider,
      accountType: "EXCHANGE",
      label: "Jarvis Paper Account",
      status: "CONNECTED",
      permissions: ["READ", "TRADE"],
      lastSyncedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  public getAccountId(): string {
    return this.accountId;
  }

  private getBalance(asset: string) {
    const normalized = asset.trim().toUpperCase();
    const existing = this.balances.get(normalized);
    if (existing) return existing;
    const created = { free: 0, locked: 0 };
    this.balances.set(normalized, created);
    return created;
  }

  private assertAccount(accountId: string): void {
    if (accountId !== this.accountId) {
      throw new Error("Unknown Jarvis paper account id.");
    }
  }

  private validateIntent(order: OrderIntent): void {
    if (!order.clientOrderId.trim()) throw new Error("Paper orders require a clientOrderId.");
    if (!order.instrumentId.trim()) throw new Error("Paper orders require an instrumentId.");
    if (order.accountId !== this.accountId) throw new Error("Paper order account does not match the adapter account.");
    if (!order.quantity || Number(order.quantity) <= 0) throw new Error("Paper orders require positive quantity.");
    if (!["MARKET", "LIMIT", "LIMIT_MAKER"].includes(order.type)) {
      throw new Error("Paper adapter currently supports MARKET, LIMIT and LIMIT_MAKER orders only.");
    }
  }

  private sameIntent(existing: BrokerOrder, requested: OrderIntent): boolean {
    return existing.accountId === requested.accountId &&
      existing.instrumentId === requested.instrumentId &&
      existing.side === requested.side &&
      existing.type === requested.type &&
      existing.quantity === requested.quantity &&
      existing.limitPrice === requested.limitPrice &&
      existing.stopPrice === requested.stopPrice &&
      existing.timeInForce === requested.timeInForce &&
      existing.reduceOnly === requested.reduceOnly &&
      existing.strategyId === requested.strategyId &&
      existing.strategyVersion === requested.strategyVersion;
  }
}
