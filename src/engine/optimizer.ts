import { BacktestResult, Candle, PaperTradingSettings, StrategyConfig } from "../types/trading";
import { evaluateSignal } from "./signalEngine";
import { modelEntryFill, modelExitFill, resolveStopTarget, grossPnL } from "./executionModel";
import { DEFAULT_RISK_POLICY } from "./riskPolicy";

interface SimPosition {
  type: "LONG" | "SHORT";
  entryPrice: number;
  amount: number;
  sizeUsd: number;
  entryFeeUsd: number;
  stopLoss: number;
  takeProfit: number;
  highestPrice: number;
  lowestPrice: number;
}

export class StrategyOptimizer {
  public static backtest(strategy: StrategyConfig, candles: Candle[], initialBalance = 10000): BacktestResult {
    if (candles.length < 120 || initialBalance <= 0) {
      return {
        strategyName: strategy.name,
        totalTrades: 0,
        winRate: 0,
        totalPnl: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        verdict: "FAILED",
      };
    }

    const s = {
      ...strategy,
      maxRiskPerTrade: Math.min(1, Math.max(0.05, Number(strategy.maxRiskPerTrade) || 0.5)),
    };
    const settings: PaperTradingSettings = {
      slippageBps: 2,
      feeTierPercent: 0.04,
      leverage: 1,
      soundAlerts: false,
    };

    let cash = initialBalance;
    let peak = initialBalance;
    let maxDrawdown = 0;
    let totalFees = 0;
    let totalSlippage = 0;
    let wins = 0;
    let losses = 0;
    let grossWins = 0;
    let grossLosses = 0;
    let position: SimPosition | null = null;
    const returns: number[] = [];
    let previousEquity = initialBalance;
    let dailyStartEquity = initialBalance;
    let dailyKey = "";
    let consecutiveLosses = 0;
    let lastLossAtMs = 0;
    let halted = false;

    const recordClosedTrade = (net: number, fees: number, slippage: number) => {
      totalFees += fees;
      totalSlippage += slippage;
      if (net > 0) {
        wins += 1;
        grossWins += net;
      } else if (net < 0) {
        losses += 1;
        grossLosses += Math.abs(net);
      }
    };

    const closePosition = (p: SimPosition, exitPrice: number) => {
      const exit = modelExitFill(exitPrice, p.type, Math.abs(p.amount * exitPrice), settings);
      const gross = grossPnL(p.type, p.entryPrice, exit.fillPrice, p.amount);
      const net = gross - p.entryFeeUsd - exit.feeUsd;
      recordClosedTrade(net, p.entryFeeUsd + exit.feeUsd, exit.slippageUsd);
      // Entry fee was already deducted when the position opened. Return the reserved notional
      // plus gross P&L, less only the exit fee.
      cash += p.sizeUsd + gross - exit.feeUsd;
      position = null;
    };

    for (let i = 60; i < candles.length; i += 1) {
      const candle = candles[i];
      const candleDay = new Date(candle.timestamp).toISOString().slice(0, 10);
      if (candleDay !== dailyKey) {
        dailyKey = candleDay;
        const markPrice = position ? candle.close : 0;
        dailyStartEquity = markPrice > 0 ? cash + position!.sizeUsd + grossPnL(position!.type, position!.entryPrice, markPrice, position!.amount) : cash;
      }

      if (position) {
        // Resolve exits using the stop/target state that existed before the bar.
        // Trailing-stop updates from this bar's extreme are applied only after the
        // bar has survived, preventing intrabar look-ahead bias.
        const resolved = resolveStopTarget(position.type, candle, position.stopLoss, position.takeProfit);
        if (resolved.kind !== "NONE") {
          const wasPositive = (() => {
            const gross = grossPnL(position!.type, position!.entryPrice, modelExitFill(resolved.price, position!.type, Math.abs(position!.amount * resolved.price), settings).fillPrice, position!.amount);
            return gross - position!.entryFeeUsd > 0;
          })();
          closePosition(position, resolved.price);
          if (wasPositive) {
            consecutiveLosses = 0;
            lastLossAtMs = 0;
          } else {
            consecutiveLosses += 1;
            lastLossAtMs = candle.timestamp;
          }
        } else {
          // No exit occurred on this bar. Update the trailing stop only now so it
          // becomes effective starting with the next bar.
          if (position.type === "LONG") {
            position.highestPrice = Math.max(position.highestPrice, candle.high);
            if (s.trailingStop) {
              position.stopLoss = Math.max(position.stopLoss, position.highestPrice * (1 - s.trailingStopPercent / 100));
            }
          } else {
            position.lowestPrice = Math.min(position.lowestPrice, candle.low);
            if (s.trailingStop) {
              position.stopLoss = Math.min(position.stopLoss, position.lowestPrice * (1 + s.trailingStopPercent / 100));
            }
          }
        }
      }

      const openPnlBeforeEntry = position
        ? grossPnL(position.type, position.entryPrice, candle.close, position.amount)
        : 0;
      const markedEquityBeforeEntry = cash + (position ? position.sizeUsd : 0) + openPnlBeforeEntry;
      const peakDrawdownPctBeforeEntry = peak > 0 ? ((peak - markedEquityBeforeEntry) / peak) * 100 : 0;
      const dailyDrawdownPctBeforeEntry = dailyStartEquity > 0 ? ((dailyStartEquity - markedEquityBeforeEntry) / dailyStartEquity) * 100 : 0;
      if (!halted && (peakDrawdownPctBeforeEntry >= DEFAULT_RISK_POLICY.maxPeakDrawdownPercent || dailyDrawdownPctBeforeEntry >= DEFAULT_RISK_POLICY.maxDailyLossPercent)) {
        if (position) {
          closePosition(position, candle.close);
          position = null;
        }
        halted = true;
      }

      const inCooldown = consecutiveLosses >= DEFAULT_RISK_POLICY.cooldownAfterLosses &&
        lastLossAtMs > 0 &&
        candle.timestamp - lastLossAtMs < DEFAULT_RISK_POLICY.cooldownMinutes * 60_000;

      let openedThisBar = false;
      const canOpenNextBar = i < candles.length - 1;
      if (!position && !halted && !inCooldown && canOpenNextBar) {
        const signal = evaluateSignal(candle, candles.slice(0, i), s);
        if (signal.eligible) {
          const next = candles[i + 1];
          const stopDistance = Math.max(0.001, s.stopLossPercent / 100);
          const riskBudget = cash * s.maxRiskPerTrade / 100;
          const notional = Math.min(
            riskBudget / stopDistance,
            cash * DEFAULT_RISK_POLICY.maxPositionNotionalPercent / 100
          );

          if (notional >= 10) {
            const entry = modelEntryFill(next.open, signal.direction as "LONG" | "SHORT", notional, settings);
            if (notional + entry.feeUsd <= cash) {
              cash -= notional + entry.feeUsd;
              totalFees += entry.feeUsd;
              totalSlippage += entry.slippageUsd;

              const stopLoss = signal.direction === "LONG"
                ? entry.fillPrice * (1 - s.stopLossPercent / 100)
                : entry.fillPrice * (1 + s.stopLossPercent / 100);
              const takeProfit = signal.direction === "LONG"
                ? entry.fillPrice * (1 + s.takeProfitPercent / 100)
                : entry.fillPrice * (1 - s.takeProfitPercent / 100);

              position = {
                type: signal.direction as "LONG" | "SHORT",
                entryPrice: entry.fillPrice,
                amount: notional / entry.fillPrice,
                sizeUsd: notional,
                entryFeeUsd: entry.feeUsd,
                stopLoss,
                takeProfit,
                highestPrice: entry.fillPrice,
                lowestPrice: entry.fillPrice,
              };
              openedThisBar = true;
            }
          }
        }
      }

      const openPnl = position
        ? grossPnL(position.type, position.entryPrice, candle.close, position.amount)
        : 0;
      // A signal on bar i fills at bar i+1 open. Do not mark the new position
      // against bar i's close; that close predates the fill and would create
      // look-ahead P&L. For the opening bar, equity reflects the entry fee only.
      const equity = openedThisBar
        ? cash + (position ? position.sizeUsd : 0)
        : cash + (position ? position.sizeUsd : 0) + openPnl;
      peak = Math.max(peak, equity);
      const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      returns.push(previousEquity > 0 ? equity / previousEquity - 1 : 0);
      previousEquity = equity;
    }

    // The final candle is processed for exits above. If the position survives
    // the final bar, force-close at its observed close so the reported equity
    // and return include the liquidation cost and the final bar.
    if (position) {
      closePosition(position, candles[candles.length - 1].close);
      const finalEquityAfterForcedClose = cash;
      peak = Math.max(peak, finalEquityAfterForcedClose);
      const finalDrawdown = peak > 0 ? ((peak - finalEquityAfterForcedClose) / peak) * 100 : 0;
      maxDrawdown = Math.max(maxDrawdown, finalDrawdown);
      returns.push(previousEquity > 0 ? finalEquityAfterForcedClose / previousEquity - 1 : 0);
      previousEquity = finalEquityAfterForcedClose;
    }

    const totalTrades = wins + losses;
    const mean = this.mean(returns);
    const sd = this.standardDeviation(returns);
    const barsPerYear = this.estimateBarsPerYear(candles);
    const sampleDays = candles.length > 1
      ? Math.max(0, (candles[candles.length - 1].timestamp - candles[0].timestamp) / 86_400_000)
      : 0;
    // Annualized statistics from a very short sample can become numerically
    // impressive while being statistically fragile. Keep them unavailable until
    // the backtest spans at least 30 calendar days.
    const annualizationReliable = sampleDays >= 30;
    const annualizationFactor = annualizationReliable ? Math.sqrt(barsPerYear) : 1;
    const sharpe = sd > 0 && annualizationReliable ? (mean / sd) * annualizationFactor : 0;
    const downside = this.downsideDeviation(returns);
    const sortino = downside > 0 && annualizationReliable ? (mean / downside) * annualizationFactor : 0;
    const finalEquity = cash;
    const totalPnl = finalEquity - initialBalance;
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
    const expectancy = totalTrades > 0 ? (grossWins - grossLosses) / totalTrades : 0;
    const annualizedReturn = annualizationReliable && finalEquity > 0 && initialBalance > 0
      ? Math.pow(finalEquity / initialBalance, barsPerYear / Math.max(1, candles.length - 1)) - 1
      : undefined;
    const volatilityAnnualized = annualizationReliable ? sd * Math.sqrt(barsPerYear) : undefined;

    let verdict: BacktestResult["verdict"] = "FAILED";
    if (totalTrades >= 30 && totalPnl > 0 && maxDrawdown < 10 && sharpe > 0) {
      verdict = "SURVIVED_AND_PROFITABLE";
    } else if (maxDrawdown >= 10) {
      verdict = "UNSAFE_HIGH_DRAWDOWN";
    }

    return {
      strategyName: s.name,
      totalTrades,
      winRate: totalTrades ? Number((wins / totalTrades * 100).toFixed(1)) : 0,
      totalPnl: Number(totalPnl.toFixed(2)),
      profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : 999,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      sharpeRatio: Number(sharpe.toFixed(2)),
      sortinoRatio: Number(sortino.toFixed(2)),
      annualizedReturn: annualizedReturn === undefined ? undefined : Number(annualizedReturn.toFixed(4)),
      volatilityAnnualized: volatilityAnnualized === undefined ? undefined : Number(volatilityAnnualized.toFixed(4)),
      sampleDays: Number(sampleDays.toFixed(2)),
      annualizationReliable,
      expectancyPerTrade: Number(expectancy.toFixed(4)),
      avgWin: wins ? Number((grossWins / wins).toFixed(2)) : 0,
      avgLoss: losses ? Number((grossLosses / losses).toFixed(2)) : 0,
      totalFees: Number(totalFees.toFixed(2)),
      totalSlippage: Number(totalSlippage.toFixed(2)),
      verdict,
    };
  }

