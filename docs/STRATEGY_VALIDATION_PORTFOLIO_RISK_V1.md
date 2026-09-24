# Strategy Validation + Portfolio Risk V1

## Purpose

This phase turns research output and sandbox account state into explicit deterministic gates. A strategy may be interesting without being promotion-eligible, and an account may be connected without being safe to increase exposure.

## Strategy validation gate

The promotion policy currently requires all of the following:

- at least 30 completed trades in the historical backtest;
- at least 3 rolling walk-forward folds with at least 3 folds selecting the candidate;
- at least 30 calendar days of selected-candidate out-of-sample coverage;
- at least 50% positive selected-candidate OOS folds;
- non-negative median OOS return;
- worst selected-candidate OOS drawdown at or below 10%.

The result is one of INSUFFICIENT_EVIDENCE, FAILED, or PROVISIONALLY_VALIDATED.

PROVISIONALLY_VALIDATED is deliberately not a claim of future profitability. It is only the result of passing the current evidence policy. Forward paper/shadow validation remains a separate gate.

AI recommendations cannot bypass this policy.

## Portfolio risk gate

Sandbox Spot orders pass through a provider-neutral portfolio risk evaluator after venue-specific order validation.

The default Spot policy is:

- maximum gross asset exposure: 100% of marked equity;
- maximum single-asset exposure: 25% of marked equity;
- minimum base-currency cash reserve: 10%;
- maximum active orders: 5.

The risk evaluator uses exact decimal strings for financial arithmetic and fails closed when non-zero assets or active orders cannot be trustedly valued in the configured portfolio base currency.

The sandbox route currently defaults to USDT as the portfolio base. Orders quoted in another currency are rejected by this phase rather than approximated through an unimplemented FX/cross-asset conversion layer.

## Research and execution boundary

Strategy validation is research evidence. Portfolio risk is execution control. Neither layer authorizes real-money trading.

The Binance path in this repository remains explicitly testnet-gated. Unknown provider execution remains an unreconciled state and must not be silently retried or treated as canceled.

## Next gate

The next stage should be server-owned shadow trading: generate strategy intents from the same completed-candle data path used by the paper engine, run them through the same risk/order state machine, and reconcile the resulting shadow ledger without placing orders. The shadow stage should produce operational evidence before any live-money design is considered.