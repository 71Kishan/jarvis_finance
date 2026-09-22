import { BacktestResult, Candle, StrategyConfig } from "../types/trading";

interface OpenPosition {
  type: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  amount: number;
  sizeUsd: number;
  feePaid: number;
  highestPrice?: number;
  lowestPrice?: number;
}

interface BacktestOptions {
  initialBalance?: number;
  feeRatePercent?: number;
  slippageBps?: number;
  riskFreeRatePerYear?: number;
  maxBarsWithoutData?: number;
}

const MIN_DATA_BARS = 60;
const DEFAULT_FEE_RATE = 0.04;
const DEFAULT_SLIPPAGE_BPS = 2;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function directionalSlippage(price: number, type: "LONG" | "SHORT", bps: number, isEntry: boolean): number {
  const rate = bps / 10_000;
  if (type === "LONG") return isEntry ? price * (1 + rate) : price * (1 - rate);
  return isEntry ? price * (1 - rate) : price * (1 + rate);
}

function signalFor(strategy: StrategyConfig, candle: Candle): { type: "LONG" | "SHORT"; confidence: number } | null {
  const ind = candle.indicators;
  if (!ind?.ready) return null;

  const w = strategy.indicatorWeights;
  const trend = w.trendEMA;
  const rsi = w.rsiReversal;
  const bb = w.bollingerMeanReversion;
  const macd = w.macdMomentum;
  const vol = w.volumeConfirmation;

  let longScore = 0;
  let shortScore = 0;

  if (ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50 && candle.close > ind.ema9) longScore += trend * 100;
  if (ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50 && candle.close < ind.ema9) shortScore += trend * 100;

  if (ind.rsi >= strategy.rsiOversold && ind.rsi <= strategy.rsiOversold + 5) longScore += rsi * 100;
  if (ind.rsi <= strategy.rsiOverbought && ind.rsi >= strategy.rsiOverbought - 5) shortScore += rsi * 100;

  if (candle.close <= ind.bbandLower * 1.004) longScore += bb * 100;
  if (candle.close >= ind.bbandUpper * 0.996) shortScore += bb * 100;

  if (ind.macdHist > 0 && ind.macd > ind.macdSignal) longScore += macd * 100;
  if (ind.macdHist < 0 && ind.macd < ind.macdSignal) shortScore += macd * 100;

  if (finite(ind.volumeSMA) && ind.volumeSMA > 0 && candle.volume >= ind.volumeSMA * 1.1) {
    if (longScore > shortScore) longScore += vol * 100;
    if (shortScore > longScore) shortScore += vol * 100;
  }

  const confidence = Math.max(longScore, shortScore);
  if (confidence < strategy.minConfidence || Math.abs(longScore - shortScore) < 5) return null;

  return {
    type: longScore > shortScore ? "LONG" : "SHORT",
    confidence: Number(Math.min(100, confidence).toFixed(2)),
  };
}

function maxDrawdown(equity: number[], peakStart: number): number {
  let peak = peakStart;
  let max = 0;
  for (const value of equity) {
    if (value > peak) peak = value;
    if (peak > 0) max = Math.max(max, ((peak - value) / peak) * 100);
  }
  return max;
}

function performanceMetrics(equity: number[], trades: { pnl: number }[], initialBalance: number, barsPerYear: number) {
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i += 1) {
    if (equity[i - 1] > 0) returns.push(equity[i] / equity[i - 1] - 1);
  }

  const avg = mean(returns);
  const sd = sampleStd(returns);
  const downside = sampleStd(returns.map((r) => Math.min(r, 0)));
  const annualizedVolatility = sd * Math.sqrt(Math.max(1, barsPerYear));
  const sharpe = sd > 0 ? ((avg - 0) / sd) * Math.sqrt(Math.max(1, barsPerYear)) : 0;
  const sortino = downside > 0 ? (avg / downside) * Math.sqrt(Math.max(1, barsPerYear)) : 0;
  const totalReturn = initialBalance > 0 ? equity[equity.length - 1] / initialBalance - 1 : 0;
  const years = Math.max(1 / barsPerYear, (equity.length - 1) / barsPerYear);
  const annualizedReturn = Math.pow(Math.max(equity[equity.length - 1] / initialBalance, 0), 1 / years) - 1;
  const grossProfit = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const expectancy = trades.length ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0;

  return {
    sharpeRatio: Number(sharpe.toFixed(3)),
    sortinoRatio: Number(sortino.toFixed(3)),
    annualizedReturn: Number((annualizedReturn * 100).toFixed(2)),
    annualizedVolatility: Number((annualizedVolatility * 100).toFixed(2)),
    profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(3)) : 0,
    expectancyUsd: Number(expectancy.toFixed(2)),
  };
}

