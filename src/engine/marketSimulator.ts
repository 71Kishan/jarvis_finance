import { Candle } from "../types/trading";
import { attachIndicators } from "./indicators";

export type AssetSymbol =
  | "BTC/USD"
  | "ETH/USD"
  | "SOL/USD"
  | "DOGE/USD"
  | "XRP/USD"
  | "NVDA"
  | "AAPL"
  | "TSLA"
  | "SPY"
  | "QQQ"
  | "EUR/USD"
  | "GBP/USD";

export interface AssetInfo {
  symbol: AssetSymbol;
  name: string;
  category: "CRYPTO" | "STOCK" | "INDEX" | "FOREX";
  basePrice: number;
  volatility: number;
  tickSize: number;
  decimals: number;
}

export const SUPPORTED_ASSETS: Record<AssetSymbol, AssetInfo> = {
  "BTC/USD": {
    symbol: "BTC/USD",
    name: "Bitcoin / US Dollar",
    category: "CRYPTO",
    basePrice: 80800,
    volatility: 0.0035,
    tickSize: 1.0,
    decimals: 2,
  },
  "ETH/USD": {
    symbol: "ETH/USD",
    name: "Ethereum / US Dollar",
    category: "CRYPTO",
    basePrice: 3480,
    volatility: 0.0042,
    tickSize: 0.1,
    decimals: 2,
  },
  "SOL/USD": {
    symbol: "SOL/USD",
    name: "Solana / US Dollar",
    category: "CRYPTO",
    basePrice: 154.5,
    volatility: 0.0055,
    tickSize: 0.05,
    decimals: 2,
  },
  "DOGE/USD": {
    symbol: "DOGE/USD",
    name: "Dogecoin / US Dollar",
    category: "CRYPTO",
    basePrice: 0.165,
    volatility: 0.0075,
    tickSize: 0.0001,
    decimals: 4,
  },
  "XRP/USD": {
    symbol: "XRP/USD",
    name: "Ripple / US Dollar",
    category: "CRYPTO",
    basePrice: 0.58,
    volatility: 0.006,
    tickSize: 0.001,
    decimals: 4,
  },
  NVDA: {
    symbol: "NVDA",
    name: "NVIDIA Corp",
    category: "STOCK",
    basePrice: 124.8,
    volatility: 0.0038,
    tickSize: 0.01,
    decimals: 2,
  },
  AAPL: {
    symbol: "AAPL",
    name: "Apple Inc",
    category: "STOCK",
    basePrice: 228.5,
    volatility: 0.0022,
    tickSize: 0.01,
    decimals: 2,
  },
  TSLA: {
    symbol: "TSLA",
    name: "Tesla Inc",
    category: "STOCK",
    basePrice: 242.6,
    volatility: 0.0058,
    tickSize: 0.01,
    decimals: 2,
  },
  SPY: {
    symbol: "SPY",
    name: "S&P 500 ETF Trust",
    category: "INDEX",
    basePrice: 562.4,
    volatility: 0.0018,
    tickSize: 0.01,
    decimals: 2,
  },
  QQQ: {
    symbol: "QQQ",
    name: "Invesco QQQ Trust",
    category: "INDEX",
    basePrice: 486.2,
    volatility: 0.0025,
    tickSize: 0.01,
    decimals: 2,
  },
  "EUR/USD": {
    symbol: "EUR/USD",
    name: "Euro / US Dollar",
    category: "FOREX",
    basePrice: 1.085,
    volatility: 0.0012,
    tickSize: 0.0001,
    decimals: 4,
  },
  "GBP/USD": {
    symbol: "GBP/USD",
    name: "British Pound / USD",
    category: "FOREX",
    basePrice: 1.305,
    volatility: 0.0015,
    tickSize: 0.0001,
    decimals: 4,
  },
};


export type MarketRegime = "BULL_EXPANSION" | "BEAR_TREND" | "CHOPPY_RANGE" | "VOLATILITY_SPIKE";

export class MarketSimulator {
  private candles: Candle[] = [];
  private currentRegime: MarketRegime = "BULL_EXPANSION";
  private regimeCountdown: number = 40;
  private assetInfo: AssetInfo;

