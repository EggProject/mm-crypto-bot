# Runtime Toolchain Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin local development and new release archives to Bun `1.4.2` and Node `24.21.0`, retain verification of historical release-manifest V1 archives, and move the dependency graph to Vitest and `@vitest/coverage-v8` `5.0.0` without weakening any coverage or release gate.

**Architecture:** Release manifests become a discriminated, versioned contract: V1 remains immutable and verify-only for `1.3.14`/`24.19.0`, while every new archive/set assembly is V2 with the new exact identity. A verified set deep-matches its outer identity to both inners and accepts only homogeneous V1 or V2 pairs. Vitest remains locally resolved from the frozen Bun workspace; no runner may download a package at execution time.

**Tech Stack:** Bun `1.4.2`, Node `24.21.0` through nvm locally (GitHub Actions `actions/setup-node` is the CI provisioning exception), TypeScript `6.0.3`, Turborepo `2.10.10`, Vite `8.2.1`, Vitest/`@vitest/coverage-v8` `5.0.0`.

**Spec:** Approved Bun/Node/Vitest migration brief recorded for this implementation; no repository design document is created or rewritten by this migration.

## Global Constraints

- Keep TypeScript `6.0.3`, Turborepo `2.10.10`, and Vite `8.2.1` unchanged unless a command below demonstrates a concrete compatibility error; record that error before proposing a separately scoped dependency change.
- Pin `.bun-version`, `.nvmrc`, `packageManager`, and root `engines` exactly to `1.4.2` and `24.21.0`; never use ranges, coercion, or a host-global runtime as proof.
- V1 is a historical archive compatibility contract, not a source of truth for new output. V1 verifier fixtures remain V1 and must keep accepting only `bun: "1.3.14"` and `nodeMetadata: "24.19.0"`; new assembler output is V2 and must accept only `bun: "1.4.2"` and `nodeMetadata: "24.21.0"`.
- Public archive/set verification accepts historical V1 and current V2. `assembleReleaseSetCandidate` and every new release-set assembly input are V2-only and reject V1 or mixed input before `mkdtemp`, write, smoke, or `link`.
- Historical plans, research, reports, and evidence are immutable. Do not edit `docs/superpowers/plans/2026-08-27-configurable-leverage-baseline.md`, `docs/superpowers/plans/2026-09-05-reproducible-app-releases.md`, `docs/superpowers/plans/2026-09-05-reproducible-app-releases-tasks-4-6.md`, or `docs/research/**`; add only the current `docs/runtime-toolchain.md` migration note.
- Do not manually edit `bun.lock`. Regenerate it once with Bun `1.4.2`, inspect the exact diff, then prove it with `bun install --frozen-lockfile`.
- Do not use `bunx`, `bun x`, an ambient executable, or a path that can download a runner. Every Node start goes through the injected executable protocol below with fixed argv and `shell: false`; no PATH lookup or command interpolation is permitted.
- CI keeps `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`) as the sole provisioning exception, reads `.nvmrc`, and never sources nvm. Each of its seven current job steps must immediately realpath `command -v node`, require it executable/absolute, prove it equals `realpath("$RUNNER_TOOL_CACHE")/node/24.21.0/${RUNNER_ARCH,,}/bin/node`, then persist that executable, realpathed cache root, lowercased architecture, `ci` provenance, and the exact SHA provisioner through `GITHUB_ENV`.
- No `any`, unsafe assertion, ignore/disable, coverage exclusion, relaxed threshold, source-list narrowing, test deletion, or gate removal is permitted. Preserve 100% statements, branches, functions, and lines for every owned release/unit/E2E scope.
- Every modified/new authored source, test, config, and document is post-format counted with `wc -l` and must be `<=500`; only generated `bun.lock` is exempt, while its exact diff/closure stays inspected. Split before growth (including tests), then stage every split path. Each subtask is one sequential exclusive owner and reports exact files, commands, output, counts, and blocker; workers do not stage, commit, or review their own work.
- The approved migration permits only `bun install` during stated lock regenerations (the sole dependency-fetch authority) and `bun audit --audit-level=high` (read-only advisory-network authority). Each audit must capture UTC timestamp, `bun --version`, exact command, stdout/stderr, and source label `Bun audit advisory service` under `/tmp`; unavailable service, missing evidence, or nonzero audit fails closed. Frozen installs, tests, builds, and local nvm gates make no network/system-install claim; locally every Node-backed start uses only `source /home/eggp/.nvm/nvm.sh; nvm exec 24.21.0 ...`, never a system Node install.
- `bun run verify` is still an unimplemented target-state command. Do not claim it ran; run the concrete gates listed here instead.

## Recorded Approval and Task Authority

Coordinator-supplied user instruction in this Codex session, dated `2026-09-13`: `bun -t telepitettem, node -hoz nvm-t hasznalj(rendszer telepites tiltott)! a tobbit jovahagyom`. Narrow interpretation: Bun is already installed (no Bun/system-Node install); local Node uses nvm; it authorizes this described runtime/dependency migration, read-only audit network, and exact planned lock fetch only—not publish, live action, or other network. This committed plan section is the repository evidence; no external commit is invented.

| Task | Class/I-O; owned areas (workspace packages)                               | Risk/reasoning; external/mutable resources                            |
| ---- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A0   | toolchain protocol/write; `scripts/tooling`, `scripts/release` (13)       | executable provenance/ports; local filesystem/child process only      |
| A1   | release contract/write; `scripts/release` (13)                            | V1/V2 public compatibility; local release files only                  |
| A2   | release-set architecture/write; `scripts/release` (13)                    | authenticated identity/publication effects; local fixtures/files only |
| A3   | runtime metadata/write; root, two apps, tooling/docs (13)                 | reproducibility/type lock; approved lock fetch and audit only         |
| B1   | dependency closure/write; root, five packages, tooling (13)               | supply-chain resolution/licenses; approved lock fetch and audit only  |
| B2   | runner/CI architecture/write; root, bot, package scripts, CI/tooling (13) | deterministic execution/provenance; local files and CI YAML only      |

**Authority legend for every row:** review role `non-review`; required route `terra_worker`; requested `gpt-5.6-terra`/`high`; record observed effective model/effort at dispatch or `not observable`; sandbox/write authority is this task's exact manifest only; fallback is none/block; no subagents or self-review. Each task's final evidence repeats observed effective model/effort, authority, validation, and result. After each atomic coordinator-only commit, independent `terra_reviewer` technical and `luna_process_reviewer` process reviews inspect the actual range.

## Baseline and Exact Validation Inventory

Use this preflight from the clean migration worktree before changing files. It records the only local toolchain authority and prevents a mistaken system Node invocation:

```bash
bun --version
source /home/eggp/.nvm/nvm.sh
nvm exec 24.21.0 node --version
git status --short
git diff --check
```

