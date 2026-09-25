export type AssetClass =
  | "CRYPTO"
  | "STOCK"
  | "ETF"
  | "INDEX"
  | "FOREX"
  | "COMMODITY"
  | "FUTURE"
  | "OPTION"
  | "BOND"
  | "FUND"
  | "CASH";

export type VenueKind = "EXCHANGE" | "BROKER" | "OTC" | "INTERNAL";
export type InstrumentStatus = "ACTIVE" | "SUSPENDED" | "DELISTED";

export type TradingPermission = "READ" | "TRADE" | "WITHDRAW";

export interface TradingSession {
  timezone: string;
  regularOpen: string;
  regularClose: string;
  days: number[];
  supportsExtendedHours?: boolean;
  supports24x7?: boolean;
}

export interface Instrument {
  instrumentId: string;
  symbol: string;
  displaySymbol: string;
  name: string;
  assetClass: AssetClass;
  venue: string;
  venueKind: VenueKind;
  market: string;
  baseAsset?: string;
  quoteAsset?: string;
  currency?: string;
  provider: string;
  providerSymbol: string;
  status: InstrumentStatus;
  tradable: boolean;
  shortable?: boolean;
  fractionable?: boolean;
  tickSize?: string;
  lotSize?: string;
  minQuantity?: string;
  maxQuantity?: string;
  minNotional?: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  contractMultiplier?: string;
  listingTime?: number;
  delistingTime?: number;
  session?: TradingSession;
  updatedAt: number;
}

export interface AccountConnection {
  id: string;
  provider: string;
  accountType: "BROKER" | "EXCHANGE" | "BANK" | "WALLET";
  label: string;
  externalAccountId?: string;
  status: "DISCONNECTED" | "CONNECTED" | "DEGRADED" | "REQUIRES_REAUTH";
  permissions: TradingPermission[];
  lastSyncedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WalletBalance {
  accountId: string;
  asset: string;
  free: string;
  locked: string;
  total: string;
  valuationCurrency?: string;
  valuationAmount?: string;
  updatedAt: number;
}

export type PositionSide = "LONG" | "SHORT";

export interface PortfolioPosition {
  accountId: string;
  instrumentId: string;
  side: PositionSide;
  quantity: string;
  averageEntryPrice: string;
  markPrice?: string;
  marketValue?: string;
  unrealizedPnl?: string;
  realizedPnl?: string;
  updatedAt: number;
}

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "LIMIT_MAKER" | "STOP" | "STOP_LIMIT" | "TAKE_PROFIT" | "TAKE_PROFIT_LIMIT";
export type TimeInForce = "DAY" | "GTC" | "IOC" | "FOK" | "GTX";

export type OrderStatus =
  | "PENDING_SUBMIT"
  | "SUBMITTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCEL_PENDING"
  | "CANCELLED"
  | "REJECTED"
  | "SUBMISSION_FAILED"
  | "EXPIRED"
  | "UNKNOWN_RECONCILIATION";

export interface OrderIntent {
  clientOrderId: string;
  accountId: string;
  instrumentId: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  limitPrice?: string;
  stopPrice?: string;
  timeInForce?: TimeInForce;
  reduceOnly?: boolean;
  strategyId?: string;
  strategyVersion?: number;
  reason?: string;
  requestedAt: number;
}

export interface BrokerOrder extends OrderIntent {
  externalOrderId?: string;
  status: OrderStatus;
  filledQuantity: string;
  averageFillPrice?: string;
  submittedAt?: number;
  updatedAt: number;
  lastProviderEventAt?: number;
}

export interface Fill {
  id: string;
  accountId: string;
  orderClientId: string;
  externalOrderId?: string;
  externalTradeId?: string;
  instrumentId: string;
  side: OrderSide;
  quantity: string;
  price: string;
  feeAmount?: string;
  feeAsset?: string;
  liquidity?: "MAKER" | "TAKER" | "UNKNOWN";
  executedAt: number;
}

export interface LedgerTransaction {
  id: string;
  accountId: string;
  type:
    | "DEPOSIT"
    | "WITHDRAWAL"
    | "TRADE"
    | "FEE"
    | "TRANSFER"
    | "ADJUSTMENT"
    | "DIVIDEND"
    | "INTEREST";
  externalReference?: string;
  idempotencyKey: string;
  status: "PENDING" | "POSTED" | "REVERSED" | "FAILED";
  createdAt: number;
  postedAt?: number;
  memo?: string;
}

export interface LedgerEntry {
  transactionId: string;
  accountId: string;
  asset: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  entryType: "CASH" | "ASSET" | "FEE" | "RESERVE";
}

export interface PortfolioSnapshot {
  accountId: string;
  timestamp: number;
  baseCurrency: string;
  cashValue: string;
  holdingsValue: string;
  totalEquity: string;
  realizedPnl: string;
  unrealizedPnl: string;
  dayPnl?: string;
  source: "PROVIDER" | "LEDGER" | "COMPOSITE";
}

export interface AdapterHealth {
  provider: string;
  connected: boolean;
  authenticated: boolean;
  lastSuccessfulSyncAt?: number;
  lastErrorAt?: number;
  lastError?: string;
}

export interface ExecutionAdapter {
  readonly provider: string;
  getHealth(): Promise<AdapterHealth>;
  getBalances(accountId: string): Promise<WalletBalance[]>;
  getPositions(accountId: string): Promise<PortfolioPosition[]>;
  getOpenOrders(accountId: string): Promise<BrokerOrder[]>;
  submitOrder(order: OrderIntent): Promise<BrokerOrder>;
  cancelOrder(accountId: string, clientOrderId: string): Promise<BrokerOrder>;
}