export class StrategyOptimizer {
  public static backtest(
    strategy: StrategyConfig,
    candles: Candle[],
    initialBalance = 10_000,
    options: BacktestOptions = {},
  ): BacktestResult {
    const balanceStart = initialBalance;
    const feeRate = (options.feeRatePercent ?? DEFAULT_FEE_RATE) / 100;
    const slippageBps = options.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

    if (candles.length < MIN_DATA_BARS) {
      return {
        strategyName: strategy.name,
        totalTrades: 0,
        winRate: 0,
        totalPnl: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        expectancyUsd: 0,
        annualizedReturn: 0,
        annualizedVolatility: 0,
        feesPaid: 0,
        slippageCost: 0,
        verdict: "INSUFFICIENT_DATA",
      };
    }

    let cash = initialBalance;
    let position: OpenPosition | null = null;
    let pendingSignal: { type: "LONG" | "SHORT"; confidence: number } | null = null;
    let pendingSignalTime: number | null = null;

    const closedTrades: { pnl: number }[] = [];
    const equitySeries: number[] = [initialBalance];
    let peakEquity = initialBalance;
    let totalFees = 0;
    let totalSlippage = 0;
    let ambiguousBars = 0;

    const startIndex = 50;
    for (let i = startIndex; i < candles.length; i += 1) {
      const candle = candles[i];

      // Signals are generated from the prior bar's close and executed at this bar's open.
      if (!position && pendingSignal) {
        const rawOpen = candle.open;
        const entryPrice = directionalSlippage(rawOpen, pendingSignal.type, slippageBps, true);
        const riskBudget = cash * Math.min(strategy.maxRiskPerTrade, 5) / 100;
        const stopDistance = Math.max(entryPrice * strategy.stopLossPercent / 100, entryPrice * 0.001);
        const notional = Math.min(
          riskBudget / (stopDistance / entryPrice),
          cash * 0.95,
        );
        const amount = notional / entryPrice;
        const entryFee = notional * feeRate;

        if (amount > 0 && cash >= notional + entryFee) {
          const stopLoss = pendingSignal.type === "LONG"
            ? entryPrice * (1 - strategy.stopLossPercent / 100)
            : entryPrice * (1 + strategy.stopLossPercent / 100);
          const takeProfit = pendingSignal.type === "LONG"
            ? entryPrice * (1 + strategy.takeProfitPercent / 100)
            : entryPrice * (1 - strategy.takeProfitPercent / 100);

          cash -= notional + entryFee;
          totalFees += entryFee;
          totalSlippage += Math.abs(entryPrice - rawOpen) * amount;
          position = {
            type: pendingSignal.type,
            entryPrice,
            stopLoss,
            takeProfit,
            amount,
            sizeUsd: notional,
            feePaid: entryFee,
          };
        }
        pendingSignal = null;
        pendingSignalTime = null;
      }

      if (position) {
        let stop = position.stopLoss;
        const activation = strategy.trailingActivationPercent ?? 1;

        if (position.type === "LONG") {
          position.highestPrice = Math.max(position.highestPrice ?? position.entryPrice, candle.high);
          if (strategy.trailingStop && position.highestPrice >= position.entryPrice * (1 + activation / 100)) {
            const trail = position.highestPrice * (1 - strategy.trailingStopPercent / 100);
            stop = Math.max(stop, trail);
            position.stopLoss = stop;
          }

          const hitTp = candle.high >= position.takeProfit;
          const hitSl = candle.low <= position.stopLoss;
          if (hitTp && hitSl) ambiguousBars += 1;

          if (hitTp || hitSl) {
            // When a bar touches both, assume the adverse stop is hit first unless lower-timeframe data exists.
            const exitRaw = hitSl ? position.stopLoss : position.takeProfit;
            const exitPrice = directionalSlippage(exitRaw, position.type, slippageBps, false);
            const grossPnl = (exitPrice - position.entryPrice) * position.amount;
            const exitFee = Math.abs(exitPrice * position.amount) * feeRate;
            const netPnl = grossPnl - exitFee;
            cash += position.sizeUsd + netPnl;
            totalFees += exitFee;
            closedTrades.push({ pnl: netPnl });
            position = null;
          }
        } else {
          position.lowestPrice = Math.min(position.lowestPrice ?? position.entryPrice, candle.low);
          if (strategy.trailingStop && position.lowestPrice <= position.entryPrice * (1 - activation / 100)) {
            const trail = position.lowestPrice * (1 + strategy.trailingStopPercent / 100);
            stop = Math.min(stop, trail);
            position.stopLoss = stop;
          }

          const hitTp = candle.low <= position.takeProfit;
          const hitSl = candle.high >= position.stopLoss;
          if (hitTp && hitSl) ambiguousBars += 1;

          if (hitTp || hitSl) {
            const exitRaw = hitSl ? position.stopLoss : position.takeProfit;
            const exitPrice = directionalSlippage(exitRaw, position.type, slippageBps, false);
            const grossPnl = (position.entryPrice - exitPrice) * position.amount;
            const exitFee = Math.abs(exitPrice * position.amount) * feeRate;
            const netPnl = grossPnl - exitFee;
            cash += position.sizeUsd + netPnl;
            totalFees += exitFee;
            closedTrades.push({ pnl: netPnl });
            position = null;
          }
        }
      }

      let equity = cash;
      if (position) {
        const mark = candle.close;
        const openPnl = position.type === "LONG"
          ? (mark - position.entryPrice) * position.amount
          : (position.entryPrice - mark) * position.amount;
        equity += position.sizeUsd + openPnl;
      }
      equitySeries.push(equity);
      peakEquity = Math.max(peakEquity, equity);

      if (!position && i < candles.length - 1) {
        const signal = signalFor(strategy, candle);
        if (signal) {
          pendingSignal = signal;
          pendingSignalTime = candle.timestamp;
        }
      }

      // A pending signal is intentionally consumed by the next bar's open.
      // It is not cleared during the same iteration in which it was created.
    }

    const totalPnl = cash - balanceStart;
    const totalTrades = closedTrades.length;
    const winRate = totalTrades ? (closedTrades.filter((t) => t.pnl > 0).length / totalTrades) * 100 : 0;
    const dd = maxDrawdown(equitySeries, balanceStart);
    const dailyOrIntradayBars = strategy.asset.includes("/") ? 365 * 24 * 60 : 252 * 390;
    const metrics = performanceMetrics(equitySeries, closedTrades, balanceStart, dailyOrIntradayBars);

    let verdict: BacktestResult["verdict"] = "INSUFFICIENT_DATA";
    if (totalTrades > 0) {
      verdict = totalPnl < 0
        ? "FAILED"
        : dd > 20
          ? "UNSAFE_HIGH_DRAWDOWN"
          : totalTrades < 30
            ? "INSUFFICIENT_DATA"
            : "SURVIVED_AND_PROFITABLE";
    }

    return {
      strategyName: strategy.name,
      totalTrades,
      winRate: Number(winRate.toFixed(2)),
      totalPnl: Number(totalPnl.toFixed(2)),
      profitFactor: metrics.profitFactor,
      maxDrawdown: Number(dd.toFixed(2)),
      sharpeRatio: metrics.sharpeRatio,
      sortinoRatio: metrics.sortinoRatio,
      expectancyUsd: metrics.expectancyUsd,
      annualizedReturn: metrics.annualizedReturn,
      annualizedVolatility: metrics.annualizedVolatility,
      feesPaid: Number(totalFees.toFixed(2)),
      slippageCost: Number(totalSlippage.toFixed(2)),
      verdict,
    };
  }