Expected baseline is Bun `1.4.2`, nvm-provided Node `v24.21.0`, and an empty status. The source checkout currently pins Bun `1.3.14`, Node `24.19.0`, and Vitest `4.1.10`; those are migration inputs, not desired output.

After A0 exists, every local Node-starting gate uses this workstation-only coordinator bootstrap; runtime validation itself remains generic and derives no accepted path from `/home`:

```bash
source /home/eggp/.nvm/nvm.sh
nvm exec 24.21.0 node --version
export NVM_DIR=/home/eggp/.nvm NVM_BIN="$(dirname "$(nvm which 24.21.0)")"
export MM_CRYPTO_BOT_NODE_EXECUTABLE="$(nvm which 24.21.0)" MM_CRYPTO_BOT_NODE_PROVENANCE=local
test -x "$MM_CRYPTO_BOT_NODE_EXECUTABLE"
```

The following heredoc is the immutable exact 46-path pre-A baseline. A0 then creates exactly `scripts/tooling/vitest.node-executable-protocol.unit.config.mjs` and `scripts/tooling/vitest.node-executable-protocol.e2e.config.mjs`; the frozen `vitest-list-all-configs` post-A roster is exactly those two plus this heredoc, or 48 paths.

```bash
source /home/eggp/.nvm/nvm.sh
while IFS= read -r config; do
  nvm exec 24.21.0 node ./node_modules/vitest/vitest.mjs list --config "$config"
done <<'VITEST_CONFIGS'
apps/bot/vitest.config-command.config.mjs
apps/bot/vitest.config.ts
apps/bot/vitest.lint-foundation.mjs
apps/bot/vitest.selected-leverage-config.mjs
apps/config-search/vitest.config.mjs
packages/assert/vitest.config.ts
packages/backtest-tools/vitest.arb-latency-artifact-v2-input-snapshot.config.mjs
packages/backtest-tools/vitest.arb-latency-artifact-v2-market-snapshot.config.mjs
packages/backtest-tools/vitest.arb-latency-artifact-v2-snapshot-primitives.config.mjs
packages/backtest-tools/vitest.arb-latency-artifact-v2.config.mjs
packages/backtest-tools/vitest.arb-latency-cli-arguments.config.mjs
packages/backtest-tools/vitest.arb-latency-exact-boundary.config.mjs
packages/backtest-tools/vitest.arb-latency-exact-collector.config.mjs
packages/backtest-tools/vitest.arb-latency-exact.config.mjs
packages/backtest-tools/vitest.arb-latency-output-contract.config.mjs
packages/backtest-tools/vitest.ccxt-package-provenance.config.mjs
packages/backtest-tools/vitest.ccxt-provenance.config.mjs
packages/backtest-tools/vitest.config.ts
packages/backtest-tools/vitest.dydx-r3.config.mjs
packages/backtest/vitest.config.ts
packages/core/vitest.config.ts
packages/core/vitest.dydx-cex-carry.config.mjs
packages/core/vitest.portfolio-orchestrator.config.mjs
packages/core/vitest.strategy-absence-s1.config.mjs
packages/core/vitest.task4a.config.mjs
packages/exchange/vitest.bybit-eu-adapter.config.mjs
packages/exchange/vitest.config.ts
packages/exchange/vitest.latency-monitor.e2e.config.mjs
packages/exchange/vitest.latency-monitor.unit.config.mjs
packages/exchange/vitest.mock-feed.config.mjs
packages/logging/vitest.config.ts
packages/logging/vitest.e2e.config.ts
packages/numeric/vitest.config.ts
packages/paper/vitest.config.ts
packages/shared/vitest.config.ts
packages/typeguard/vitest.config.ts
packages/typing/vitest.config.ts
scripts/coverage-tools/vitest.bot-e2e-boundaries.config.mjs
scripts/coverage-tools/vitest.bot-e2e-preload.config.mjs
scripts/coverage-tools/vitest.bot-runtime-network-guard.config.mjs
scripts/coverage-tools/vitest.bot-runtime-scope.config.mjs
scripts/release/vitest.config.ts
scripts/release/vitest.e2e.config.ts
scripts/tooling/vitest.pre-commit.config.mjs
scripts/tooling/vitest.verify-foundation.config.mjs
scripts/tooling/vitest.zero-legacy.config.mjs
VITEST_CONFIGS
```

Before either commit, preserve this complete tracked static-start inventory; classify every hit. The mutable runner paths are the exact Phase A/B ownership below. `release-assembler.ts`, `release-assembler.test-support.ts`, `release-ports.ts`, `bot-runtime-network-guard.test.ts`, and `zero-legacy-*.test.ts` contain metadata, diagnostics, or fixture identifiers only—not a process start—and remain unchanged.

```bash
git ls-files -z -- package.json 'apps/*/package.json' 'packages/*/package.json' scripts .github/workflows/ci.yml | xargs -0 rg -n 'bunx|bun x|vitest run|(^|[^[:alnum:]_])node([[:space:]]|$)|node_modules/vitest/vitest\.mjs'
```

The runner-bearing mutable paths are `package.json`, `apps/bot/package.json`, `packages/assert/package.json`, `packages/backtest-tools/package.json`, `packages/backtest/package.json`, `packages/exchange/package.json`, `packages/logging/package.json`, `packages/numeric/package.json`, `packages/paper/package.json`, `packages/shared/package.json`, `packages/typeguard/package.json`, `packages/typing/package.json`, `.github/workflows/ci.yml`, `scripts/coverage-full.sh`, `scripts/coverage-gates.test.sh`, `scripts/coverage-tools/run-bot-unit-coverage.ts`, `scripts/install-no-warnings.sh`, all four `scripts/release/release-coverage*` paths, and `scripts/tooling/verify-foundation.test.ts`. Retain `bun` only where it is proven behavior-only (the install JSON check becomes `bun --eval`); it must not start Node or Vitest.

## Sealed NodeGate Contract

`VitestGate` is exactly: `release-coverage-unit|release-coverage-e2e|node-executable-protocol-unit|node-executable-protocol-e2e|vitest-list-all-configs|bot-config-command-coverage|bot-e2e-preload-coverage|bot-runtime-scope-coverage|bot-unit-scope|bot-unit-coverage|assert-test|assert-coverage|backtest-tools-dydx-r3-coverage|backtest-coverage|exchange-bybit-eu-adapter-coverage|logging-test|logging-coverage|numeric-test|numeric-coverage|paper-coverage|shared-test|shared-coverage|typeguard-test|typeguard-coverage|typing-test|typing-coverage|ci-foundation-coverage|ci-test-junit|coverage-full-test`; `NodeGate` additionally includes `staged-eslint|staged-prettier`. The protocol accepts only `bun scripts/tooling/node-executable-protocol.ts --gate=<one exact NodeGate>`; no config, cwd, executable, or additional argv option exists. It realpaths the injected executable before `--version` and before the sole `spawn(executable, argv, { shell: false })`. Its local branch requires own absolute-string `NVM_DIR`, `NVM_BIN`, and executable inputs; `realpath(executable)` must equal `realpath(NVM_DIR)/versions/node/v24.21.0/bin/node`, `NVM_BIN` must equal that bin directory, and `--version` must equal `v24.21.0`, rejecting missing/relative/mismatch or same-version system Node. Tests include every rejection and a synthetic non-`/home` NVM-root real-child PASS; CI alone uses the tool-cache exception.

