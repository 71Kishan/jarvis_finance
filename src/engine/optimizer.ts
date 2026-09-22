import { BacktestResult, Candle, PaperTradingSettings, StrategyConfig } from "../types/trading";
import { evaluateSignal } from "./signalEngine";
import { modelEntryFill, modelExitFill, resolveStopTarget, grossPnL } from "./executionModel";

interface SimPosition { type: "LONG" | "SHORT"; entryPrice: number; amount: number; sizeUsd: number; stopLoss: number; takeProfit: number; highestPrice: number; lowestPrice: number; }

export class StrategyOptimizer {
  public static backtest(strategy: StrategyConfig, candles: Candle[], initialBalance = 10000): BacktestResult {
    if (candles.length < 80 || initialBalance <= 0) return { strategyName: strategy.name, totalTrades: 0, winRate: 0, totalPnl: 0, profitFactor: 0, maxDrawdown: 0, sharpeRatio: 0, verdict: "FAILED" };
    const s = { ...strategy, maxRiskPerTrade: Math.min(1, Math.max(0.05, Number(strategy.maxRiskPerTrade) || 0.5)) };
    const settings: PaperTradingSettings = { slippageBps: 2, feeTierPercent: 0.04, leverage: 1, soundAlerts: false };
    let cash = initialBalance, peak = initialBalance, maxDrawdown = 0, totalFees = 0, totalSlippage = 0, wins = 0, losses = 0, grossWins = 0, grossLosses = 0;
    let position: SimPosition | null = null;
    const returns: number[] = [];
    let previousEquity = initialBalance;

    for (let i = 60; i < candles.length - 1; i++) {
      const candle = candles[i];
      if (position) this.processPosition(position, candle, settings, (net, fees, slippage) => {
        cash += position!.sizeUsd + net; totalFees += fees; totalSlippage += slippage;
        if (net > 0) { wins++; grossWins += net; } else if (net < 0) { losses++; grossLosses += Math.abs(net); }
        position = null;
      });

      if (!position) {
        const signal = evaluateSignal(candle, candles.slice(0, i), s);
        if (signal.eligible) {
          const next = candles[i + 1];
          const stopDistance = Math.max(0.001, s.stopLossPercent / 100);
          const riskBudget = cash * s.maxRiskPerTrade / 100;
          const notional = Math.min(riskBudget / stopDistance, cash * 0.35);
          if (notional >= 10) {
            const fill = modelEntryFill(next.open, signal.direction as "LONG" | "SHORT", notional, settings);
            if (notional + fill.feeUsd <= cash) {
              cash -= notional + fill.feeUsd; totalFees += fill.feeUsd; totalSlippage += fill.slippageUsd;
              const stopLoss = signal.direction === "LONG" ? fill.fillPrice * (1 - s.stopLossPercent / 100) : fill.fillPrice * (1 + s.stopLossPercent / 100);
              const takeProfit = signal.direction === "LONG" ? fill.fillPrice * (1 + s.takeProfitPercent / 100) : fill.fillPrice * (1 - s.takeProfitPercent / 100);
              position = { type: signal.direction as "LONG" | "SHORT", entryPrice: fill.fillPrice, amount: notional / fill.fillPrice, sizeUsd: notional, stopLoss, takeProfit, highestPrice: fill.fillPrice, lowestPrice: fill.fillPrice };
            }
          }
        }
      }

      const openPnl = position ? grossPnL(position.type, position.entryPrice, candle.close, position.amount) : 0;
      const equity = cash + (position ? position.sizeUsd : 0) + openPnl;
      peak = Math.max(peak, equity);
      const dd = peak > 0 ? (peak - equity) / peak * 100 : 0; maxDrawdown = Math.max(maxDrawdown, dd);
      returns.push(previousEquity > 0 ? equity / previousEquity - 1 : 0); previousEquity = equity;
    }

    const totalTrades = wins + losses;
    const mean = this.mean(returns); const sd = this.standardDeviation(returns);
    const sharpe = sd > 0 ? mean / sd * Math.sqrt(returns.length) : 0;
    const downside = this.downsideDeviation(returns);
    const sortino = downside > 0 ? mean / downside * Math.sqrt(returns.length) : 0;
    const finalEquity = cash + (position ? position.sizeUsd : 0);
    const totalPnl = finalEquity - initialBalance;
    const pf = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
    const expectancy = totalTrades > 0 ? (grossWins - grossLosses) / totalTrades : 0;
    const vol = sd * Math.sqrt(252);

    let verdict: BacktestResult["verdict"] = "FAILED";
    if (totalTrades >= 30 && totalPnl > 0 && maxDrawdown < 10 && sharpe > 0) verdict = "SURVIVED_AND_PROFITABLE";
    else if (totalPnl >= 0 && maxDrawdown < 10) verdict = "UNSAFE_HIGH_DRAWDOWN";

    return { strategyName: s.name, totalTrades, winRate: totalTrades ? Number((wins / totalTrades * 100).toFixed(1)) : 0, totalPnl: Number(totalPnl.toFixed(2)), profitFactor: Number.isFinite(pf) ? Number(pf.toFixed(2)) : 999, maxDrawdown: Number(maxDrawdown.toFixed(2)), sharpeRatio: Number(sharpe.toFixed(2)), sortinoRatio: Number(sortino.toFixed(2)), annualizedReturn: Number(((finalEquity / initialBalance) - 1).toFixed(4)), volatilityAnnualized: Number(vol.toFixed(4)), expectancyPerTrade: Number(expectancy.toFixed(4)), avgWin: wins ? Number((grossWins / wins).toFixed(2)) : 0, avgLoss: losses ? Number((grossLosses / losses).toFixed(2)) : 0, totalFees: Number(totalFees.toFixed(2)), totalSlippage: Number(totalSlippage.toFixed(2)), verdict };
  }