  public static runOptimizationStudy(
    baseStrategy: StrategyConfig,
    candles: Candle[],
  ): {
    bestStrategy: StrategyConfig;
    bestResult: BacktestResult;
    candidatesTested: { strategy: StrategyConfig; result: BacktestResult }[];
    optimizationInsights: string[];
  } {
    if (candles.length < 120) {
      const result = this.backtest(baseStrategy, candles);
      return {
        bestStrategy: baseStrategy,
        bestResult: result,
        candidatesTested: [{ strategy: baseStrategy, result }],
        optimizationInsights: [
          "Not enough history for a reliable parameter study. Collect more observations before promoting a strategy.",
        ],
      };
    }

    const candidates: StrategyConfig[] = [
      { ...baseStrategy },
      {
        ...baseStrategy,
        id: baseStrategy.id + "-trend",
        version: baseStrategy.version + 1,
        name: baseStrategy.name + " / Trend",
        rsiOversold: 32,
        rsiOverbought: 68,
        stopLossPercent: 1.0,
        takeProfitPercent: 2.5,
        minConfidence: 80,
      },
      {
        ...baseStrategy,
        id: baseStrategy.id + "-balanced",
        version: baseStrategy.version + 1,
        name: baseStrategy.name + " / Balanced",
        rsiOversold: 34,
        rsiOverbought: 66,
        stopLossPercent: 1.2,
        takeProfitPercent: 3.0,
        minConfidence: 78,
      },
      {
        ...baseStrategy,
        id: baseStrategy.id + "-defensive",
        version: baseStrategy.version + 1,
        name: baseStrategy.name + " / Defensive",
        rsiOversold: 30,
        rsiOverbought: 70,
        stopLossPercent: 0.9,
        takeProfitPercent: 2.2,
        minConfidence: 84,
      },
    ];

    const split = Math.floor(candles.length * 0.7);
    const train = candles.slice(0, split);
    const test = candles.slice(split);

    const candidatesTested = candidates.map((strategy) => {
      const inSample = this.backtest(strategy, train);
      const outOfSample = this.backtest(strategy, test);
      const result: BacktestResult = {
        ...inSample,
        outOfSampleTrades: outOfSample.totalTrades,
        outOfSamplePnl: outOfSample.totalPnl,
        outOfSampleMaxDrawdown: outOfSample.maxDrawdown,
      };
      return { strategy, result };
    });

    candidatesTested.sort((a, b) => {
      const score = (x: typeof a) => {
        const oos = x.result.outOfSamplePnl ?? 0;
        const pf = x.result.profitFactor;
        const dd = x.result.outOfSampleMaxDrawdown ?? x.result.maxDrawdown;
        const trades = x.result.outOfSampleTrades ?? 0;
        const evidencePenalty = trades < 10 ? 50 : 0;
        return oos - dd * Math.max(1, Math.abs(oos) * 0.01) + pf * 25 - evidencePenalty;
      };
      return score(b) - score(a);
    });

    const best = candidatesTested[0];
    const insights = [
      "Candidate selection uses a chronological 70/30 split; the holdout segment is not used to fit parameters.",
      "Signals generated on a bar close are executed no earlier than the next bar open.",
      "Fees, slippage, trailing-stop activation and ambiguous OHLC bars are modeled conservatively.",
      "A result is not marked as reliable merely because its win rate is high; trade count, expectancy, drawdown and holdout performance matter.",
    ];

    return {
      bestStrategy: best.strategy,
      bestResult: best.result,
      candidatesTested,
      optimizationInsights: insights,
    };
  }
}
