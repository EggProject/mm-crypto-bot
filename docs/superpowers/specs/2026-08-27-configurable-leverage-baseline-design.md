# Configurable Selected-Leverage Baseline Design

## Status and decision

This design defines the approved target state for configurable selected
leverage. It does not implement the target state and does not authorize live
trading.

The canonical default and initial selected leverage is the exact decimal string
`"10"`. Every initial full-setting comparison, optimization, and backtest uses
that value. Their results are baseline evidence only and must never mutate the
selected-leverage baseline automatically.

The program must also accept an explicitly configured selected leverage other
than `"10"`. This is a breaking policy change: active code, documentation, and
tests must stop claiming that only 10 is representable. Historical audit
documents remain historical evidence and must not be described as active
policy.

## Terms and invariants

| Term               | Meaning                                                         | Required separation                                  |
| ------------------ | --------------------------------------------------------------- | ---------------------------------------------------- |
| Selected leverage  | The immutable session-wide target configured before activation. | Never inferred from an order, position, or strategy. |
| Effective leverage | Exposure divided by the relevant equity at a recorded instant.  | Is an observed risk metric, not a selected setting.  |
| Borrowed amount    | The exact borrowed asset amount and liability.                  | Is not leverage or exposure.                         |
| Exposure           | Exact gross and net exposure.                                   | Is not leverage or borrowed amount.                  |

Selected leverage is one immutable value for a bot session. It is neither a
per-order value nor a per-strategy live override. A strategy may consume the
session value for sizing and risk checks, but it cannot select, change, or
override it. Restarting with a different value is a new session and requires a
new activation audit trail.

The generic domain type is an exact, canonical positive decimal leverage. It
is represented and compared as an exact rational, never as a JavaScript binary
float. Canonical serialized input is a decimal string without whitespace,
sign, exponent, leading zeroes, or redundant fractional trailing zeroes;
examples include `"2"`, `"2.5"`, and `"10"`. Invalid, zero, negative, or
non-canonical input is rejected rather than rounded or normalized silently.