  public static runOptimizationStudy(baseStrategy: StrategyConfig, candles: Candle[]) {
    const candidates: StrategyConfig[] = [
      { ...baseStrategy, id: baseStrategy.id + "-trend", version: baseStrategy.version + 1, name: baseStrategy.name + " / Trend", minConfidence: 72 },
      { ...baseStrategy, id: baseStrategy.id + "-strict", version: baseStrategy.version + 1, name: baseStrategy.name + " / Strict", minConfidence: 82, maxRiskPerTrade: 0.5 },
      { ...baseStrategy, id: baseStrategy.id + "-balanced", version: baseStrategy.version + 1, name: baseStrategy.name + " / Balanced", minConfidence: 68, maxRiskPerTrade: 0.4 },
      { ...baseStrategy, id: baseStrategy.id + "-baseline", name: baseStrategy.name + " / Baseline" },
    ];
    const trainEnd = Math.floor(candles.length * 0.6); const validationEnd = Math.floor(candles.length * 0.8);
    const rows = candidates.map(strategy => {
      const train = this.backtest(strategy, candles.slice(0, trainEnd));
      const validation = this.backtest(strategy, candles.slice(Math.max(0, trainEnd - 60), validationEnd));
      const test = this.backtest(strategy, candles.slice(Math.max(0, validationEnd - 60)));
      const selectionScore = (test.totalTrades >= 10 ? 1 : 0) + (test.totalPnl > 0 ? 1 : 0) + (test.sharpeRatio > 0 ? 1 : 0) + (test.maxDrawdown < 10 ? 1 : 0) + (validation.totalPnl > 0 ? 1 : 0);
      return { strategy, result: test, selectionScore, train, validation };
    }).sort((a, b) => b.selectionScore - a.selectionScore || b.result.sharpeRatio - a.result.sharpeRatio || b.result.totalPnl - a.result.totalPnl);
    const selected = rows[0];
    return {
      bestStrategy: selected.strategy, bestResult: selected.result,
      candidatesTested: rows.map(r => ({ strategy: r.strategy, result: r.result })),
      optimizationInsights: [
        "Walk-forward split: 60% train, 20% validation, 20% test, with warm-up overlap only for indicator calculation.",
        "Test results include modeled entry/exit fees and slippage.",
        "A small trade sample is not sufficient for production validation; forward paper and shadow testing remain required.",
        "Selected candidate is a research choice for further validation, not a claim of future performance.",
      ],
    };
  }

  private static processPosition(position: SimPosition, candle: Candle, settings: PaperTradingSettings, onClose: (net: number, fees: number, slippage: number) => void) {
    if (position.type === "LONG") { position.highestPrice = Math.max(position.highestPrice, candle.high); if (position.highestPrice > position.entryPrice) position.stopLoss = Math.max(position.stopLoss, position.highestPrice * 0.994); }
    else { position.lowestPrice = Math.min(position.lowestPrice, candle.low); if (position.lowestPrice < position.entryPrice) position.stopLoss = Math.min(position.stopLoss, position.lowestPrice * 1.006); }
    const result = resolveStopTarget(position.type, candle, position.stopLoss, position.takeProfit);
    if (result.kind === "NONE") return;
    const fill = modelExitFill(result.price, position.type, Math.abs(position.amount * result.price), settings);
    onClose(grossPnL(position.type, position.entryPrice, fill.fillPrice, position.amount) - fill.feeUsd, fill.feeUsd, fill.slippageUsd);
  }

  private static mean(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
  private static standardDeviation(values: number[]) { if (values.length < 2) return 0; const m = this.mean(values); return Math.sqrt(this.mean(values.map(v => (v - m) ** 2))); }
  private static downsideDeviation(values: number[]) { const d = values.filter(v => v < 0); return d.length ? Math.sqrt(this.mean(d.map(v => v ** 2))) : 0; }
}