  public static runOptimizationStudy(baseStrategy: StrategyConfig, candles: Candle[]) {
    const candidates: StrategyConfig[] = [
      { ...baseStrategy, id: baseStrategy.id + "-trend", version: baseStrategy.version + 1, name: baseStrategy.name + " / Trend", minConfidence: 72 },
      { ...baseStrategy, id: baseStrategy.id + "-strict", version: baseStrategy.version + 1, name: baseStrategy.name + " / Strict", minConfidence: 82, maxRiskPerTrade: 0.5 },
      { ...baseStrategy, id: baseStrategy.id + "-balanced", version: baseStrategy.version + 1, name: baseStrategy.name + " / Balanced", minConfidence: 68, maxRiskPerTrade: 0.4 },
      { ...baseStrategy, id: baseStrategy.id + "-baseline", name: baseStrategy.name + " / Baseline" },
    ];

    // One split is easy to over-interpret. Use rolling train/validation/test
    // folds once enough history exists. Each reported test window begins with
    // a 60-bar warm-up overlap, but performance starts only after that overlap,
    // so consecutive OOS windows do not reuse scored bars.
    const trainBars = 360;
    const validationBars = 120;
    const testBars = 120;
    const warmup = 60;
    const minimumForWalkForward = trainBars + validationBars + testBars;

    if (candles.length < minimumForWalkForward) {
      return {
        bestStrategy: baseStrategy,
        bestResult: this.backtest(baseStrategy, candles),
        candidatesTested: [],
        walkForwardFolds: [],
        walkForwardReliable: false,
        optimizationInsights: [
          `Not enough history for rolling walk-forward validation. At least ${minimumForWalkForward} bars are required for one 360/120/120 fold; supply more history before optimization.`,
        ],
      };
    }

    const folds: Array<{
      start: number;
      trainEnd: number;
      validationEnd: number;
      testEnd: number;
      selected: StrategyConfig;
      selectionScore: number;
      test: BacktestResult;
    }> = [];

    const selectionCounts = new Map<string, number>();

    for (let start = 0; start + minimumForWalkForward <= candles.length; start += testBars) {
      const trainEnd = start + trainBars;
      const validationEnd = trainEnd + validationBars;
      const testEnd = validationEnd + testBars;

      const rows = candidates.map((strategy) => {
        const train = this.backtest(strategy, candles.slice(start, trainEnd));
        const validation = this.backtest(
          strategy,
          candles.slice(Math.max(start, trainEnd - warmup), validationEnd),
        );
        const test = this.backtest(
          strategy,
          candles.slice(Math.max(start, validationEnd - warmup), testEnd),
        );

        // Candidate selection is restricted to train + validation. The OOS test
        // result is never used to choose the fold's candidate.
        const selectionScore =
          (validation.totalTrades >= 20 ? 2 : validation.totalTrades >= 10 ? 1 : 0) +
          (validation.totalPnl > 0 ? 2 : 0) +
          (validation.profitFactor >= 1.2 ? 1 : 0) +
          (validation.sharpeRatio > 0 ? 1 : 0) +
          (validation.maxDrawdown < 10 ? 1 : 0) +
          (train.totalPnl > 0 ? 1 : 0);

        return { strategy, train, validation, test, selectionScore };
      });

      rows.sort((a, b) =>
        b.selectionScore - a.selectionScore ||
        b.validation.sharpeRatio - a.validation.sharpeRatio ||
        b.validation.totalPnl - a.validation.totalPnl ||
        b.train.sharpeRatio - a.train.sharpeRatio
      );

      const selected = rows[0];
      folds.push({
        start,
        trainEnd,
        validationEnd,
        testEnd,
        selected: selected.strategy,
        selectionScore: selected.selectionScore,
        test: selected.test,
      });

      selectionCounts.set(
        selected.strategy.id,
        (selectionCounts.get(selected.strategy.id) || 0) + 1,
      );

    }

    const mostSelected = [...selectionCounts.entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    const selectedStrategy =
      candidates.find((candidate) => candidate.id === mostSelected) || baseStrategy;

    const selectedFolds = folds.filter((fold) => fold.selected.id === selectedStrategy.id);
    const oosTotalTrades = selectedFolds.reduce((sum, fold) => sum + fold.test.totalTrades, 0);
    const oosPositiveFolds = selectedFolds.filter((fold) => fold.test.totalPnl > 0).length;
    const oosMeanReturn = selectedFolds.length
      ? selectedFolds.reduce((sum, fold) => sum + fold.test.totalPnl / 10_000, 0) / selectedFolds.length
      : 0;
    const sortedOos = selectedFolds.map((fold) => fold.test.totalPnl / 10_000).sort((a, b) => a - b);
    const oosMedianReturn = sortedOos.length
      ? sortedOos[Math.floor(sortedOos.length / 2)]
      : 0;
    const worstOosDrawdown = selectedFolds.length
      ? Math.max(...selectedFolds.map((fold) => fold.test.maxDrawdown))
      : 0;
    const firstOosStart = selectedFolds[0]?.validationEnd;
    const lastOosEnd = selectedFolds[selectedFolds.length - 1]?.testEnd;
    const oosStartTimestamp =
      firstOosStart !== undefined ? candles[firstOosStart]?.timestamp : undefined;
    const oosEndTimestamp =
      lastOosEnd !== undefined ? candles[Math.min(candles.length - 1, lastOosEnd - 1)]?.timestamp : undefined;
    const oosCalendarDays =
      oosStartTimestamp !== undefined && oosEndTimestamp !== undefined
        ? Math.max(0, (oosEndTimestamp - oosStartTimestamp) / 86_400_000)
        : 0;

    const aggregateTestTrades = selectedFolds.reduce((sum, fold) => sum + fold.test.totalTrades, 0);
    const aggregateWins = selectedFolds.reduce(
      (sum, fold) => sum + Math.round(fold.test.totalTrades * fold.test.winRate / 100),
      0,
    );
    const aggregatePnlPercent = oosMeanReturn * 100;

    const bestResult: BacktestResult = {
      strategyName: selectedStrategy.name,
      totalTrades: aggregateTestTrades,
      winRate: aggregateTestTrades ? Number((aggregateWins / aggregateTestTrades * 100).toFixed(1)) : 0,
      totalPnl: Number((aggregatePnlPercent / 100 * 10_000).toFixed(2)),
      profitFactor: 0,
      maxDrawdown: Number(worstOosDrawdown.toFixed(2)),
      sharpeRatio: 0,
      sortinoRatio: 0,
      sampleDays: 0,
      annualizationReliable: false,
      expectancyPerTrade: aggregateTestTrades ? Number(((aggregatePnlPercent / 100 * 10_000) / aggregateTestTrades).toFixed(4)) : 0,
      avgWin: 0,
      avgLoss: 0,
      totalFees: Number(selectedFolds.reduce((sum, fold) => sum + (fold.test.totalFees ?? 0), 0).toFixed(2)),
      totalSlippage: Number(selectedFolds.reduce((sum, fold) => sum + (fold.test.totalSlippage ?? 0), 0).toFixed(2)),
      verdict: aggregateTestTrades >= 30 && oosPositiveFolds / Math.max(1, selectedFolds.length) >= 0.5
        ? "SURVIVED_AND_PROFITABLE"
        : worstOosDrawdown >= 10
          ? "UNSAFE_HIGH_DRAWDOWN"
          : "FAILED",
    };

    const candidatesTested = candidates.map((strategy) => {
      const strategyFolds = folds.filter((fold) => fold.selected.id === strategy.id);
      const tests = strategyFolds.map((fold) => fold.test);
      const pnlPercent = tests.length
        ? tests.reduce((sum, result) => sum + result.totalPnl / 10_000, 0) / tests.length
        : 0;
      return {
        strategy,
        result: strategyFolds.length
          ? {
              ...tests[tests.length - 1],
              totalPnl: Number((pnlPercent * 10_000).toFixed(2)),
              sampleDays: 0,
              annualizationReliable: false,
              annualizedReturn: undefined,
              volatilityAnnualized: undefined,
              sharpeRatio: 0,
              sortinoRatio: 0,
            }
          : this.backtest(strategy, candles.slice(-testBars - warmup)),
        selectedFolds: strategyFolds.length,
      };
    });

    return {
      bestStrategy: selectedStrategy,
      bestResult,
      candidatesTested,
      walkForwardFolds: folds.map((fold) => ({
        trainStartBar: fold.start,
        trainEndBar: fold.trainEnd,
        validationEndBar: fold.validationEnd,
        testEndBar: fold.testEnd,
        selectedStrategyId: fold.selected.id,
        selectionScore: fold.selectionScore,
        oos: {
          totalTrades: fold.test.totalTrades,
          returnPercent: Number((fold.test.totalPnl / 10_000 * 100).toFixed(3)),
          maxDrawdownPercent: fold.test.maxDrawdown,
          winRate: fold.test.winRate,
        },
      })),
      walkForwardReliable:
        folds.length >= 3 &&
        selectedFolds.length >= 3 &&
        oosCalendarDays >= 30,
      walkForwardSummary: {
        folds: folds.length,
        selectedFolds: selectedFolds.length,
        selectedFoldHitRatePercent: selectedFolds.length
          ? Number((oosPositiveFolds / selectedFolds.length * 100).toFixed(1))
          : 0,
        meanOosReturnPercent: Number((oosMeanReturn * 100).toFixed(3)),
        medianOosReturnPercent: Number((oosMedianReturn * 100).toFixed(3)),
        worstOosDrawdownPercent: Number(worstOosDrawdown.toFixed(2)),
        oosCalendarDays: Number(oosCalendarDays.toFixed(2)),
        selectionCounts: Object.fromEntries(selectionCounts),
      },
      optimizationInsights: [
        "Research now uses rolling 360-bar train, 120-bar validation and 120-bar held-out test windows when enough history exists.",
        "The 60-bar overlap is warm-up only; scored OOS bars do not overlap between consecutive test windows.",
        "Candidate selection uses train + validation evidence only. Held-out test results are never used to choose a candidate within a fold.",
        "Each test fold includes modeled entry/exit fees, adverse slippage, next-bar entries, conservative stop-first ambiguity handling, and final-bar accounting.",
        "Fold-level return statistics are normalized against a common $10,000 research capital so they are comparable; they are not a promise of realized capital growth.",
        "A strategy appearing in multiple folds is stronger evidence than a single split, but rolling backtests remain historical evidence and can still fail in future regimes.",
        "Walk-forward evidence does not authorize live-money execution. Forward paper/shadow validation remains required.",
      ],
    };
  }


  private static estimateBarsPerYear(candles: Candle[]): number {
    if (candles.length < 3) return 252;
    const deltas = [];
    for (let i = 1; i < Math.min(candles.length, 25); i += 1) {
      const delta = candles[i].timestamp - candles[i - 1].timestamp;
      if (delta > 0) deltas.push(delta);
    }
    if (!deltas.length) return 252;
    deltas.sort((a, b) => a - b);
    const medianMs = deltas[Math.floor(deltas.length / 2)];
    const dayMs = 86_400_000;
    if (medianMs >= 18 * 60 * 60 * 1000) return 252;
    return Math.max(1, Math.round((365 * dayMs) / medianMs));
  }

  private static mean(values: number[]) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  private static standardDeviation(values: number[]) {
    if (values.length < 2) return 0;
    const mean = this.mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  }

  private static downsideDeviation(values: number[]) {
    const downside = values.filter((value) => value < 0);
    return downside.length ? Math.sqrt(this.mean(downside.map((value) => value ** 2))) : 0;
  }
}