Every Vitest mapping uses `repoRoot/node_modules/vitest/vitest.mjs`, `run`, `--config`, and the stated config; `vitest-list-all-configs` uses `list --config` for the closed post-A 48-roster, and no caller supplies a path. `release-coverage-unit|e2e` use root `scripts/release/vitest.config.ts|vitest.e2e.config.ts --coverage`; `node-executable-protocol-unit|e2e` use root `scripts/tooling/vitest.node-executable-protocol.unit.config.mjs|vitest.node-executable-protocol.e2e.config.mjs --coverage`; bot config/preload/scope use root CWD and respectively `apps/bot/vitest.config-command.config.mjs`, `scripts/coverage-tools/vitest.bot-e2e-preload.config.mjs`, `scripts/coverage-tools/vitest.bot-runtime-scope.config.mjs`, each `--coverage`; bot-unit-scope runs absolute `scripts/coverage-tools/verify-bot-runtime-scope.ts` from root and bot-unit-coverage then runs `apps/bot/vitest.config.ts --coverage --coverage.reportsDirectory=<absolute apps/bot/coverage/unit>` from root. `staged-eslint` is root-CWD `repoRoot/node_modules/eslint/bin/eslint.js --config eslint.config.js --max-warnings=0 -- <validated paths>`; `staged-prettier` is `repoRoot/node_modules/prettier/bin/prettier.cjs --check --ignore-unknown -- <validated paths>`; only the validator supplies paths after literal `--`.

Package script forms are fixed `bun ../../scripts/tooling/node-executable-protocol.ts --gate=<member>` (bot first `cd ../..`; package CWD otherwise): assert/logging/numeric/shared/typeguard/typing `test` use their `*-test` gate and `coverage|coverage:unit|coverage:text|coverage:lcov` their `*-coverage` gate, all with `vitest.config.ts` (logging retains its Bun E2E half); paper coverage aliases use `paper-coverage`; backtest coverage aliases retain the existing echo then `backtest-coverage`; backtest-tools `coverage:dydx-r3` uses `vitest.dydx-r3.config.mjs` without coverage; exchange `coverage:bybit-eu-adapter` uses `vitest.bybit-eu-adapter.config.mjs --coverage`.

Root `coverage:bot:e2e-preload` and `coverage:scope` retain their preceding Bun-only verifier work then call their stated gates; `coverage-full.sh` calls `coverage-full-test`, and CI's foundation call uses `ci-foundation-coverage`. `ci-test-junit` and `coverage-full-test` run absolute `repoRoot/node_modules/turbo/bin/turbo`, respectively `run test -- --reporter=junit --reporter-outfile=./junit.xml` and `run test --force`, from root. The protocol test table asserts this entire union/map, fixed argv/CWD/flags, rejection of every unknown gate, and the static scanner rejects every bypass in the 17 production paths.

The frozen `nodeGateManifest` contains every `VitestGate`, `staged-eslint|staged-prettier`, and every current Node-backed Turbo, TypeScript, ESLint, and Prettier start: root `build|dev|typecheck|test|typecheck:coverage-tools|lint|format|format:check|lint:hook|format:hook`; bot `typecheck|typecheck:e2e|lint`; config-search `typecheck|lint`; and every `tsc|eslint|vitest` script in each of the eleven package manifests. `type NodeGate = keyof typeof nodeGateManifest`; each literal record fixes absolute tool module, argv, and CWD. B2 changes root `lint:hook|format:hook` and their public pre-commit consumers to call `validateStagedFiles(environment)`, which alone invokes their named staged gates; the scanner rejects ambient PATH/process starts and every bypass. B2's contract test audits root plus all 13 workspace manifests and CI, proves every Node-backed start is a declared key, and preserves Bun-native `bun test`, `bun build`, and echo-only commands.

## Commit A — Versioned Release Contract and Runtime Pins

Create one dependency-closed atomic commit only after Tasks A0–A3 are green. It contains no Vitest dependency change; its `bun.lock` delta may contain only Bun `1.4.2` type-resolution consequences of root `bun-types` and the two application `@types/bun` pins.

### Task A0: Create the verified Node protocol before release gates

**Owner:** `terra_worker`; exclusive fifteen-path protocol/release-coverage handoff; maximum 500 logical changed lines.

**Files:** create `scripts/tooling/node-executable-protocol.ts`, `scripts/tooling/node-executable-protocol.test.ts`, `scripts/tooling/node-executable-protocol.e2e.test.ts`, `scripts/tooling/vitest.node-executable-protocol.unit.config.mjs`, `scripts/tooling/vitest.node-executable-protocol.e2e.config.mjs`, `scripts/release/release-coverage-node-gate.ts`, and `scripts/release/release-coverage-node-gate.test.ts`; modify `scripts/tooling/staged-file-validation.ts`, `scripts/tooling/staged-file-validation.test.ts`, `scripts/release/release-coverage.ts`, `scripts/release/release-coverage.test.ts`, `scripts/release/release-coverage-node-adapter.e2e.test.ts`, `scripts/release/release-coverage-validation.e2e.test.ts`, `scripts/release/vitest.config.ts`, and `scripts/release/vitest.e2e.config.ts`.

