# Configurable Selected-Leverage Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add one exact, configurable, immutable selected-leverage value while preserving "10" as the initial optimization and backtest baseline.

**Architecture:** A small numeric-domain module owns canonical selected-leverage parsing and exact comparison. Configuration freezes one session-wide value; the exchange boundary validates the Bybit Spot Margin live subset, uses authenticated raw set/state calls at activation and per order, while bot, core/risk, and research consumers keep selected leverage distinct from effective leverage, borrowing, and exposure.

**Tech Stack:** TypeScript 6, Bun 1.3.14, Zod 3, @mm-crypto-bot/numeric ExactRational, CCXT bybiteu, Bun tests, Vitest, ESLint, Prettier.

**Spec:** docs/superpowers/specs/2026-08-27-configurable-leverage-baseline-design.md

## Global Constraints

- The canonical default and every initial full-setting baseline is exact "10".
- A non-10 configured value is domain-valid only as a canonical positive decimal string; no selected-leverage decision may use number, rounding, or coercion.
- One frozen selected leverage applies to the whole session; no strategy, order, or dynamic condition may choose it.
- Configuration validation, CLI validation, paper, and backtest paths make no live external call.
- Bybit EU live activation accepts only canonical integer strings "2" through "10"; it authenticates, requires spotMarginMode "1", sets the exact value through the raw endpoint, reads it back, and fails closed on any mismatch or uncertainty.
- Each live order independently re-verifies exact selected-leverage equality and eligibility. Reduce-only is risk-reducing but still audited with selected leverage.
- Selected leverage, effective leverage, borrowed amounts, and exposure remain separate fields and types; no static maximum-leverage evidence is invented.
- Initial IS/validation/OOS evidence pins "10"; separate leverage-sensitivity artifacts are non-baseline and cannot rewrite configuration.
- This is a breaking migration with no legacy alias. Do not silently rewrite non-10 configuration during rollback.
- Work in independently reviewed one-writer slices. The integration worktree is dirty: preserve unrelated edits and never revert files outside a slice.
- Do not stage or commit interim work. Each slice ends with a coordinator handoff/checkpoint; the final commit is allowed only after independent Terra technical review, Luna process review, re-review of findings, and full gates.

---

## File and ownership map

| Slice         | Primary ownership                                                                 | Responsibility                                                                  |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Exact domain  | packages/numeric/src/selected-leverage.ts                                         | Canonical positive selected-leverage representation and exact comparison.       |
| Configuration | apps/bot/src/config/                                                              | One [bot] selected_leverage field, default "10", no per-strategy live selector. |
| Exchange      | packages/exchange/src/                                                            | Authenticated state/set/readback and per-order authorization.                   |
| Core and risk | packages/core/src/risk/                                                           | Frozen selected-leverage policy separated from effective-exposure limits.       |
| Bot           | apps/bot/src/bot/                                                                 | Freeze at startup, activation ordering, order threading, audit context.         |
| Research      | packages/backtest-tools/src/cli/                                                  | Unforgeable baseline metadata and separated sensitivity runs.                   |
| Active policy | AGENTS.md, .codex/ENGINEERING-STANDARDS.md, run-bot/config/, active operator docs | Update only after code contracts pass.                                          |

### Task 1: Exact selected-leverage domain

**Files:**

- Create: packages/numeric/src/selected-leverage.ts
- Create: packages/numeric/src/selected-leverage.test.ts
- Modify: packages/numeric/src/index.ts
- Modify: packages/numeric/src/public-api.test.ts

**Interfaces:**

```ts
export class SelectedLeverage {
  static readonly initialBaseline: SelectedLeverage;
  static parse(input: unknown): SelectedLeverage;
  readonly canonical: string;
  readonly exact: ExactRational;
  private constructor(canonical: string, exact: ExactRational) {
    this.canonical = canonical;
    this.exact = exact;
    Object.freeze(this);
  }
  equals(other: SelectedLeverage): boolean;
  compare(other: SelectedLeverage): -1 | 0 | 1;
  toJSON(): string;
}
```

- [ ] **Step 1: Write failing exact-domain tests.**

