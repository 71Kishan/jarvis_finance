import { BacktestResult, Candle, StrategyConfig } from "../types/trading";

export interface BacktestOptions {
  initialBalance?: number;
  feeBps?: number;
  slippageBps?: number;
  maxBarsPerTrade?: number;
}

export interface WalkForwardResult {
  train: BacktestResult;
  test: BacktestResult;
  windows: number;
  passed: boolean;
  warnings: string[];
}

interface OpenPosition {
  type: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  amount: number;
  sizeUsd: number;
  entryFee: number;
  highestPrice: number;
  lowestPrice: number;
  barsOpen: number;
}

const DEFAULT_OPTIONS: Required<BacktestOptions> = {
  initialBalance: 10000,
  feeBps: 4,
  slippageBps: 2,
  maxBarsPerTrade: 240,
};

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stddev(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

function inferBarsPerYear(candles: Candle[]): number {
  if (candles.length < 3) return 252;
  const deltas: number[] = [];
  for (let i = 1; i < Math.min(candles.length, 50); i++) {
    const dt = candles[i].timestamp - candles[i - 1].timestamp;
    if (dt > 0) deltas.push(dt);
  }
  const median = deltas.sort((a, b) => a - b)[Math.floor(deltas.length / 2)] || 86400000;
  const dayMs = 86400000;
  if (median <= 2 * 60 * 1000) return 365 * 24 * 60 * 60 * 1000 / median;
  if (median <= 2 * 60 * 60 * 1000) return 365 * dayMs / median;
  if (median <= dayMs) return 252 * dayMs / median;
  return 252;
}

function maxDrawdownFromCurve(curve: number[]) {
  let peak = curve[0] || 0;
  let maxDd = 0;
  for (const equity of curve) {
    if (equity > peak) peak = equity;
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
  }
  return maxDd;
}

function annualizedRatio(returns: number[], barsPerYear: number, downsideOnly = false) {
  if (returns.length < 2) return 0;
  const average = mean(returns);
  const series = downsideOnly ? returns.filter((r) => r < 0) : returns;
  const deviation = stddev(series);
  if (deviation === 0) return 0;
  return (average / deviation) * Math.sqrt(Math.max(1, barsPerYear));
}

function signalScore(strategy: StrategyConfig, candle: Candle) {
  const ind = candle.indicators;
  if (!ind) return { long: 0, short: 0 };

  const weights = strategy.indicatorWeights || {
    trendEMA: 1,
    rsiReversal: 1,
    bollingerMeanReversion: 1,
    macdMomentum: 1,
    volumeConfirmation: 1,
  };

  const scale = (value: number, weight: number) => value * weight;

  let long = 0;
  let short = 0;

  if (ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50 && candle.close > ind.ema9) {
    long += scale(30, weights.trendEMA);
  } else if (ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50 && candle.close < ind.ema9) {
    short += scale(30, weights.trendEMA);
  }

  if (ind.rsi <= strategy.rsiOversold + 5 && ind.rsi >= strategy.rsiOversold) {
    long += scale(25, weights.rsiReversal);
  } else if (ind.rsi >= strategy.rsiOverbought - 5 && ind.rsi <= strategy.rsiOverbought) {
    short += scale(25, weights.rsiReversal);
  }

  if (candle.close <= ind.bbandLower * 1.004) {
    long += scale(20, weights.bollingerMeanReversion);
  } else if (candle.close >= ind.bbandUpper * 0.996) {
    short += scale(20, weights.bollingerMeanReversion);
  }

  if (ind.macdHist > 0 && ind.macd > ind.macdSignal) {
    long += scale(15, weights.macdMomentum);
  } else if (ind.macdHist < 0 && ind.macd < ind.macdSignal) {
    short += scale(15, weights.macdMomentum);
  }

  if (ind.volumeSMA > 0 && candle.volume >= ind.volumeSMA * 1.1) {
    long += scale(10, weights.volumeConfirmation);
    short += scale(10, weights.volumeConfirmation);
  }

  return { long, short };
}

export class StrategyOptimizer {
  /**
   * Backtest with explicit transaction costs, conservative OHLC path handling,
   * equity-curve risk statistics, and no fabricated probability claims.
   */
  public static backtest(
    strategy: StrategyConfig,
    candles: Candle[],
    options: BacktestOptions = {}
  ): BacktestResult {
    const cfg = { ...DEFAULT_OPTIONS, ...options };

    if (candles.length < 60) {
      return {
        strategyName: strategy.name,
        totalTrades: 0,
        winRate: 0,
        totalPnl: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        expectancy: 0,
        grossProfit: 0,
        grossLoss: 0,
        totalFees: 0,
        totalSlippage: 0,
        turnoverUsd: 0,
        averageTradePnl: 0,
        longestLosingStreak: 0,
        dataPoints: candles.length,
        verdict: "INSUFFICIENT_DATA",
        warnings: ["At least 60 candles are required for a meaningful backtest."],
      };
    }

    let balance = cfg.initialBalance;
    let peakEquity = balance;
    let totalPnl = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let totalFees = 0;
    let totalSlippage = 0;
    let turnover = 0;
    let wins = 0;
    let losses = 0;
    let losingStreak = 0;
    let longestLosingStreak = 0;
    const equityCurve: number[] = [balance];
    const periodReturns: number[] = [];
    const trades: number[] = [];
    let position: OpenPosition | null = null;

    const effectiveMaxRisk = Math.max(0.1, Math.min(5, strategy.maxRiskPerTrade));

    for (let i = 25; i < candles.length; i++) {
      const candle = candles[i];
      if (!candle?.indicators) {
        equityCurve.push(balance);
        periodReturns.push(0);
        continue;
      }

      let equityBefore = balance;

      if (position) {
        position.barsOpen += 1;

        if (position.type === "LONG") {
          if (candle.high > position.highestPrice) {
            position.highestPrice = candle.high;
            if (strategy.trailingStop) {
              const trailing =
                position.highestPrice * (1 - strategy.trailingStopPercent / 100);
              if (trailing > position.stopLoss) position.stopLoss = trailing;
            }
          }
        } else {
          if (candle.low < position.lowestPrice) {
            position.lowestPrice = candle.low;
            if (strategy.trailingStop) {
              const trailing =
                position.lowestPrice * (1 + strategy.trailingStopPercent / 100);
              if (trailing < position.stopLoss) position.stopLoss = trailing;
            }
          }
        }

        let exitPrice: number | null = null;
        let exitReason: "TP" | "SL" | "TIME" | null = null;

        // Conservative path assumption: when TP and SL are both inside the same
        // candle, assume the adverse stop was hit first. This avoids optimistic
        // ordering that cannot be established from OHLC alone.
        if (position.type === "LONG") {
          const stopHit = candle.low <= position.stopLoss;
          const targetHit = candle.high >= position.takeProfit;
          if (stopHit) {
            exitPrice = position.stopLoss;
            exitReason = "SL";
          } else if (targetHit) {
            exitPrice = position.takeProfit;
            exitReason = "TP";
          }
        } else {
          const stopHit = candle.high >= position.stopLoss;
          const targetHit = candle.low <= position.takeProfit;
          if (stopHit) {
            exitPrice = position.stopLoss;
            exitReason = "SL";
          } else if (targetHit) {
            exitPrice = position.takeProfit;
            exitReason = "TP";
          }
        }

        if (!exitPrice && position.barsOpen >= cfg.maxBarsPerTrade) {
          exitPrice = candle.close;
          exitReason = "TIME";
        }

        if (exitPrice !== null && exitReason) {
          const isLong = position.type === "LONG";
          const rawPnl = isLong
            ? (exitPrice - position.entryPrice) * position.amount
            : (position.entryPrice - exitPrice) * position.amount;

          const exitSlippage = position.sizeUsd * (cfg.slippageBps / 10000);
          const slippedPnl =
            rawPnl - (isLong ? exitSlippage : exitSlippage);
          const exitFee = position.sizeUsd * (cfg.feeBps / 10000);
          const netPnl = slippedPnl - exitFee;

          balance += netPnl;
          totalPnl += netPnl;
          grossProfit += Math.max(0, netPnl);
          grossLoss += Math.max(0, -netPnl);
          totalFees += position.entryFee + exitFee;
          totalSlippage += position.sizeUsd * (2 * cfg.slippageBps / 10000);
          turnover += position.sizeUsd * 2;

          if (netPnl > 0) {
            wins++;
            losingStreak = 0;
          } else {
            losses++;
            losingStreak++;
            longestLosingStreak = Math.max(longestLosingStreak, losingStreak);
          }

          trades.push(netPnl);
          position = null;
        }
      } else {
        const scores = signalScore(strategy, candle);
        const isLong = scores.long > scores.short;
        const rawScore = isLong ? scores.long : scores.short;

        // "minConfidence" is retained in the data model for compatibility,
        // but is treated only as a signal threshold. It is not a probability.
        if (rawScore >= strategy.minConfidence && Math.abs(scores.long - scores.short) >= 10) {
          const riskBudget = balance * (effectiveMaxRisk / 100);
          const stopDistance = strategy.stopLossPercent / 100;

          if (stopDistance > 0 && riskBudget > 0 && balance > 0) {
            const sizeUsd = Math.min(
              riskBudget / stopDistance,
              balance * 0.95
            );
            const slippage = sizeUsd * (cfg.slippageBps / 10000);
            const entryPrice = isLong
              ? candle.close * (1 + cfg.slippageBps / 10000)
              : candle.close * (1 - cfg.slippageBps / 10000);
            const amount = sizeUsd / entryPrice;
            const entryFee = sizeUsd * (cfg.feeBps / 10000);

            if (sizeUsd >= 10 && balance > entryFee) {
              balance -= entryFee;
              totalFees += entryFee;
              totalSlippage += slippage;
              turnover += sizeUsd;

              position = {
                type: isLong ? "LONG" : "SHORT",
                entryPrice,
                stopLoss: isLong
                  ? entryPrice * (1 - strategy.stopLossPercent / 100)
                  : entryPrice * (1 + strategy.stopLossPercent / 100),
                takeProfit: isLong
                  ? entryPrice * (1 + strategy.takeProfitPercent / 100)
                  : entryPrice * (1 - strategy.takeProfitPercent / 100),
                amount,
                sizeUsd,
                entryFee,
                highestPrice: entryPrice,
                lowestPrice: entryPrice,
                barsOpen: 0,
              };
            }
          }
        }
      }

      const markPnl = position
        ? position.type === "LONG"
          ? (candle.close - position.entryPrice) * position.amount
          : (position.entryPrice - candle.close) * position.amount
        : 0;

      const equity = balance + markPnl;
      if (equity > peakEquity) peakEquity = equity;
      const prevEq = equityCurve[equityCurve.length - 1] || equity;
      periodReturns.push(prevEq > 0 ? equity / prevEq - 1 : 0);
      equityCurve.push(equity);
      equityBefore = equity;
      void equityBefore;
    }

    // Mark-to-market the final open position for reporting, without pretending
    // it was executed at a close after the sample ends.
    const finalCandle = candles[candles.length - 1];
    let finalEquity = balance;
    if (position && finalCandle) {
      finalEquity +=
        position.type === "LONG"
          ? (finalCandle.close - position.entryPrice) * position.amount
          : (position.entryPrice - finalCandle.close) * position.amount;
      finalEquityCurveAppend(equityCurve, finalEquity);
    }

    const totalTrades = wins + losses;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
    const averageTradePnl = trades.length ? mean(trades) : 0;
    const profitFactor =
      grossLoss > 0
        ? grossProfit / grossLoss
        : grossProfit > 0
        ? Number.POSITIVE_INFINITY
        : 0;

    const maxDrawdown = maxDrawdownFromCurve(equityCurve);
    const barsPerYear = inferBarsPerYear(candles);
    const sharpe = annualizedRatio(periodReturns, barsPerYear, false);
    const sortino = annualizedRatio(periodReturns, barsPerYear, true);
    const elapsedYears =
      finalCandle && candles[25]
        ? Math.max(
            0,
            (finalCandle.timestamp - candles[25].timestamp) /
              (365.25 * 24 * 60 * 60 * 1000)
          )
        : 0;
    const annualizedReturn =
      elapsedYears > 0 && finalEquity > 0
        ? (finalEquity / cfg.initialBalance) ** (1 / elapsedYears) - 1
        : 0;
    const calmar = maxDrawdown > 0 ? (annualizedReturn * 100) / maxDrawdown : 0;
    const benchmarkReturn =
      candles[0].close > 0
        ? ((finalCandle.close / candles[0].close) - 1) * 100
        : 0;

    const warnings: string[] = [];
    if (totalTrades < 30) warnings.push("Small trade sample; results are unstable.");
    if (maxDrawdown > 20) warnings.push("High drawdown profile.");
    if (profitFactor > 0 && profitFactor < 1) warnings.push("Gross losses exceed gross profits.");
    if (sharpe > 4) warnings.push("Exceptionally high Sharpe may indicate overfitting or unrealistic assumptions.");
    if (position) warnings.push("An open position remains at the end of the test window.");

    const verdict: BacktestResult["verdict"] =
      totalTrades < 30
        ? "REVIEW_REQUIRED"
        : finalEquity <= cfg.initialBalance || profitFactor < 1
        ? "FAIL"
        : maxDrawdown > 20
        ? "REVIEW_REQUIRED"
        : "PASS";

    return {
      strategyName: strategy.name,
      totalTrades,
      winRate: Number(winRate.toFixed(2)),
      totalPnl: Number((finalEquity - cfg.initialBalance).toFixed(2)),
      profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : Number.POSITIVE_INFINITY,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      sharpeRatio: Number(sharpe.toFixed(2)),
      sortinoRatio: Number(sortino.toFixed(2)),
      calmarRatio: Number(calmar.toFixed(2)),
      expectancy: Number(averageTradePnl.toFixed(4)),
      grossProfit: Number(grossProfit.toFixed(2)),
      grossLoss: Number(grossLoss.toFixed(2)),
      totalFees: Number(totalFees.toFixed(2)),
      totalSlippage: Number(totalSlippage.toFixed(2)),
      turnoverUsd: Number(turnover.toFixed(2)),
      averageTradePnl: Number(averageTradePnl.toFixed(2)),
      averageWin: wins ? Number((grossProfit / wins).toFixed(2)) : 0,
      averageLoss: losses ? Number((grossLoss / losses).toFixed(2)) : 0,
      longestLosingStreak,
      benchmarkReturnPercent: Number(benchmarkReturn.toFixed(2)),
      strategyReturnPercent: Number((((finalEquity / cfg.initialBalance) - 1) * 100).toFixed(2)),
      dataPoints: candles.length,
      verdict,
      warnings,
    };
  }

  public static walkForward(
    strategy: StrategyConfig,
    candles: Candle[],
    options: BacktestOptions = {}
  ): WalkForwardResult {
    const warnings: string[] = [];

    if (candles.length < 180) {
      const result = this.backtest(strategy, candles, options);
      warnings.push("Walk-forward validation needs at least 180 bars.");
      return { train: result, test: result, windows: 0, passed: false, warnings };
    }

    const split1 = Math.floor(candles.length * 0.6);
    const split2 = Math.floor(candles.length * 0.8);
    const train = this.backtest(strategy, candles.slice(0, split1), options);
    const validation = this.backtest(strategy, candles.slice(split1, split2), options);
    const test = this.backtest(strategy, candles.slice(split2), options);

    const passed =
      test.verdict === "PASS" &&
      (test.profitFactor || 0) >= 1.1 &&
      (test.maxDrawdown || 100) <= 15 &&
      (test.totalTrades || 0) >= 10;

    if ((validation.totalPnl || 0) <= 0) {
      warnings.push("Validation segment was not profitable; investigate regime sensitivity.");
    }
    if (!passed) {
      warnings.push("Strategy did not pass the formal out-of-sample gate.");
    }

    return {
      train,
      test: {
        ...test,
        oosTradeCount: test.totalTrades,
        oosReturnPercent: test.strategyReturnPercent,
      },
      windows: 1,
      passed,
      warnings,
    };
  }

  /**
   * Candidate generation is deliberately transparent and does not silently
   * declare a statistical winner. A candidate must survive out-of-sample checks
   * before it can be considered for validation.
   */
  public static runOptimizationStudy(
    baseStrategy: StrategyConfig,
    candles: Candle[]
  ): {
    bestStrategy: StrategyConfig;
    bestResult: BacktestResult;
    candidatesTested: { strategy: StrategyConfig; result: BacktestResult }[];
    optimizationInsights: string[];
  } {
    const candidates: StrategyConfig[] = [
      {
        ...baseStrategy,
        id: `${baseStrategy.id}-conservative`,
        name: `${baseStrategy.name} — Conservative`,
        version: baseStrategy.version + 1,
        minConfidence: Math.max(baseStrategy.minConfidence, 82),
        stopLossPercent: Math.max(baseStrategy.stopLossPercent, 1),
        takeProfitPercent: Math.max(baseStrategy.takeProfitPercent, 2.2),
        maxRiskPerTrade: Math.min(baseStrategy.maxRiskPerTrade, 1.0),
      },
      {
        ...baseStrategy,
        id: `${baseStrategy.id}-trend`,
        name: `${baseStrategy.name} — Trend`,
        version: baseStrategy.version + 1,
        minConfidence: Math.max(baseStrategy.minConfidence, 75),
      },
      {
        ...baseStrategy,
        id: `${baseStrategy.id}-mean-reversion`,
        name: `${baseStrategy.name} — Mean Reversion`,
        version: baseStrategy.version + 1,
        minConfidence: Math.max(baseStrategy.minConfidence, 80),
        rsiOversold: 30,
        rsiOverbought: 70,
      },
      { ...baseStrategy },
    ];

    const results = candidates.map((candidate) => ({
      strategy: candidate,
      result: this.backtest(candidate, candles),
    }));

    const passing = results.filter((x) => x.result.verdict === "PASS");
    const ranked = [...passing].sort(
      (a, b) =>
        (b.result.strategyReturnPercent || 0) -
        (a.result.strategyReturnPercent || 0)
    );

    const selected = ranked[0] || results.find((x) => x.strategy.id === baseStrategy.id) || results[0];

    const insights = [
      `Backtested ${results.length} transparent candidates over ${candles.length} bars.`,
      `Transaction costs modeled at 4 bps per side plus 2 bps slippage per side.`,
      `Candidate selection is not a proof of future profitability.`,
      candles.length < 180
        ? "Not enough data for formal walk-forward validation yet."
        : "Formal walk-forward testing is available for the current dataset.",
    ];

    if (!passing.length) {
      insights.push("No candidate passed the minimum research gate; keep the current strategy unchanged.");
    } else {
      insights.push(`${passing.length} candidate(s) passed the initial backtest gate and still require out-of-sample review.`);
    }

    return {
      bestStrategy: selected.strategy,
      bestResult: selected.result,
      candidatesTested: results,
      optimizationInsights: insights,
    };
  }
}

function finalEquityCurveAppend(curve: number[], equity: number) {
  const last = curve[curve.length - 1];
  if (last === undefined || Math.abs(last - equity) > 1e-9) curve.push(equity);
}