- [ ] **Step 1: RED then GREEN.** Export `runVerifiedNodeGate(environment, gate)` and main-only `--gate=<NodeGate>`; its only launch is `spawn(executable, fixedArgv, { shell: false })`. Export `validateStagedFiles(environment)` from `staged-file-validation.ts` as its only non-CLI consumer: snapshot Git's staged names with `git diff --cached --name-only -z`, validate repository-relative paths, then invoke only internal `Readonly<{ tag: "staged-eslint" | "staged-prettier"; paths: readonly string[] }>` gates. The fixed root-CWD modules/prefixes are `node_modules/eslint/bin/eslint.js --config eslint.config.js --max-warnings=0 --` and `node_modules/prettier/bin/prettier.cjs --check --ignore-unknown --`; append each dynamic path only after literal `--`. Reject empty/NUL/absolute/`..`/outside-repository/leading-`-` paths and any caller executable/config/CWD; use no PATH lookup. Split the current 481/498-line release source/test before growth. Test sealed maps/unknown rejection; missing/relative NVM inputs, NVM/bin/executable mismatch, system same-version rejection, synthetic non-`/home` NVM real-child PASS, and CI cache/version failures. Include `release-coverage-node-gate.ts` in both release source unions and JSON+LCOV validators; release and protocol unit/genuine-E2E scopes each reach honest 100% S/B/F/L (no exclusions, E2E unit imports, global monkeypatches, or fake branches). RED then GREEN: `bun test scripts/tooling/node-executable-protocol.test.ts scripts/tooling/staged-file-validation.test.ts scripts/tooling/node-executable-protocol.e2e.test.ts scripts/release/release-coverage-node-gate.test.ts scripts/release/release-coverage.test.ts scripts/release/release-coverage-node-adapter.e2e.test.ts scripts/release/release-coverage-validation.e2e.test.ts`; then `bun scripts/tooling/node-executable-protocol.ts --gate=node-executable-protocol-unit`, `--gate=node-executable-protocol-e2e`, and both release coverage gates.

  The unit `test.include` is exactly `["scripts/tooling/node-executable-protocol.test.ts", "scripts/tooling/staged-file-validation.test.ts"]`; E2E is exactly `["scripts/tooling/node-executable-protocol.e2e.test.ts"]`. Both use Node, `pool: "forks"`, `minWorkers: 1`, `maxWorkers: 1`, V8, `coverage.include` exactly `["scripts/tooling/node-executable-protocol.ts", "scripts/tooling/staged-file-validation.ts"]`, `coverage.exclude: []`, text/json-summary/lcov reporters, per-file S/B/F/L `100`, and distinct `/tmp/mm-node-protocol-unit` or `/tmp/mm-node-protocol-e2e` report directories. JSON+LCOV validation requires exactly those two positive/full source records. The E2E invokes only public `validateStagedFiles` plus protocol CLI, creates a temporary Git clone or alternate index, crosses real Git and a verified Node child, and never touches the main index, imports unit tests, substitutes in-process behavior, mocks, patches globals, or fabricates branches.

  A0 also fixes `scripts/release/vitest.e2e.config.ts` `test.include` to exactly `release-assembler.e2e.test.ts|release-smoke.e2e.test.ts|release-private-candidate-reproducibility.e2e.test.ts|release-set.e2e.test.ts|release-set-archive.e2e.test.ts|release-set-publication-workflow.e2e.test.ts|release-set-v2-publication.e2e.test.ts|release-coverage-validation.e2e.test.ts|release-coverage-node-adapter.e2e.test.ts`; A2 creates the prelisted V2 file. Its JSON/LCOV validator asserts this union executed and the exact source union `release-assembler.ts|release-smoke.ts|release-private-candidate-reproducibility.ts|release-set-contract.ts|release-set-zip.ts|release-set-assembler.ts|release-set-verifier.ts|release-set-publication.ts|release-set-reproducibility.ts|release-ports.ts|release-coverage.ts|release-coverage-node-gate.ts|release-artifact-verifier.ts|verify.ts` has positive 100% S/B/F/L records.

**Trust boundary:** CI strings alone are not authentication: the pinned setup-node cache path plus port equality/version/executability is runner provenance, not cryptographic attestation. **Handoff:** B2 may change no A0 file; all later Node consumers import this tested protocol.

### Task A1: Make the inner release contract explicitly V1-or-V2

**Owner:** `terra_worker` implementation owner; exclusive `scripts/release` inner-contract files below; maximum 500 logical changed lines.

**Files:** modify `scripts/release/release-contract.ts`, `scripts/release/release-assembler.ts`, `scripts/release/release-verifier.ts`, `scripts/release/release-smoke.ts`, `scripts/release/release-contract.test.ts`, `scripts/release/release-assembler.test-support.ts`, `scripts/release/release-assembler.test.ts`, `scripts/release/release-assembler.e2e.test.ts`, `scripts/release/release-verifier.test.ts`, `scripts/release/release-smoke.test.ts`; create `scripts/release/release-assembler-v2.test.ts`.

**Interfaces:**

```ts
export const legacyRequiredBunVersion = "1.3.14" as const;
export const legacyRequiredNodeMetadataVersion = "24.19.0" as const;
export const requiredBunVersion = "1.4.2" as const;
export const requiredNodeMetadataVersion = "24.21.0" as const;
export type ReleaseManifest = ReleaseManifestV1 | ReleaseManifestV2;
export interface ReleaseManifestV2 extends ReleaseManifestBase {
  readonly schema: "mm-crypto-bot.release-manifest/v2";
  readonly toolchain: { readonly bun: "1.4.2"; readonly nodeMetadata: "24.21.0" };
}
export function verifyReleaseArchive(input: ReleaseVerificationInput): Promise<ReleaseManifest>;
export function assembleRelease(
  dependencies: ReleaseDependencies,
  app: ReleaseApplication,
): Promise<Readonly<{ candidate: ReleasePrivateCandidate; manifest: ReleaseManifestV2 }>>;
```

- [ ] **Step 1: Write focused RED tests.** First move new V2 cases into `release-assembler-v2.test.ts` because `release-assembler.test.ts` is already 500 lines. Keep V1 fixtures semantically V1; prove new assembly writes only V2/exact strings and V1 verification returns V1. Add negatives for V1 labelled V2, V2 carrying old versions, and unknown/mixed schema/toolchain fields.

- [ ] **Step 2: Run the RED release-contract checks.**

```bash
bun test scripts/release/release-contract.test.ts scripts/release/release-assembler.test.ts scripts/release/release-assembler-v2.test.ts scripts/release/release-verifier.test.ts scripts/release/release-smoke.test.ts
```

Expected: FAIL because V2 is not represented and assembly still emits V1.

- [ ] **Step 3: Implement the smallest discriminated contract.** Extract shared immutable payload/target/configuration shape once; retain an exact V1 parser and add an exact V2 parser selected only by `schema`. Keep the verifier independent from writer logic. Make root pin checks and raw CLI checks apply only to new V2 assembly; never reinterpret a verified V1 archive using current runtime pins.

- [ ] **Step 4: Run the GREEN inner release checks.**

```bash
bun test scripts/release/release-contract.test.ts scripts/release/release-assembler.test.ts scripts/release/release-assembler-v2.test.ts scripts/release/release-assembler.e2e.test.ts scripts/release/release-verifier.test.ts scripts/release/release-smoke.test.ts
```

Expected: PASS; both V1 verification and V2 assembly cases pass with no coverage scope change.

### Task A2: Preserve release-set verification while emitting current V2 sets

**Owner:** `terra_worker` implementation owner; exclusive release-set compatibility files below; maximum 500 logical changed lines.