Paper and backtest paths may use every domain-valid selected leverage. Live
Bybit Spot Margin activation accepts only the canonical integer strings `"2"`
through `"10"`; all other domain-valid values, including `"2.5"`, fail closed
before an exchange call. The official [Set Leverage
contract](https://bybit-exchange.github.io/docs/v5/spot-margin-uta/set-leverage)
defines the string input range and lets the venue reject an account or currency
limit. No static account, currency, VIP, or maximum-leverage fallback is
permitted.

## Configuration and session lifecycle

The configuration contract contains one explicit canonical selected-leverage
field. Its default is `"10"`; a missing field resolves to that exact value in
non-live configuration. The schema validates only the generic exact domain
representation. It performs no network call, no venue assumption, and no
implicit conversion to a venue value.

Live activation performs the following fail-closed sequence after static
configuration validation:

1. Read the configured canonical selected leverage and freeze it in the
   session state before strategy or order execution begins.
2. Authenticate and read `/v5/spot-margin-trade/state`; require
   `spotMarginMode === "1"` before any set request. The official [status
   contract](https://bybit-exchange.github.io/docs/v5/spot-margin-uta/status)
   defines `spotMarginMode` and `spotLeverage`.
3. Call the CCXT generated raw POST method for
   `/v5/spot-margin-trade/set-leverage` with the frozen canonical string; do
   not use CCXT's unified derivative-only `setLeverage`. Require a successful
   response.
4. Read authenticated state again and require `spotMarginMode === "1"` and
   `spotLeverage` exactly equal to the frozen selected value.
5. Write activation evidence only after the exact readback succeeds.
6. Permit orders only while the frozen value, account eligibility, symbol
   eligibility, and borrow eligibility continue to be independently verified.

No validation command, config parsing operation, backtest, or paper run may
make a live external call. Venue verification belongs only to authenticated live
activation and order admission.

Each live order independently reads authenticated state and checks exact
equality between the session selected leverage and `spotLeverage` before the
account, symbol, and borrow checks. A mode mismatch, failed readback, malformed
response, unavailable endpoint, or boundary error blocks the order. Reduce-only
orders remain risk-reducing, but still perform and record this verification;
they do not weaken the admission policy.

## Failure behavior

| Failure                                                                | Required result                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Invalid or non-canonical configured leverage                           | Configuration rejection with field-level error; no repair or default replacement.  |
| Live value is not one of the canonical strings `"2"` through `"10"`    | Activation rejection before a set request and before any order.                    |
| State mode, account, symbol, or borrow check is unavailable or invalid | Activation or order rejection, according to the point of failure.                  |
| Set request succeeds but exact readback fails or differs               | Activation failure; new orders remain blocked and the mismatch is audited.         |
| Later order-time mismatch                                              | Block that order, surface a structured safety event, and preserve the cause chain. |
| Session attempts to change selected leverage                           | Reject the transition; require a stopped session and fresh activation.             |
| Backtest or optimizer proposes another leverage                        | Store it only as a separate experiment; never rewrite the `"10"` baseline.         |

No path may clamp, round, coerce, or substitute 10 for an explicitly invalid
configured value.

## Baseline evidence and experiments

Initial full-setting optimization evidence must pin selected leverage to exact
`"10"` for comparable in-sample, validation, and out-of-sample runs. A baseline
selection requires zero liquidation cases, zero invalid-risk cases, zero
invalid-data cases, and risk-adjusted selection criteria. Results must include
the canonical selected leverage and the comparable dataset and risk settings.

Leverage-sensitivity work is allowed only as separate, explicitly labeled
non-baseline artifacts. It cannot claim that a non-10 value is optimized for
the initial baseline, alter baseline configuration, or change a live session.

## Boundary and audit contract

The exchange boundary must expose typed authenticated-state read, raw selected-
leverage set, and exact readback operations. It must use CCXT generated raw
methods for the official Bybit Spot Margin endpoints rather than the unified
derivative-only `setLeverage`, preserve raw responses only at the boundary,
validate them into the generic exact domain, and retain the complete cause
chain on error. The design does not claim that the existing CCXT decimal
transport is exact; transport exactness must be proven separately before a live
path relies on it.

Activation and order audit records must include at least:

- UTC timestamp, session ID, correlation ID, account and symbol identifiers;
- configured and frozen selected leverage as canonical strings;
- authenticated `spotMarginMode`, selected value, exact readback value, and
  observation timestamp;
- set request outcome and equality result;
- account, symbol, and borrow eligibility outcomes;
- effective leverage, borrowed amounts, and gross/net exposure as distinct
  exact serialized values where applicable;
- order ID or reduce-only classification when an order exists; and
- a structured failure reason with the preserved cause chain when unsuccessful.

## Migration

This migration has no compatibility alias. The configuration field accepts only
the canonical exact representation; deprecated numeric, per-strategy, dynamic,
or legacy aliases are rejected. The migration spans configuration validation,
core and risk domain contracts, exchange types/authorizer/service, bot order
and audit paths, and backtest metadata and tests.

Migration delivery requires coordinated updates to active code, configuration
examples, operator documentation, tests, and public contracts. It must remove
the active literal-10-only claim while retaining `"10"` as the default and
initial evidence baseline. Configuration parsing remains side-effect-free;
live set/state verification is introduced only at the activation boundary.

Rollback is operationally fail-closed. If a deployed selected leverage other
than `"10"` must be rolled back to a literal-10-only release, stop the session,
record the reason, and explicitly activate a new canonical `"10"` session after
fresh venue verification. No rollback may silently rewrite a running session's
configuration or translate a non-10 value to 10.

## Rejected alternatives

### Literal-10 lock

Keeping only a literal 10 representation prevents the approved explicit
configuration flexibility and conflates the initial baseline with the generic
domain. It is rejected. The default and initial evidence baseline remain
exactly `"10"` without making other domain-valid values unrepresentable.

### Per-strategy or dynamic live leverage

Allowing a strategy, order, signal, or runtime condition to choose leverage
would create conflicting live settings and defeat independent order admission.
It is rejected. Live leverage is session-wide, immutable, and verified at both
activation and every order.

### Unsupported maximum inference

The documented set and state endpoints do not expose a maximum-leverage field.
A static account, currency, or VIP fallback would fabricate evidence. It is
rejected; a venue rejection, malformed response, or unavailable endpoint fails
activation or order admission closed.

## Acceptance gates

Implementation follows test-driven development: first add a failing public
configuration, activation, and order-admission test for each contract branch,
then implement the smallest change that makes it pass. The completed scope
requires 100% in-scope statements, branches, functions, and lines across unit
and end-to-end tests.

Required tests include exact canonical parsing and rejection, immutable session
state, paper/backtest domain values, baseline pinning at `"10"`, separate
sensitivity metadata, live rejection of every value outside canonical integer
strings `"2"` through `"10"`, authenticated mode/set/readback equality,
account/symbol/borrow failures, malformed and unavailable state/set endpoints,
per-order mismatch blocking, reduce-only verification/audit behavior, and
migration/rollback failure cases. Live E2E tests must use injected
authenticated-boundary fakes; they must not contact an external venue.

## Non-goals

- This design does not claim that non-10 leverage is optimized for the initial
  baseline.
- This design does not authorize live activation or external API calls during
  configuration validation.
- This design does not prove existing decimal transport exactness.
- This design does not permit dynamic, per-order, or per-strategy live leverage.