```ts
expect(SelectedLeverage.parse("10").equals(SelectedLeverage.initialBaseline)).toBe(true);
expect(() => SelectedLeverage.parse("02")).toThrow();
expect(() => SelectedLeverage.parse("2.0")).toThrow();
expect(() => SelectedLeverage.parse(10)).toThrow();
expect(() => SelectedLeverage.parse("0")).toThrow();
expect(SelectedLeverage.parse("2.5").compare(SelectedLeverage.parse("10"))).toBe(-1);
```

- [ ] **Step 2: Run the numeric test red.** Run: bun run --filter @mm-crypto-bot/numeric test -- selected-leverage.test.ts. Expected: FAIL because the selected-leverage module and exports do not exist.

- [ ] **Step 3: Write minimal implementation.**

```ts
static parse(input: unknown): SelectedLeverage {
  if (typeof input !== "string" || canonicalizeExternalDecimal(input) !== input) {
    throw new ExactNumericError("INVALID_INPUT", "Selected leverage must be a canonical decimal string.");
  }
  const exact = ExactRational.from(input);
  if (exact.compare(ExactRational.from(0n)) <= 0) {
    throw new ExactNumericError("INVALID_INPUT", "Selected leverage must be positive.");
  }
  return new SelectedLeverage(input, exact);
}
static readonly initialBaseline = SelectedLeverage.parse("10");
```

Freeze the instance; keep its constructor private; implement equals and compare through exact values, and return canonical from toJSON. Do not use a cast or numeric coercion.

- [ ] **Step 4: Run the slice gate.** Run: bun run --filter @mm-crypto-bot/numeric test && bun run --filter @mm-crypto-bot/numeric typecheck && bun run --filter @mm-crypto-bot/numeric lint. Expected: PASS with public API tests importing only the package root.

- [ ] **Step 5: Coordinator checkpoint.** Report owned files and RED/GREEN evidence. Do not commit or touch another package before its writer is assigned.

### Task 2: Canonical bot configuration and migration boundary

**Files:**

- Modify: apps/bot/src/config/schema.ts
- Modify: apps/bot/src/config/defaults.ts
- Modify: apps/bot/src/config/loader.ts
- Modify: apps/bot/src/config/config.test.ts
- Modify: apps/bot/src/config/config-exchange-boundary.test.ts
- Modify: apps/bot/src/config/config-roundtrip.test.ts
- Modify: apps/bot/src/config/config-test-fixtures.test-support.ts
- Modify: apps/bot/src/config/strategy-registry.ts
- Modify: apps/bot/src/config/strategy-registry.test.ts

**Interfaces:**

```ts
interface BotConfig {
  readonly bot: { readonly selected_leverage: SelectedLeverage };
}
const initialBaseline = SelectedLeverage.initialBaseline;
```

- [ ] **Step 1: Write failing public config tests.** Cover an omitted field yielding "10"; "2.5" surviving paper load unchanged; numeric selected_leverage = 10, "2.0", "01", "0", and unknown aliases failing with path bot.selected_leverage; and strategies.dydx_cex_carry.leverage failing as a removed live-selector field.

- [ ] **Step 2: Run the config tests red.** Run: bun test apps/bot/src/config/config.test.ts apps/bot/src/config/config-exchange-boundary.test.ts apps/bot/src/config/strategy-registry.test.ts. Expected: FAIL because the field, parser integration, and selector removal are absent.

- [ ] **Step 3: Write minimal configuration implementation.**

```ts
selected_leverage: z.string()
  .default("10")
  .transform((input) => SelectedLeverage.parse(input));
const serialized = config.bot.selected_leverage.canonical;
```

Remove only fields selecting live leverage; retain unrelated strategy sizing, caps, and effective-risk inputs. Do not call an exchange while loading or validating.

- [ ] **Step 4: Prove serialization and no alias compatibility.** Emit the canonical string in config round trips; update fixtures; reject numeric and deprecated aliases instead of normalizing them. Add an injected-exchange assertion proving config parsing makes no connection.