**Files:** modify `scripts/release/release-set-contract.ts`, `scripts/release/release-set-assembler.ts`, `scripts/release/release-set-reproducibility.ts`, `scripts/release/release-set-verifier.ts`, `scripts/release/release-artifact-verifier.ts`, `scripts/release/release-set-zip.ts`, `scripts/release/release-set-contract.test.ts`, `scripts/release/release-set-assembler.test.ts`, `scripts/release/release-set-reproducibility.test.ts`, `scripts/release/release-set-verifier.test.ts`, `scripts/release/release-set-zip.test.ts`, `scripts/release/release-set.e2e.test.ts`, `scripts/release/release-set-archive.e2e.test.ts`, `scripts/release/release-set-publication.test.ts`, `scripts/release/release-set-publication-workflow.e2e.test.ts`, `scripts/release/release-artifact-verifier.test.ts`; create `scripts/release/release-set-v2-publication.e2e.test.ts`.

**Interfaces:**

```ts
export type ReleaseSetInput = Readonly<{
  application: ReleaseApplication;
  innerManifest: ReleaseManifestV2;
  sidecarBytes: Uint8Array;
  zipBytes: Uint8Array;
}>;
export type ReleaseSetManifestBase = Readonly<{
  applications: readonly [ReleaseSetAppRecord<"bot">, ReleaseSetAppRecord<"config-search">];
  commit: string;
  lockfileSha256: string;
  sourceDateEpoch: number;
  version: "0.1.0";
}>;
export type ReleaseSetManifestV1 = ReleaseSetManifestBase &
  Readonly<{
    schema: "mm-crypto-bot.release-set-manifest/v1";
    target: ReleaseManifestV1["target"];
    toolchain: { readonly bun: "1.3.14"; readonly nodeMetadata: "24.19.0" };
  }>;
export type ReleaseSetManifestV2 = ReleaseSetManifestBase &
  Readonly<{
    schema: "mm-crypto-bot.release-set-manifest/v2";
    target: ReleaseManifestV2["target"];
    toolchain: { readonly bun: "1.4.2"; readonly nodeMetadata: "24.21.0" };
  }>;
export type ReleaseSetManifest = ReleaseSetManifestV1 | ReleaseSetManifestV2;
export type ManifestGeneration = "v1" | "v2";
export type ParsedReleaseSetManifest = Readonly<{
  manifest: ReleaseSetManifest;
  manifestGeneration: ManifestGeneration;
}>;
export function verifyPublishedReleaseSet(input: ReleaseSetVerificationInput): Promise<ReleaseSetManifest>;
```

- [ ] **Step 1: Write RED compatibility cases.** Compile-time public API tests prove `verifyPublishedReleaseSet` in `release-artifact-verifier.ts` returns only outer `ReleaseSetManifest`, while `verifyReleaseArchive` returns only inner `ReleaseManifest`; runtime tests cover V1, V2, unknown schema, outer-V1/inner-V2, and outer-V2/inner-V1 in both pair orders. Add V2 assembly/emission in `release-set-zip.ts`, its unit/E2E coverage and API tests, and V1/mixed pre-effect rejection cases. Put new publication V2 cases in `release-set-v2-publication.e2e.test.ts` before touching the 495-line workflow test. Mutate outer target/toolchain/version/commit/lock/source epoch or either inner identity; every mismatch fails closed before effects.

- [ ] **Step 2: Run the RED release-set checks.**

```bash
bun test scripts/release/release-set-contract.test.ts scripts/release/release-set-assembler.test.ts scripts/release/release-set-reproducibility.test.ts scripts/release/release-set-verifier.test.ts scripts/release/release-set-zip.test.ts scripts/release/release-set.e2e.test.ts scripts/release/release-set-archive.e2e.test.ts scripts/release/release-set-publication.test.ts scripts/release/release-set-publication-workflow.e2e.test.ts scripts/release/release-set-v2-publication.e2e.test.ts scripts/release/release-artifact-verifier.test.ts
```

Expected: FAIL because the release-set contract accepts only `ReleaseManifestV1`.

- [ ] **Step 3: Implement verify-only V1 preservation.** Independently parse `mm-crypto-bot.release-set-manifest/v1|v2` and `mm-crypto-bot.release-manifest/v1|v2` into immutable `manifestGeneration: "v1"|"v2"`; never raw-compare their different schema strings. `verifyPublishedReleaseSet` in `release-artifact-verifier.ts` returns outer V1/V2 `ReleaseSetManifest`; `verifyReleaseArchive` returns inner `ReleaseManifest`; exact generations/toolchains cannot cross. `release-set-zip.ts` emits only the V2 outer manifest. Set verification compares generation, target, toolchain, version, commit, lockfile SHA, source epoch, and both authenticated inner identities; `release-set-reproducibility.ts` narrows V2 before V2-only assembly, which rejects V1/mixed before effects. Preserve layout/publication/sidecar contracts.

- [ ] **Step 4: Run the GREEN release-set checks.** Re-run the command from Step 2. Expected: PASS, including V1 verifier compatibility and V1/mixed assembly rejection before any temporary-directory, write, smoke, or `link` call.

### Task A3: Pin release creation and Bun type metadata to the new runtime without rewriting history

**Owner:** `terra_worker` implementation owner; exclusive pin/documentation files below; maximum 300 logical changed lines.

**Files:** modify `.bun-version`, `.nvmrc`, `package.json`, `apps/bot/package.json`, `apps/config-search/package.json`, `bun.lock`, and `scripts/tooling/toolchain-contract.test.ts`; create `docs/runtime-toolchain.md`.

- [ ] **Step 1: Write RED pin and documentation assertions.** Update `toolchain-contract.test.ts` to require exact root `engines.bun`, `engines.node`, `packageManager`, and `bun-types: "1.4.2"`; require both app `@types/bun: "1.4.2"`; and confirm the existing CI exception retains the exact setup-node v7 SHA with `.nvmrc` without changing CI in this commit. Add the current document with dated supersession, V1/V2 rules, local nvm, CI exception, rollback, and immutable-history prohibition.

- [ ] **Step 2: Demonstrate the RED frozen-install mismatch.** Change only root runtime metadata, root `bun-types`, both application `@types/bun` entries, `.bun-version`, and `.nvmrc`, then run:

```bash
if bun install --frozen-lockfile; then phase_a_frozen_status=0; else phase_a_frozen_status=$?; fi
printf 'phase_a_frozen_status=%s\n' "$phase_a_frozen_status" | tee /tmp/mm-runtime-toolchain-phase-a-red-frozen-status.txt
if test "$phase_a_frozen_status" -eq 0; then printf '%s\n' 'expected frozen-install mismatch did not occur' >&2; exit 1; fi
bun pm licenses --json > /tmp/mm-runtime-toolchain-licenses-phase-a.json
cat /tmp/mm-runtime-toolchain-licenses-phase-a.json
bun --eval 'const raw = await Bun.file("/tmp/mm-runtime-toolchain-licenses-phase-a.json").text(); const value: unknown = JSON.parse(raw); if (raw.trim().length === 0 || typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length === 0 || Object.keys(value).some((license) => /^(unknown|unlicensed)$/iu.test(license))) throw new Error("missing, empty, unknown, or unlicensed license inventory");'
```

Expected: the recorded `phase_a_frozen_status` is nonzero because the prior lock cannot satisfy the exact Bun type pins; later license commands cannot mask it. Do not suppress the failure or edit `bun.lock` manually.

- [ ] **Step 3: Regenerate the Phase A lock with the exact runtime.** Verify `bun --version` prints exactly `1.4.2`, then run:

```bash
bun install
git diff -- bun.lock package.json apps/bot/package.json apps/config-search/package.json .bun-version .nvmrc
bun install --frozen-lockfile
audit_file=/tmp/mm-runtime-toolchain-audit-phase-a.txt; audit_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; printf 'timestamp=%s\nbun=%s\nsource=Bun audit advisory service\ncommand=bun audit --audit-level=high\n' "$audit_timestamp" "$(bun --version)" > "$audit_file"; if bash -o pipefail -c 'bun audit --audit-level=high 2>&1 | tee -a "$1"' bash "$audit_file"; then audit_status=0; else audit_status=$?; fi; printf 'status=%s\n' "$audit_status" >> "$audit_file"; test "$audit_status" -eq 0
```

Expected: Bun regenerates `bun.lock`; the inspected lock delta is limited to Bun type-resolution consequences of the three exact Bun type pins, frozen installation passes, audit exits zero for high/critical findings, and the captured/reviewed JSON is nonempty with no `unknown` or `unlicensed` license bucket. Do not modify `.github/workflows/ci.yml` in Phase A.

- [ ] **Step 4: Run the GREEN Phase A gate set.**

```bash
bun test scripts/tooling/toolchain-contract.test.ts
bun --eval 'const text = await Bun.file("/tmp/mm-runtime-toolchain-audit-phase-a.txt").text(); if (!text.split(/\r?\n/u).includes("status=0")) throw new Error("audit status evidence is not zero");'
cat /tmp/mm-runtime-toolchain-audit-phase-a.txt
bun pm licenses --json > /tmp/mm-runtime-toolchain-licenses-phase-a-final.json
cat /tmp/mm-runtime-toolchain-licenses-phase-a-final.json
bun run coverage:release:unit
bun run coverage:release:e2e
bun run hook:validate
git diff --check
```

Expected: PASS with 100% release unit and E2E S/B/F/L output, frozen-install/audit/license evidence, and no historical documentation diff.

- [ ] **Step 5: Commit Phase A exactly.** Let `phase_a_base` be the pre-commit `HEAD`; post-format count every listed authored path (`wc -l`, each `<=500`; generated `bun.lock` excepted), then stage only these exact 51 paths from Tasks A0–A3:

```bash
git add .bun-version .nvmrc package.json apps/bot/package.json apps/config-search/package.json bun.lock scripts/tooling/toolchain-contract.test.ts scripts/tooling/node-executable-protocol.ts scripts/tooling/node-executable-protocol.test.ts scripts/tooling/node-executable-protocol.e2e.test.ts scripts/tooling/staged-file-validation.ts scripts/tooling/staged-file-validation.test.ts scripts/tooling/vitest.node-executable-protocol.unit.config.mjs scripts/tooling/vitest.node-executable-protocol.e2e.config.mjs docs/runtime-toolchain.md scripts/release/release-coverage.ts scripts/release/release-coverage-node-gate.ts scripts/release/release-coverage.test.ts scripts/release/release-coverage-node-gate.test.ts scripts/release/release-coverage-node-adapter.e2e.test.ts scripts/release/release-coverage-validation.e2e.test.ts scripts/release/vitest.config.ts scripts/release/vitest.e2e.config.ts scripts/release/release-contract.ts scripts/release/release-assembler.ts scripts/release/release-verifier.ts scripts/release/release-smoke.ts scripts/release/release-contract.test.ts scripts/release/release-assembler.test-support.ts scripts/release/release-assembler.test.ts scripts/release/release-assembler-v2.test.ts scripts/release/release-assembler.e2e.test.ts scripts/release/release-verifier.test.ts scripts/release/release-smoke.test.ts scripts/release/release-set-contract.ts scripts/release/release-set-assembler.ts scripts/release/release-set-reproducibility.ts scripts/release/release-set-verifier.ts scripts/release/release-artifact-verifier.ts scripts/release/release-set-zip.ts scripts/release/release-set-contract.test.ts scripts/release/release-set-assembler.test.ts scripts/release/release-set-reproducibility.test.ts scripts/release/release-set-verifier.test.ts scripts/release/release-set-zip.test.ts scripts/release/release-set.e2e.test.ts scripts/release/release-set-archive.e2e.test.ts scripts/release/release-set-publication.test.ts scripts/release/release-set-publication-workflow.e2e.test.ts scripts/release/release-set-v2-publication.e2e.test.ts scripts/release/release-artifact-verifier.test.ts
git diff --cached --check
LEFTHOOK_BIN="$PWD/node_modules/.bin/lefthook"
test -x "$LEFTHOOK_BIN"
"$LEFTHOOK_BIN" run pre-commit
env LEFTHOOK_BIN="$PWD/node_modules/.bin/lefthook" git commit -m "chore(release): version runtime manifest contract"
```

Record the manual `"$LEFTHOOK_BIN" run pre-commit` PASS separately from the normal commit's automatic Lefthook stdout/exit; the coordinator alone performs both.

- [ ] **Step 6: Obtain independent actual-diff reviews.** A `terra_reviewer` reviews `phase_a_base..HEAD` for V1/V2 parsing, archive compatibility, release-set homogeneity, and safety. A `luna_process_reviewer` separately reviews the same actual range for ownership, TDD evidence, exact staging, documentation immutability, and gate preservation. Record both results; any valid finding requires a smallest follow-up commit and fresh independent review of the full `phase_a_base..HEAD` range.

## Commit B — Vitest 5 Dependency Closure and Local Runner Determinism

Start only after Commit A and both reviews pass. The final exact commit includes Task B1 and B2; no unrelated package, configuration, source, or historic evidence may enter it.

### Task B1: Regenerate the exact Vitest 5 dependency graph

**Owner:** `terra_worker` implementation owner; exclusive dependency and supply-chain gate files below; maximum 500 logical changed lines excluding generated lockfile entries.

**Files:**

