import { Candle, RiskPolicyConfig, StrategyConfig } from "../types/trading";

export type { RiskPolicyConfig };

export const DEFAULT_RISK_POLICY: RiskPolicyConfig = {
  maxDailyLossPercent: 2,
  maxPeakDrawdownPercent: 6,
  maxPositionNotionalPercent: 35,
  maxLeverage: 1,
  maxOpenPositions: 1,
  maxSpreadBps: 20,
  maxAtrToPricePercent: 5,
  cooldownAfterLosses: 3,
  cooldownMinutes: 30,
};

export interface RiskCheckInput {
  equity: number;
  peakEquity: number;
  dailyStartEquity: number;
  openPositions: number;
  requestedNotional: number;
  leverage: number;
  spreadBps?: number;
  candle?: Candle;
  stopLossPercent: number;
  recentLossCount: number;
  nowMs?: number;
  lastLossAtMs?: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reasons: string[];
  maxLossBudgetUsd: number;
}

export function evaluateRisk(policy: RiskPolicyConfig, input: RiskCheckInput, strategy: StrategyConfig): RiskCheckResult {
  const reasons: string[] = [];
  const equity = Math.max(0, input.equity);
  const peakEquity = Math.max(equity, input.peakEquity);
  const dailyStartEquity = Math.max(0, input.dailyStartEquity);
  const now = input.nowMs ?? Date.now();

  if (input.openPositions >= policy.maxOpenPositions) reasons.push(`Maximum concurrent positions reached (${policy.maxOpenPositions}).`);
  if (input.leverage > policy.maxLeverage) reasons.push(`Requested leverage ${input.leverage}x exceeds policy cap of ${policy.maxLeverage}x.`);
  const maxNotional = equity * policy.maxPositionNotionalPercent / 100;
  if (input.requestedNotional > maxNotional) reasons.push(`Requested notional exceeds ${policy.maxPositionNotionalPercent}% of equity.`);

  const stopRiskUsd = Math.max(0, input.requestedNotional) * Math.max(0, input.stopLossPercent) / 100;
  const configuredRiskPct = Math.max(0, Number(strategy.maxRiskPerTrade) || 0);
  const maxLossBudgetUsd = equity * Math.min(configuredRiskPct, 1) / 100;
  if (stopRiskUsd > maxLossBudgetUsd + 1e-9) {
    reasons.push(`Estimated stop-loss risk of ${stopRiskUsd.toFixed(2)} exceeds the configured risk budget of ${maxLossBudgetUsd.toFixed(2)}.`);
  }

  const peakDrawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
  if (peakDrawdownPct >= policy.maxPeakDrawdownPercent) reasons.push(`Peak drawdown ${peakDrawdownPct.toFixed(2)}% reached the configured halt threshold.`);

  const dailyDrawdownPct = dailyStartEquity > 0 ? ((dailyStartEquity - equity) / dailyStartEquity) * 100 : 0;
  if (dailyDrawdownPct >= policy.maxDailyLossPercent) reasons.push(`Daily drawdown ${dailyDrawdownPct.toFixed(2)}% reached the configured daily loss limit.`);

  if (input.spreadBps !== undefined && input.spreadBps > policy.maxSpreadBps) reasons.push(`Spread ${input.spreadBps.toFixed(1)} bps exceeds the ${policy.maxSpreadBps} bps cap.`);

  if (input.candle && input.candle.close > 0 && input.candle.indicators?.atr !== undefined) {
    const atrPct = input.candle.indicators.atr / input.candle.close * 100;
    if (atrPct > policy.maxAtrToPricePercent) reasons.push(`ATR ${atrPct.toFixed(2)}% exceeds the ${policy.maxAtrToPricePercent}% volatility cap.`);
  }

  if (input.recentLossCount >= policy.cooldownAfterLosses && input.lastLossAtMs && now - input.lastLossAtMs < policy.cooldownMinutes * 60_000) {
    const remaining = Math.ceil((policy.cooldownMinutes * 60_000 - (now - input.lastLossAtMs)) / 60_000);
    reasons.push(`Loss-streak cooldown active for approximately ${remaining} more minute(s).`);
  }

  return { allowed: reasons.length === 0 && maxLossBudgetUsd > 0, reasons, maxLossBudgetUsd };
}