- [ ] **Step 5: Run the slice gate.** Run: bun test apps/bot/src/config && bun run --filter @mm-crypto-bot/bot typecheck && bunx eslint apps/bot/src/config. Expected: PASS with no live connection from a config test.

- [ ] **Step 6: Coordinator checkpoint.** Hand off the schema and migration contract. Do not commit.

### Task 3: Exchange set/state readback and order authorization

**Files:**

- Modify: packages/exchange/package.json
- Modify: packages/exchange/src/types.ts
- Modify: packages/exchange/src/index.ts
- Modify: packages/exchange/src/bybit-eu-client.ts
- Modify: packages/exchange/src/bybit-eu-spot-margin-client.ts
- Modify: packages/exchange/src/spot-margin-authorization.ts
- Modify: packages/exchange/src/bybit-eu-order-service.ts
- Modify: packages/exchange/src/spot-margin-authorization.test.ts
- Modify: packages/exchange/src/bybit-eu-spot-margin-order.test.ts
- Modify: packages/exchange/src/bybit-eu-adapter.test-support.ts

**Interfaces:**

```ts
export interface SpotMarginActivationEvidence {
  readonly selectedLeverage: SelectedLeverage;
  readonly readbackLeverage: SelectedLeverage;
  readonly spotMarginMode: "1";
  readonly observedAtUtcMs: number;
}
export interface SpotMarginAuthorizationRequest {
  readonly selectedLeverage: SelectedLeverage;
  readonly symbol: Symbol;
  readonly intent: SpotMarginOrderIntent;
}
export interface SpotMarginAuthorizationClient {
  getSpotMarginState(): Promise<unknown>;
  setSpotMarginLeverage(input: Readonly<{ leverage: string }>): Promise<unknown>;
  getBorrowQuota(
    input: Readonly<{ category: "spot"; symbol: string; side: "Buy" | "Sell" }>,
  ): Promise<unknown>;
}
```

- [ ] **Step 1: Write failing injected-client tests.** Test that live accepts each canonical integer string from "2" through "10" and rejects "1", "2.5", "10.0", and "11" before an exchange call; then test authenticated `spotMarginMode === "1"`, raw set success, exact `spotLeverage` readback, mismatch, malformed or unavailable state/set response, symbol and borrow failure, risk-increasing and reduce-only verification/audit evidence, and a per-order selected-value mismatch.

- [ ] **Step 2: Run exchange tests red.** Run: bun test packages/exchange/src/spot-margin-authorization.test.ts packages/exchange/src/bybit-eu-spot-margin-order.test.ts. Expected: FAIL because selected leverage is currently literal "10" and authenticated mode/set/readback do not exist.

- [ ] **Step 3: Write minimal exchange implementation.**

```ts
assertLiveBybitSelectedLeverage(requested);
const before = await client.getSpotMarginState();
requireSpotMarginModeOn(before);
await client.setSpotMarginLeverage({ leverage: requested.canonical });
const after = await client.getSpotMarginState();
const readback = parseSpotLeverage(after);
if (!requested.equals(readback))
  throw new SpotMarginAuthorizationError("Bybit EU selected leverage readback mismatch", undefined);
```