- Modify: `package.json`
- Modify: `packages/assert/package.json`
- Modify: `packages/logging/package.json`
- Modify: `packages/numeric/package.json`
- Modify: `packages/typeguard/package.json`
- Modify: `packages/typing/package.json`
- Modify: `bun.lock`
- Modify: `scripts/tooling/toolchain-contract.test.ts`
- Create: `scripts/tooling/verify-third-party-licenses.ts`
- Create: `scripts/tooling/verify-third-party-licenses.test.ts`

- [ ] **Step 1: Write RED pin and supply-chain gate tests.** Extend `scripts/tooling/toolchain-contract.test.ts` (handoff from Commit A is recorded before this task) to parse the six named manifests and require every direct `vitest` and `@vitest/coverage-v8` declaration to be the exact string `"5.0.0"`, with no range or duplicate direct declaration. Require root scripts `audit` to equal `bun audit --audit-level=high` and `licenses:check` to equal `bun scripts/tooling/verify-third-party-licenses.ts`. Create `verify-third-party-licenses.test.ts` first: it must fail for a subprocess nonzero exit, missing/empty/non-JSON output, an empty grouped record, `unknown` or `unlicensed` bucket names (case-insensitive), or an empty bucket; it must pass a nonempty record grouped by known SPDX keys without inventing an allowlist.

- [ ] **Step 2: Demonstrate the RED frozen-install mismatch.** Change only the six manifest declarations, then run:

```bash
bun install --frozen-lockfile
```

Expected: nonzero because the old lock cannot satisfy the changed exact manifest; do not suppress the failure or edit `bun.lock` manually.

- [ ] **Step 3: Regenerate once with the pinned Bun executable.** Verify `bun --version` prints exactly `1.4.2`, then run:

```bash
bun install
bun pm ls --all
audit_file=/tmp/mm-runtime-toolchain-audit-phase-b.txt; audit_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; printf 'timestamp=%s\nbun=%s\nsource=Bun audit advisory service\ncommand=bun audit --audit-level=high\n' "$audit_timestamp" "$(bun --version)" > "$audit_file"; if bash -o pipefail -c 'bun audit --audit-level=high 2>&1 | tee -a "$1"' bash "$audit_file"; then audit_status=0; else audit_status=$?; fi; printf 'status=%s\n' "$audit_status" >> "$audit_file"; test "$audit_status" -eq 0
```

Expected: `bun.lock` is regenerated by Bun and the resolved graph contains `vitest@5.0.0` and `@vitest/coverage-v8@5.0.0`; do not change TypeScript, Turbo, or Vite absent a recorded incompatibility.

- [ ] **Step 4: Implement the deterministic license gate.** Add the two exact root scripts from Step 1. `verify-third-party-licenses.ts` runs exactly `bun pm licenses --json`, requires a zero exit and nonempty valid JSON plain record, requires every grouped SPDX key to have a nonempty array bucket, rejects `unknown` and `unlicensed` keys case-insensitively, then prints a deterministic sorted grouped summary to stdout. It must not maintain or infer a license allowlist. Its test injects the command result; no live package-manager call occurs in unit tests.

- [ ] **Step 5: Run the GREEN closure checks.**

```bash
bun install --frozen-lockfile
bun test scripts/tooling/toolchain-contract.test.ts
bun test scripts/tooling/verify-third-party-licenses.test.ts
bun --eval 'const text = await Bun.file("/tmp/mm-runtime-toolchain-audit-phase-b.txt").text(); if (!text.split(/\r?\n/u).includes("status=0")) throw new Error("audit status evidence is not zero");'
cat /tmp/mm-runtime-toolchain-audit-phase-b.txt
bun run licenses:check
git diff -- bun.lock package.json packages/assert/package.json packages/logging/package.json packages/numeric/package.json packages/typeguard/package.json packages/typing/package.json scripts/tooling/toolchain-contract.test.ts scripts/tooling/verify-third-party-licenses.ts scripts/tooling/verify-third-party-licenses.test.ts
```

Expected: frozen installation, exact-pin assertions, high/critical audit, and deterministic license gate PASS; the gate prints the nonempty grouped SPDX inventory for review and fails closed on missing/empty/unknown/unlicensed buckets. The lock diff contains only dependency resolution consequences of the six exact manifest updates.

- [ ] **Step 6: Prove all configs after the dependency update.** Run the post-A0 local bootstrap above, then `bun scripts/tooling/node-executable-protocol.ts --gate=vitest-list-all-configs`. Its closed roster is exactly 48 paths. Expected: every configuration loads under verified Node `24.21.0`; otherwise stop under the compatibility blocker.

### Task B2: Remove downloading/ambient Vitest launch paths and prove all configs load

**Owner:** `terra_worker` implementation owner; exclusive local-runner files below; maximum 500 logical changed lines.

**Files:**

- Modify: `package.json`
- Modify: `apps/bot/package.json`
- Modify: `apps/config-search/package.json`
- Modify: `packages/assert/package.json`
- Modify: `packages/backtest-tools/package.json`
- Modify: `packages/backtest/package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/exchange/package.json`
- Modify: `packages/logging/package.json`
- Modify: `packages/numeric/package.json`
- Modify: `packages/paper/package.json`
- Modify: `packages/shared/package.json`
- Modify: `packages/typeguard/package.json`
- Modify: `packages/typing/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/coverage-full.sh`
- Modify: `scripts/coverage-gates.test.sh`
- Modify: `scripts/coverage-tools/run-bot-unit-coverage.ts`
- Modify: `scripts/install-no-warnings.sh`
- Modify: `scripts/tooling/verify-foundation.test.ts`
- Modify: `scripts/tooling/toolchain-contract.test.ts`

**Required behaviour:** Consume the A0 `runVerifiedNodeGate` port only; do not modify its fifteen paths. The sealed union/map above is the complete consumer contract. After each of the seven pinned setup-node steps, add this exact bash step before frozen install; CI never sources nvm:

```bash
node_executable="$(realpath "$(command -v node)")"; cache_root="$(realpath "$RUNNER_TOOL_CACHE")"; cache_arch="$(printf %s "$RUNNER_ARCH" | tr '[:upper:]' '[:lower:]')"; expected="$cache_root/node/24.21.0/$cache_arch/bin/node"
test -x "$node_executable" && test "$node_executable" = "$expected"
printf 'MM_CRYPTO_BOT_NODE_EXECUTABLE=%s\nMM_CRYPTO_BOT_NODE_PROVENANCE=ci\nMM_CRYPTO_BOT_NODE_PROVISIONER=actions/setup-node@820762786026740c76f36085b0efc47a31fe5020\nMM_CRYPTO_BOT_NODE_TOOL_CACHE_ROOT=%s\nMM_CRYPTO_BOT_NODE_TOOL_CACHE_ARCH=%s\n' "$node_executable" "$cache_root" "$cache_arch" >> "$GITHUB_ENV"
```