  constructor(symbol: AssetSymbol = "BTC/USD", historyLength: number = 100) {
    this.assetInfo = SUPPORTED_ASSETS[symbol] || SUPPORTED_ASSETS["BTC/USD"];
    this.initHistory(historyLength);
  }

  public setAsset(symbol: AssetSymbol, historyLength: number = 100) {
    this.assetInfo = SUPPORTED_ASSETS[symbol] || SUPPORTED_ASSETS["BTC/USD"];
    this.initHistory(historyLength);
  }

  public getAssetInfo(): AssetInfo {
    return this.assetInfo;
  }

  public getRegime(): MarketRegime {
    return this.currentRegime;
  }

  private initHistory(count: number) {
    const candles: Candle[] = [];
    let price = this.assetInfo.basePrice;
    const now = Date.now();
    const intervalMs = 60 * 1000; // 1-minute simulated candles
    let startTime = now - count * intervalMs;

    for (let i = 0; i < count; i++) {
      this.regimeCountdown--;
      if (this.regimeCountdown <= 0) {
        this.shiftRegime();
      }

      const candle = this.generateCandle(price, startTime + i * intervalMs);
      candles.push(candle);
      price = candle.close;
    }

    this.candles = attachIndicators(candles);
  }

  private shiftRegime() {
    const regimes: MarketRegime[] = [
      "BULL_EXPANSION",
      "CHOPPY_RANGE",
      "VOLATILITY_SPIKE",
      "BEAR_TREND",
    ];
    const next = regimes[Math.floor(Math.random() * regimes.length)];
    this.currentRegime = next;
    this.regimeCountdown = Math.floor(30 + Math.random() * 40);
  }

  private generateCandle(startPrice: number, timestamp: number): Candle {
    let drift = 0;
    let volFactor = 1;

    switch (this.currentRegime) {
      case "BULL_EXPANSION":
        drift = 0.0008; // upward bias
        volFactor = 0.9;
        break;
      case "BEAR_TREND":
        drift = -0.0007; // downward bias
        volFactor = 1.1;
        break;
      case "CHOPPY_RANGE":
        drift = (Math.random() - 0.5) * 0.0003; // oscilates near zero
        volFactor = 0.7;
        break;
      case "VOLATILITY_SPIKE":
        drift = (Math.random() - 0.48) * 0.0012;
        volFactor = 2.4;
        break;
    }

    const open = startPrice;
    const vol = this.assetInfo.volatility * volFactor;
    // Gaussian-like random step
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1 || 0.001)) * Math.cos(2.0 * Math.PI * u2);

    const changePercent = drift + z0 * vol;
    const close = Math.max(open * 0.5, open * (1 + changePercent));

    const high = Math.max(open, close) + Math.random() * vol * open * 0.8;
    const low = Math.min(open, close) - Math.random() * vol * open * 0.8;

    const baseVol = 150 * (open / 1000);
    const volume = Math.round(baseVol * (0.6 + Math.random() * 1.5 + (volFactor > 1.5 ? 2.5 : 0)));

    return {
      timestamp,
      open: Number(open.toFixed(this.assetInfo.decimals)),
      high: Number(high.toFixed(this.assetInfo.decimals)),
      low: Number(low.toFixed(this.assetInfo.decimals)),
      close: Number(close.toFixed(this.assetInfo.decimals)),
      volume,
    };
  }

  public nextTick(): Candle {
    this.regimeCountdown--;
    if (this.regimeCountdown <= 0) {
      this.shiftRegime();
    }

    const lastCandle = this.candles[this.candles.length - 1];
    const nextTime = lastCandle ? lastCandle.timestamp + 60000 : Date.now();
    const lastClose = lastCandle ? lastCandle.close : this.assetInfo.basePrice;

    const newCandle = this.generateCandle(lastClose, nextTime);
    this.candles.push(newCandle);

    // Keep memory bounded to last 250 candles for performance
    if (this.candles.length > 250) {
      this.candles.shift();
    }

    this.candles = attachIndicators(this.candles);
    return this.candles[this.candles.length - 1];
  }

  public getCandles(): Candle[] {
    return this.candles;
  }

  public setExternalCandles(candles: Candle[]) {
    this.candles = attachIndicators(candles);
  }

  public getLastCandle(): Candle | undefined {
    return this.candles[this.candles.length - 1];
  }
}