`assertLiveBybitSelectedLeverage` accepts only canonical integer strings "2"
through "10". Implement `getSpotMarginState` with CCXT's generated raw GET
method for `/v5/spot-margin-trade/state`, and `setSpotMarginLeverage` with its
generated raw POST method for `/v5/spot-margin-trade/set-leverage`; do not call
the unified derivative-only `setLeverage`. The official [Set Leverage
contract](https://bybit-exchange.github.io/docs/v5/spot-margin-uta/set-leverage)
does not provide a maximum field, while [Get Status And
Leverage](https://bybit-exchange.github.io/docs/v5/spot-margin-uta/status)
provides `spotMarginMode` and `spotLeverage`. Parse every raw venue value at the
boundary. A venue rejection for account or currency limits, any malformed
response, or unavailable endpoint blocks activation; never synthesize account,
currency, VIP, or maximum evidence.

- [ ] **Step 4: Enforce activation and per-order checks.**

```ts
async activateSelectedLeverage(selectedLeverage: SelectedLeverage): Promise<SpotMarginActivationEvidence>;
async authorize(request: SpotMarginAuthorizationRequest): Promise<SpotMarginAuthorizationEvidence>;
const state = await client.getSpotMarginState();
requireSpotMarginModeOn(state);
if (!request.selectedLeverage.equals(parseSpotLeverage(state))) {
  throw new SpotMarginAuthorizationError("Bybit EU selected leverage differs from the frozen session value", undefined);
}
```

The activation sequence is authenticated mode read, raw set request, exact mode
and leverage readback, then activation evidence. Every authorize call rereads
and compares selected leverage before account, symbol, and borrow admission.
Reduce-only may preserve its existing risk-reduction treatment after those
checks, but it never bypasses selected-leverage state verification.

- [ ] **Step 5: Run the slice gate.** Run: bun run --filter @mm-crypto-bot/exchange test && bun run --filter @mm-crypto-bot/exchange typecheck && bun run --filter @mm-crypto-bot/exchange lint. Expected: PASS with fakes only and no credential or outbound venue call in tests.

- [ ] **Step 6: Coordinator checkpoint.** Hand off exchange signatures and fake contract. Do not commit.

### Task 4: Core and risk separation

**Files:**

- Modify: packages/core/package.json
- Create: packages/core/src/risk/session-selected-leverage.ts
- Create: packages/core/src/risk/session-selected-leverage.test.ts
- Modify: packages/core/src/risk/leverage-invariant.ts
- Modify: packages/core/src/risk/leverage-invariant.test.ts
- Modify: packages/core/src/index.ts

**Interfaces:**

```ts
export interface FrozenSelectedLeverage {
  readonly selected: SelectedLeverage;
}
export function freezeSelectedLeverage(value: SelectedLeverage): FrozenSelectedLeverage;
export function assertSelectedLeverageUnchanged(
  frozen: FrozenSelectedLeverage,
  candidate: SelectedLeverage,
): void;
```

- [ ] **Step 1: Write failing core tests.** Prove frozen "10" and "2.5" compare exactly; replacement attempts fail; selected leverage never substitutes for observed effective leverage; aggregate exposure limits remain independently enforced.

- [ ] **Step 2: Run the core test red.** Run: bun test packages/core/src/risk/session-selected-leverage.test.ts packages/core/src/risk/leverage-invariant.test.ts. Expected: FAIL because the frozen policy does not exist and the invariant has literal-10-only policy.

- [ ] **Step 3: Write minimal policy split.**

```ts
export function freezeSelectedLeverage(selected: SelectedLeverage): FrozenSelectedLeverage {
  return Object.freeze({ selected });
}
export function assertSelectedLeverageUnchanged(
  frozen: FrozenSelectedLeverage,
  candidate: SelectedLeverage,
): void {
  if (!frozen.selected.equals(candidate)) throw new Error("Selected leverage is immutable for a session.");
}
```

Parameterize only limits whose meaning is selected leverage; retain effective-exposure calculations and limits separately. Preserve exact USD 1000 equity and USD 10000 initial gross exposure authority.

- [ ] **Step 4: Run the slice gate.** Run: bun run --filter @mm-crypto-bot/core test && bun run --filter @mm-crypto-bot/core typecheck && bun run --filter @mm-crypto-bot/core lint. Expected: PASS with no selected-leverage calculation in binary floating point.

- [ ] **Step 5: Coordinator checkpoint.** Report preserved effective-risk invariants. Do not commit.

### Task 5: Bot startup, immutable session, orders, and audit

**Files:**

- Create: apps/bot/src/bot/selected-leverage-session.ts
- Create: apps/bot/src/bot/selected-leverage-session.test.ts
- Modify: apps/bot/src/bot/bot-exchange-initializer.ts
- Modify: apps/bot/src/bot/bot.ts
- Modify: apps/bot/src/bot/bot-runtime-assembly.ts
- Modify: apps/bot/src/bot/order-manager.ts
- Modify: apps/bot/src/bot/order-manager.types.ts
- Modify: apps/bot/src/bot/order-manager-placement.ts
- Modify: apps/bot/src/bot/order-manager.placement.test.ts
- Modify: apps/bot/src/bot/bot.runtime.test.ts
- Modify: apps/bot/src/bot/bot-public-boundaries.test.ts
- Modify: apps/bot/test/e2e/runtime-driver/strategy-runner-order-lifecycle-boundaries.ts

**Interfaces:**

```ts
export interface SelectedLeverageSession {
  readonly selectedLeverage: SelectedLeverage;
  readonly activationEvidence: SpotMarginActivationEvidence | undefined;
}
export interface OrderManagerOptions {
  readonly selectedLeverageSession: SelectedLeverageSession;
}
```

- [ ] **Step 1: Write failing bot and runtime-driver tests.** Cover paper "2.5"; live eligibility then set/readback before assembly; failed activation blocks strategies and orders; session replacement failure; entry and reduce-only audit values; per-order readback mismatch blocking; and distinct selected leverage, effective leverage, borrowed amount, and exposure fields.

- [ ] **Step 2: Run bot tests red.** Run: bun test apps/bot/src/bot/selected-leverage-session.test.ts apps/bot/src/bot/order-manager.placement.test.ts apps/bot/src/bot/bot.runtime.test.ts. Expected: FAIL because startup hardcodes "10" and has no session object.

- [ ] **Step 3: Write minimal startup and threading.**

```ts
const frozen = freezeSelectedLeverage(options.config.bot.selected_leverage);
const activationEvidence =
  options.config.bot.mode === "live" ? await authorizer.activateSelectedLeverage(frozen.selected) : undefined;
const session: SelectedLeverageSession = Object.freeze({
  selectedLeverage: frozen.selected,
  activationEvidence,
});
const selectedLeverageWireValue = session.selectedLeverage.canonical;
```

Perform this after feed authentication and before BotRuntimeAssembly.create. Thread the one session object through assembly, OrderManager, request creation, and audit metadata. Use injected exchange-boundary fakes for E2E; do not create a test-only production bypass.

- [ ] **Step 4: Preserve live safety.**

```ts
if (!session.selectedLeverage.equals(nextSelectedLeverage)) {
  throw new OrderManagerError("Selected leverage changes require a stopped session.", undefined);
}
audit.selectedLeverage = session.selectedLeverage.canonical;
```

Keep live-equity authority and exact initial-equity behavior. Replace hardcoded selected "10" request creation with the frozen canonical value; never mutate a running BotConfig or session.

- [ ] **Step 5: Run the slice gate.** Run: bun test apps/bot/src/bot && bun run --filter @mm-crypto-bot/bot typecheck && bun run --filter @mm-crypto-bot/bot typecheck:e2e. Expected: PASS without a live venue call.

- [ ] **Step 6: Coordinator checkpoint.** Report startup ordering, audit fields, and preserved dirty-worktree files. Do not commit.

### Task 6: Baseline evidence metadata and sensitivity separation

**Files:**

- Create: packages/backtest-tools/src/cli/selected-leverage-metadata.ts
- Create: packages/backtest-tools/src/cli/selected-leverage-metadata.test.ts
- Modify: packages/backtest-tools/src/cli/workflow-common.ts
- Modify: packages/backtest-tools/src/cli/run-baseline.ts
- Modify: packages/backtest-tools/src/cli/run-sweep.ts
- Modify: packages/backtest-tools/src/cli/run-oos.ts
- Create: packages/backtest-tools/src/cli/run-leverage-sensitivity.ts
- Create: packages/backtest-tools/src/cli/run-leverage-sensitivity.test.ts
- Modify: packages/backtest-tools/src/cli/workflow-cli.e2e.test.ts

**Interfaces:**

```ts
export interface BaselineLeverageMetadata {
  readonly baselineSelectedLeverage: "10";
  readonly evidenceKind: "initial-baseline";
}
export interface SensitivityLeverageMetadata {
  readonly selectedLeverage: string;
  readonly evidenceKind: "leverage-sensitivity";
  readonly baselineSelectedLeverage: "10";
}
export function requireInitialBaselineLeverage(value: SelectedLeverage): "10";
```

- [ ] **Step 1: Write failing metadata and CLI tests.** Assert the initial full-setting baseline workflow, its comparable validation run, and its initial OOS leg reject values other than "10"; output has literal baseline metadata; the separate sensitivity runner accepts domain-valid values with evidenceKind "leverage-sensitivity"; and neither command edits input TOML. A later explicit nonbaseline OOS mode must serialize its nonbaseline evidence kind rather than impersonating initial evidence.

- [ ] **Step 2: Run research tests red.** Run: bun test packages/backtest-tools/src/cli/selected-leverage-metadata.test.ts packages/backtest-tools/src/cli/run-leverage-sensitivity.test.ts packages/backtest-tools/src/cli/workflow-cli.e2e.test.ts. Expected: FAIL because metadata and sensitivity runner do not exist.

- [ ] **Step 3: Write minimal research implementation.**

```ts
export function requireInitialBaselineLeverage(value: SelectedLeverage): "10" {
  if (!value.equals(SelectedLeverage.initialBaseline))
    throw new Error("Initial full-setting evidence requires selected leverage 10.");
  return "10";
}
const initialMetadata: BaselineLeverageMetadata = {
  baselineSelectedLeverage: requireInitialBaselineLeverage(value),
  evidenceKind: "initial-baseline",
};
const sensitivityMetadata: SensitivityLeverageMetadata = {
  selectedLeverage: value.canonical,
  baselineSelectedLeverage: "10",
  evidenceKind: "leverage-sensitivity",
};
```

Thread the value as data, not a config writer. Only the initial full-setting workflow and its paired validation/OOS evidence call requireInitialBaselineLeverage. The separate sensitivity runner writes nonbaseline artifacts; a later explicit nonbaseline OOS mode records its own evidence kind. Reject selection runs with liquidation, invalid-risk, or invalid-data outcomes before risk-adjusted selection.

- [ ] **Step 4: Run the slice gate.** Run: bun run --filter @mm-crypto-bot/backtest-tools test && bun run --filter @mm-crypto-bot/backtest-tools typecheck && bun run --filter @mm-crypto-bot/backtest-tools lint. Expected: PASS with no config mutation or non-10 baseline claim.

- [ ] **Step 5: Coordinator checkpoint.** Hand off baseline and sensitivity artifact schemas. Do not commit.

### Task 7: Active policy, examples, and migration documentation

**Files:**

- Modify: AGENTS.md
- Modify: .codex/ENGINEERING-STANDARDS.md
- Modify: run-bot/config/default.toml
- Modify: run-bot/config/paper-backtest-verified.toml
- Modify: docs/production-strategies/bot.md
- Modify: docs/LIVE-TRADING.md
- Modify: plans/full-refactor/DECISIONS.md
- Modify: plans/full-refactor/VALIDATION.md
- Modify: plans/full-refactor/DEPENDENCIES.md
- Modify: plans/full-refactor/ROLLBACK.md
- Create: apps/bot/src/config/selected-leverage-policy.test.ts

**Interfaces:** Active text names [bot] selected_leverage = "10", the session-wide exact domain, and Bybit EU activation/readback. Historical audit documents remain historical evidence.

- [ ] **Step 1: Write failing policy scanner tests.**

```ts
const activeFiles = [
  "AGENTS.md",
  ".codex/ENGINEERING-STANDARDS.md",
  "docs/LIVE-TRADING.md",
  "docs/production-strategies/bot.md",
];
for (const file of activeFiles) expect(readText(file)).not.toMatch(/only (selected )?leverage.*10/i);
expect(readText("run-bot/config/default.toml")).toContain('selected_leverage = "10"');
```

Exclude clearly marked historical audit directories from this policy assertion.

- [ ] **Step 2: Run the scanner red.** Run: bun test apps/bot/src/config/selected-leverage-policy.test.ts. Expected: FAIL until active examples and policy match the new contract.

- [ ] **Step 3: Update active materials after code contracts pass.**

```text
[bot]
selected_leverage = "10"
```

Describe "10" as default and initial evidence baseline, configured alternatives as session-wide and venue-verified, and rollback as stop plus fresh activation. Preserve exact USD 1000 equity and USD 10000 initial gross exposure. Do not rewrite historical audit evidence.

- [ ] **Step 4: Run documentation and config checks.** Run: bunx prettier --check AGENTS.md .codex/ENGINEERING-STANDARDS.md run-bot/config/default.toml run-bot/config/paper-backtest-verified.toml docs/production-strategies/bot.md docs/LIVE-TRADING.md plans/full-refactor/DECISIONS.md plans/full-refactor/VALIDATION.md plans/full-refactor/DEPENDENCIES.md plans/full-refactor/ROLLBACK.md. Expected: PASS with active examples parsing under the new schema.

- [ ] **Step 5: Coordinator checkpoint.** Confirm user-approved wording. Do not commit.

### Task 8: Integrated coverage, hygiene, and independent review handoff

**Files:**

- Modify: scripts/coverage-tools/bot-runtime-scope.json
- Modify: scripts/coverage-tools/bot-runtime-scope.test.ts
- Modify only manifests required by new unit and E2E test files.

**Interfaces:** Coverage manifests list each new runtime and test file exactly once; no threshold, test selection, or coverage scope is weakened.

- [ ] **Step 1: Write failing manifest tests.**

```ts
expect(scope.runtimeFiles).toContain("apps/bot/src/bot/selected-leverage-session.ts");
expect(scope.unitTestFiles).toContain("apps/bot/src/bot/selected-leverage-session.test.ts");
```

Add each selected-leverage runtime module and unit/E2E test to required lists; assert omission fails the scope verifier.

- [ ] **Step 2: Run the scope test red.** Run: bun test scripts/coverage-tools/bot-runtime-scope.test.ts. Expected: FAIL while a selected-leverage file is missing from its manifest.

- [ ] **Step 3: Register exact files and run targeted coverage.** Run: bun scripts/coverage-tools/verify-bot-runtime-scope.ts && bun test apps/bot/src/config apps/bot/src/bot && bun run --filter @mm-crypto-bot/numeric coverage && bun run --filter @mm-crypto-bot/exchange coverage && bun run --filter @mm-crypto-bot/core coverage && bun run --filter @mm-crypto-bot/backtest-tools coverage. Expected: PASS with 100% in-scope statements, branches, functions, and lines.

- [ ] **Step 4: Run full integration gates.** Run: bun run --filter @mm-crypto-bot/bot coverage && bun run --filter @mm-crypto-bot/bot coverage:e2e && bun run --filter @mm-crypto-bot/bot typecheck && bun run --filter @mm-crypto-bot/bot typecheck:e2e && bunx eslint packages/numeric/src packages/core/src packages/exchange/src packages/backtest-tools/src apps/bot/src scripts/coverage-tools && bunx prettier --check packages/numeric packages/core packages/exchange packages/backtest-tools apps/bot scripts/coverage-tools AGENTS.md .codex/ENGINEERING-STANDARDS.md docs run-bot/config plans/full-refactor && git diff --check. Expected: PASS without reducing a gate.

- [ ] **Step 5: Run hygiene scans.** Run: rg -n --hidden -g '!node_modules' '(BYBIT_API_KEY=|BYBIT_API_SECRET=|BEGIN [A-Z ]*PRIVATE KEY)' apps packages run-bot docs scripts && rg -n 'REQUIRED_SPOT_MARGIN_LEVERAGE|only selected leverage.*exactly 10' apps packages run-bot docs AGENTS.md .codex/ENGINEERING-STANDARDS.md && rg --files apps packages | rg 'selected-leverage|leverage-sensitivity'. Expected: first two scans have no active secret or literal-10-only policy match; the file scan lists only intended modules.

- [ ] **Step 6: Independent review and final coordinator handoff.** Request an independent terra_reviewer technical review, then an independent luna_process_reviewer review. Fix every valid finding in its original slice, rerun affected gates, obtain fresh technical re-review, and only then hand complete evidence to the coordinator for the final commit decision.