Pin every `uses:` to SHA with adjacent version comment: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0`, `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`, `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1`, and `dorny/test-reporter@894765a932a426ee30919ffd3b5fd3b53c0e26b8 # v2.2.0`; contract tests reject mutable tags. Official tag sources: [checkout](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0), [setup-bun](https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0), [upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.1), [test-reporter](https://github.com/dorny/test-reporter/releases/tag/v2.2.0).

**Consumers and handoff:** Root coverage scripts, bot, backtest/backtest-tools, exchange, paper, shared, `run-bot-unit-coverage.ts`, CI foundation/test, and the post-A 48-list gate call the port only; `release-coverage.ts` already does from A0. No PATH lookup, eval, shell string, downloader, arbitrary executable/config, or ambient Vitest remains. CI retains jobs and runs frozen install → audit → licenses without removing a check. `package.json` and `toolchain-contract.test.ts` deliberately change in both commits: B1 pins/locks, then B2 migrates consumers/scans; the same sequential Terra owner validates each handoff.

- [ ] **Step 1: Write RED local-runner and CI enforcement tests.** `node-executable-protocol.test.ts` asserts every sealed map/argv/CWD/flag and unknown rejection; CI rejects missing/nonabsolute/nonexecutable cache root/executable, bad architecture/version, or same-version path outside `realpath(cacheRoot)/node/24.21.0/<arch>/bin/node`. `toolchain-contract.test.ts` inventories root plus all 13 workspace manifests, CI, coverage-full/bot-unit/install/release-coverage; rejects every raw Node/Vitest/Turbo/TypeScript/ESLint/Prettier bypass; asserts all seven setup-node steps have the exact SHA `GITHUB_ENV` block then frozen install, action SHAs/comments below, and audit → licenses order.

- [ ] **Step 2: Run the RED deterministic-launch checks.**

```bash
bun test scripts/tooling/verify-foundation.test.ts scripts/tooling/toolchain-contract.test.ts
bash scripts/coverage-gates.test.sh
```

Expected: FAIL while the old `bunx`, ambient `node`, and previous command strings remain.

- [ ] **Step 3: Implement the A0 port across every listed consumer.** Preserve coverage sources/reporters/thresholds, network guards, worker limits, mode clearing, and command order. Replace the install script's JSON-only Node one-liner with behavior-only `bun --eval` and document why it does not start Node/Vitest. Local evidence uses only the `/home/eggp/.nvm/nvm.sh` bootstrap; CI performs the exact tool-cache injection. Do not mutate a Vitest config merely to make it pass.

- [ ] **Step 4: Prove every tracked Vitest config loads again after local-runner changes.** Use the identical A0 protocol bootstrap and `bun scripts/tooling/node-executable-protocol.ts --gate=vitest-list-all-configs` for all 48 paths. A failure must capture the config path and error; only that path may be proposed for a separately described compatibility repair after the blocker protocol below.

- [ ] **Step 5: Run the GREEN deterministic and full gates.**

```bash
bun test scripts/tooling/verify-foundation.test.ts scripts/tooling/toolchain-contract.test.ts
bash scripts/coverage-gates.test.sh
bun run test:coverage-infra
bun run coverage:release:unit
bun run coverage:release:e2e
bun run format:check
bun run lint
bun run typecheck
bun run build
bun run test
bun run coverage:bot:unit
bun run coverage:bot:e2e
bun run coverage:scope
bun run coverage:full
bun run hook:validate
git diff --check
```

Expected: all commands PASS, with release/unit/E2E reports showing exact 100% statements, branches, functions, and lines for their declared owned scopes. Preserve output as evidence; do not substitute an older successful run.

- [ ] **Step 6: Commit Phase B exactly.** Let `phase_b_base` be the post-Commit-A reviewed `HEAD`; post-format count every listed authored path (`wc -l`, each `<=500`; generated `bun.lock` excepted), then stage only these exact 24 paths from Tasks B1–B2 (including `scripts/tooling/toolchain-contract.test.ts` once):

```bash
git add package.json packages/assert/package.json packages/logging/package.json packages/numeric/package.json packages/typeguard/package.json packages/typing/package.json bun.lock apps/bot/package.json apps/config-search/package.json packages/backtest-tools/package.json packages/backtest/package.json packages/core/package.json packages/exchange/package.json packages/paper/package.json packages/shared/package.json .github/workflows/ci.yml scripts/coverage-full.sh scripts/coverage-gates.test.sh scripts/coverage-tools/run-bot-unit-coverage.ts scripts/install-no-warnings.sh scripts/tooling/verify-foundation.test.ts scripts/tooling/toolchain-contract.test.ts scripts/tooling/verify-third-party-licenses.ts scripts/tooling/verify-third-party-licenses.test.ts
git diff --cached --check
LEFTHOOK_BIN="$PWD/node_modules/.bin/lefthook"
test -x "$LEFTHOOK_BIN"
"$LEFTHOOK_BIN" run pre-commit
env LEFTHOOK_BIN="$PWD/node_modules/.bin/lefthook" git commit -m "chore(test): migrate local Vitest runner to v5"
```

Record the manual gate PASS separately from the automatic Lefthook stdout/exit emitted by the normal coordinator-only commit.

- [ ] **Step 7: Obtain independent actual-diff reviews.** A `terra_reviewer` reviews `phase_b_base..HEAD` for exact pins/SHAs, lock closure, sealed Node tools, supply-chain gates, 48-config compatibility, and coverage. A `luna_process_reviewer` reviews isolation, TDD, frozen/audit/license evidence, staging, CI exception, and gates. Valid findings require a smallest follow-up and full-range re-review; do not close/push/open PR first.

## Fail-Closed Compatibility Blocker

Vitest `5.0.0` cannot be truthfully declared compatible until the allowed Bun `1.4.2` lock regeneration has produced a frozen install and the exact post-A 48-config Node `24.21.0` validation has run after both dependency and runner updates. The current read-only audit cannot supply that evidence.

If one fails, stop before modifying an unlisted Vitest config, TypeScript `6.0.3`, Turbo `2.10.10`, Vite `8.2.1`, coverage threshold/source list, or historical doc. Record config/command/error; do not fabricate repair, broaden B, downgrade, or treat a subset as all-48 proof.

## Planning-Workspace Note

The requested `.superpowers/sdd/runtime-toolchain-migration/` workspace is not ignored by this worktree's `.gitignore`, `.git/info/exclude`, or configured global excludes. Creating it would leave an untracked file outside the one tracked plan deliverable. This plan therefore does not create that workspace; the coordinator must either provide an already-ignored workspace or explicitly authorize a separately owned ignore-rule change before an SDD artifact can be written there.
