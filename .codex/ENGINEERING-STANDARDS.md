# Engineering Standards

## Authority and Scope

This document is the binding engineering standard for this repository. `AGENTS.md`
is a concise contributor index and points here for normative detail. All source,
tests, tooling, configuration, documentation, generated-data workflows, release
work, and agent work MUST comply with this document.

### Required Target State

Requirements that name a package, script, command, directory, report, or
verification gate describe the required target state. They MUST NOT be read as a
claim that the named item is already implemented. Until a required target exists,
documentation and delivery evidence MUST identify it as missing; they MUST NOT
claim that it was run or passed.

Existing code is not precedent. Code that is created or touched MUST conform
locally to this standard. A broad migration MUST be a separately scoped change.

## Repository and Architecture

### Module Boundaries

- Modules and functions MUST have one clear responsibility. Mixed-purpose
  `utils`, helpers, and manager modules MUST be split into cohesive domain
  modules.
- Dependency direction MUST point inward. Domain code MUST NOT depend on CCXT,
  Bun, React, file systems, transports, or other infrastructure.
- Consumers define ports; infrastructure implements adapters. Architecture tests
  MUST detect dependency cycles and prohibited inward dependencies.
- Strategy, risk, position, and backtest domain decisions MUST be pure and
  deterministic. Environment, clocks, file systems, networks, and exchanges
  MUST be supplied through adapters and injected dependencies.
- Cross-package imports MUST use only a package's declared public exports.
  Reaching into another package's `src` tree is forbidden.
- A package public API MUST be minimal and intentional. Test-convenience exports
  are forbidden. Breaking public-API changes MUST include migration guidance and
  consumer contract tests.

### State and Time

- Domain values and configuration MUST be `readonly` and immutable. State
  transitions MUST be pure. Shared mutation is forbidden; each mutable resource
  MUST have one explicit owner.
- Timestamps MUST be typed UTC values that distinguish exchange, received, and
  processed time. A `Clock` MUST be injected. Durations MUST use a monotonic
  clock. Serialized timestamps MUST be ISO 8601 UTC or a documented epoch.
- Lifecycle state machines MUST be typed and idempotent. Startup and shutdown
  MUST block inappropriate orders, drain work, close resources, persist state
  atomically, honour timeout and cancellation, and leave no leaked resources or
  partially started service.

## Language, Types, and Shared Foundations

### Language and Comments

- All new or modified identifiers, source comments, commit messages, and
  developer documentation MUST be English.
- Localized user-interface content is permitted. Formal reports required by this
  standard MUST be Hungarian.
- Timeless source comments MAY explain only intent, business reason, or an
  invariant. Comments MUST NOT contain delivery phases, implementation history,
  mandates, or changelog material.
- Names MUST express the domain and units. Avoid vague names such as `data`,
  `value`, `item`, `manager`, `helper`, and `utils`, and avoid obscure
  abbreviations. Constants MUST have typed, named domain meaning.
- Unicorn rules MUST enforce filename, boolean, compound-expression, TODO, and
  disable-directive conventions where the plugin provides the corresponding
  rule.

### TypeScript and Validation

- TypeScript MUST remain strict. Every untrusted boundary MUST begin as
  `unknown` and be validated before use.
- Named type guards, including domain-specific guards, are mandatory for
  narrowing untrusted data. `any`, `@ts-ignore`, `@ts-nocheck`, and unsafe type
  assertions are forbidden.
- An exceptional assertion requires a written reason adjacent to the assertion
  and a test that proves the assumption. It MUST be the narrowest possible
  assertion.
- Expected failures MUST use typed results. Unexpected failures MUST throw or
  reject and preserve the complete cause chain. Swallowed errors are forbidden.
- Configuration MUST be fully validated by guards during startup. Unknown or
  invalid values are hard errors. Valid configuration MUST become immutable,
  environment variables MUST NOT be reread, and live configuration MUST have no
  defaults or automatic repair.
- Secrets, credentials, private keys, personal data, and sensitive payloads
  MUST NOT appear in source code, TOML, fixtures, logs, errors, snapshots, or
  distributable artifacts. They MUST be supplied through environment injection
  or an approved secret store and redacted at every diagnostic boundary.
- HTTP, WebSocket, configuration, and persistence boundaries MUST
  use versioned DTOs guarded at the boundary. Domain objects MUST NOT be
  serialized directly. Breaking DTO changes require migrations and contract
  tests.

### Code Health and Bounded Resources

- Placeholder, commented-out, dead, and unreachable code is forbidden. Every
  TODO MUST have an owner and tracked resolution; unowned TODOs are forbidden.
- A feature flag MUST declare its owner, default, removal condition, and tests
  for both enabled and disabled behaviour.
- Optimisation work MUST be justified by a benchmark or profiling evidence and
  record before-and-after measurements. Streams, queues, caches, retained
  history, and retry loops MUST be bounded. Leak and shutdown tests MUST verify
  their lifecycle.

### Shared Type Utilities

- Reusable guards belong in `packages/typeguard`, sourced from
  `temp/ts/typeguard`; existing tested guards MUST be reused or extended rather
  than duplicated.
- Cross-domain type utilities belong in `packages/typing`, sourced from
  `temp/ts/typing`, and MUST have compile-time tests.
- Runtime helpers in `packages/typing` are permitted only when they preserve a
  type relationship. They MUST be pure and MUST NOT perform I/O, domain work,
  or state mutation.
- Internal-invariant assertions belong in `packages/assert`, sourced from
  `temp/ts/assert`, and MUST be built on guards. External input validation MUST
  use guards, not assertions.
- `temp/ts/rxjs` is explicitly not integrated. RxJS MUST NOT be introduced.

## Exact Numeric and Data Integrity

### Exact Financial Values

- Financial values and quantities MUST use `packages/numeric`, wrapping an
  audited, exact-pinned `fraction.js` implementation and BigInt rational
  arithmetic.
- Numeric inputs MUST be strings or bigint. JavaScript `number`, `valueOf`,
  rounding, truncation, approximation, implicit coercion, and lossy
  serialization are forbidden for financial decisions.
- JSON and exchange boundaries MUST use canonical strings for exact values.
- Price ticks and quantities MUST be exact multiples of venue rules; otherwise,
  the order MUST be rejected.
- Irrational operations in financial decisions MUST be reformulated exactly or
  forbidden.

### External and Generated Data

- All external or generated data MUST reside below root `data/` in exactly the
  appropriate category: `ohlcv`, `runtime`, `backtests`, `fixtures`, `logs`,
  `cache`, `tmp`, `reports`, or `catalog`.
- Datasets MUST NOT reside in `src`, packages, or apps. Configuration and
  migrations are narrowly scoped exceptions where they are source-controlled
  application inputs.
- The data root MUST be injected, never hard-coded. Data handling MUST keep
  configuration, secrets, and mounted data outside distributable artifacts.

### OHLCV Canonical Format

- OHLCV data MUST be stored at
  `data/ohlcv/<venue-type>/<exchange>/<instrument-type>/<symbol>/<timeframe>/<YYYY>/<MM>/<YYYY-MM-DD>.csv`.
- A file represents the UTC interval `[00:00, 24:00)`. Rows MUST be strictly
  increasing by time; duplicates and gaps MUST be checked. Replacements MUST be
  atomic, versioned, and immutable.
- The canonical source format is uncompressed UTF-8 CSV `ohlcv-bars@1` with
  exactly this header:
  `open_time_ms,open,high,low,close,volume`.
- `open_time_ms` MUST be an unsigned decimal BigInt string. OHLCV values MUST
  be canonical non-negative decimal strings: no exponent notation, leading
  plus, separators, leading zero, or JavaScript-number representation.
- The schema MUST be maintained at
  `data/catalog/ohlcv-bars@1.schema.json`. Each dataset manifest MUST state the
  volume unit, source, schema version, row count, UTC range, and a per-file
  SHA-256 checksum in canonical lowercase hexadecimal representation.
- Ingestion MUST stream to temporary storage, validate fully, then atomically
  rename. Appending to canonical files and compression are forbidden. Parquet is
  allowed only as an optional, regenerable analytic derivative.

### Provenance and Lineage

- Every dataset MUST have a validated provenance manifest containing an ID,
  schema, provider, endpoint, venue, exchange, instrument type, symbol,
  timeframe, UTC range, download time, count, gap status, duplicate status,
  SHA-256 hash in canonical lowercase hexadecimal representation, tool version,
  and source commit.
- Raw data MUST be immutable. Derived data MUST receive a new ID, parent IDs and
  hashes, and a deterministic transformation record.
- A backtest MUST require a valid manifest and record its input dataset ID and
  hash. Unknown or manually supplied provenance is a hard error.

## Logging and Observability

### Central Logging

- Runtime code MUST use only the injected logger interface from
  `packages/logging` (`@mm-crypto-bot/logging`). Direct `console` use, custom
  file loggers, and ad hoc log formats are forbidden.
- In production, logs MUST be structured JSON written to `stderr`; machine
  readable CLI output MUST remain clean on `stdout`. An optional file sink MAY
  write only below `data/logs/`.
- Each record MUST include a UTC timestamp, level, stable event name, component,
  and run/correlation ID. Strategy, symbol, dataset, and order IDs MUST be
  included whenever relevant. Exact financial values MUST be logged only as
  strings.
- Startup, shutdown, configuration-validation outcome, external-I/O status and
  latency, retry, feed gap/stale state, state transition, strategy decision,
  risk decision, order lifecycle, reconciliation, kill switch, and complete
  error cause chains MUST be logged.
- Tick and candle payloads MAY appear only at sampled or rate-limited `debug`
  level. Secrets and sensitive payloads MUST be redacted before any sink.
- Logging MUST NOT block without limit or grow an unbounded queue. It MUST have
  bounded backpressure behaviour and preserve critical audit events.
- Unit and end-to-end tests MUST verify schema, redaction, level selection,
  backpressure, and preservation of critical audit events.

## Safety and Trading Lifecycle

### Production Mission and Fixed-Leverage Invariant

- The production product MUST operate multiple strategies across multiple
  tickers. Its only permitted live venue and product are Bybit EU Spot Margin,
  through CCXT `bybiteu` against `https://api.bybit.eu`; every other live
  venue, endpoint, account region, market, or product MUST be rejected before
  it can submit an order.
- This section defines Required Target State only. Current code MAY be
  nonconforming and MUST NOT be represented as implementing, validating, or
  passing these requirements until evidence proves that it does.
- The live starting-equity baseline MUST be the exact USD-equivalent string
  `"1000"`, accompanied by an explicitly recorded UTC valuation timestamp and
  authoritative valuation source. The initial gross-exposure target MUST be the
  exact USD-equivalent string `"10000"` and MUST use that same recorded UTC
  valuation timestamp and authoritative valuation source. A different
  timestamp/source pair is permitted only when it is independently and
  explicitly recorded for the `"10000"` target as its authoritative valuation
  timestamp and source. Financial values MUST remain exact canonical strings;
  rounding, binary floating point, and implicit conversion are forbidden.
- Gross exposure MUST equal the sum of the absolute notionals of all strategy
  and symbol positions plus the worst-case executable notionals of all active
  orders. Equity, available balance, wallet balance, gross exposure, net
  exposure, selected leverage, venue maximum leverage, actual borrowed amount,
  and effective leverage are distinct values and MUST be represented,
  calculated, audited, and reconciled separately. Net exposure MUST retain its
  signed directional value; effective leverage MUST NOT be substituted for the
  immutable selected-leverage setting.
- Each live operation and each live order MUST retain an immutable selected
  leverage of exactly 10x and independently verify it immediately before any
  exchange submission. A leverage range, cap, default, fallback,
  per-strategy/per-symbol override, or dynamic leverage selection is forbidden.
  Any selected leverage other than exactly 10x is a hard error, and no related
  order MAY reach the exchange.
- Live activation and every live order MUST verify, using current authenticated
  Bybit EU responses, account eligibility, Unified Trading Account Spot Margin
  availability, supported symbol and assets, permitted margin mode, successful
  10x selection, borrowing capacity, and account state. Missing, stale,
  ambiguous, unsupported, or ineligible evidence MUST fail closed. CCXT
  capabilities, local configuration, cached state, and prior orders are never
  sufficient proof; the authoritative Bybit EU response is required.
- The selected 10x setting, actual borrow, and effective leverage MUST be
  separately recorded in immutable audit events and independently reconciled
  with authenticated Bybit EU account and order responses.
- Reduce-only and emergency-exit operations MUST NOT be blocked solely because
  they reduce exposure. They MUST preserve the exactly 10x selected-leverage
  setting and use a fail-safe, risk-reducing execution path; they MUST NOT
  bypass validation unrelated to the exposure reduction.
- Unit, property, integration, and end-to-end tests MUST cover every invalid or
  non-10x condition and prove that no exchange order is submitted. Tests MUST
  also cover stale or ambiguous eligibility, unavailable Spot Margin,
  unsupported assets or symbols, invalid margin mode, unsuccessful leverage
  selection, inadequate borrowing capacity, and the reduce-only/emergency-exit
  path.
- Authoritative references: [Bybit EU Spot Margin FAQ](https://www.bybit.eu/en-EU/help-center/article/FAQ-Spot-Margin-Trading),
  [Bybit EU Spot Margin getting started](https://www.bybit.eu/en-EU/help-center/article/How-to-Get-Started-With-Margin-Trading-on-Bybit),
  [Bybit EU Margin Trading Service Agreement](https://www.bybit.eu/en-EU/help-center/article/Margin-Trading-Service-Agreement),
  and the [CCXT source repository](https://github.com/ccxt/ccxt).

### Live Safety and Resilience

- Live trading MUST fail closed unless explicit live configuration, valid
  credentials, and operator confirmation are present. Fallbacks and partial
  initialization are forbidden.
- Exchange, fill, and control processing MUST be idempotent with stable IDs and
  ordering. For one logical order intent, every exchange retry MUST reuse the
  same stable client order ID; generating a new ID or creating a duplicate
  external order is forbidden. Intent persistence MUST be atomic. Retries MUST
  NOT duplicate side effects. Concurrency tests MUST demonstrate these
  properties.
- The exchange is the source of truth. Startup, reconnection, and uncertain
  states MUST reconcile against it, write an audit diff, and block operation
  until every discrepancy is resolved.
- Market data MUST be guarded for sequence, time, and range. Gaps,
  out-of-order or duplicate messages, stale input, and unrealistic values MUST
  create explicit status, trigger resynchronization, and block the affected
  symbol. Filling or interpolating market data is forbidden.

### Risk, Orders, and Execution Modes

- An unbypassable central risk gate MUST run before every exchange action in
  every mode. It MUST validate leverage, exposure, concentration, drawdown,
  price, quantity, balance, and kill-switch state.
- The risk gate MUST fail closed, return typed decisions, emit audit events, and
  have unit, property, and end-to-end coverage.
- Backtest, paper, and live execution MUST use the same strategy and domain
  decision code; only adapters may differ. Each run MUST record strategy,
  configuration, and input IDs. Backtests MUST prohibit lookahead and apply
  exact fees, precision, and order rules.

## Testing and Quality Gates

### Test Design

- Tests MUST verify public behaviour, domain invariants, and error paths. A
  regression test that fails before a bug fix MUST accompany the fix.
- Unit and end-to-end coverage MUST be measured separately. Each owned runtime
  source scope MUST achieve 100% statements, branches, functions, and lines in
  both required test levels.
- Coverage gaming and ignore directives are forbidden, except documented
  generated code, declarations, or static data that cannot contain owned runtime
  behaviour.
- Tests MUST be deterministic: no live exchange, network dependency, real-time
  dependency, or unseeded random generator. Dependencies, clocks, and random
  sources MUST be injected. Manual live smoke testing is separate evidence.
- Property tests MUST cover exact numerics, guards, transitions, idempotency,
  and risk. They MUST have a deterministic seed and persist minimized
  counterexamples.

### Static Quality and Verification

- Root ESLint configuration MUST be flat and strict across all JavaScript,
  TypeScript, and test files. It MUST include `@eslint/js` recommended,
  `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked`, security,
  and the exact-pinned `eslint-plugin-unicorn` recommended rules.
- There MUST be no blanket test disablement. Every narrow disable MUST state a
  reason. ESLint MUST run with `--max-warnings=0`.
- Prettier and `eslint-config-prettier` MUST be exact-pinned. `format` and
  `format:check` MUST run in CI. Lefthook MUST run ESLint before Prettier at pre-commit, then run only the allowlisted clean:artifacts command and worktree inspection.
- The required root target is `bun run verify`. Once implemented, it MUST
  reproduce CI format, lint, typecheck, build, unit-coverage, and
  end-to-end-coverage gates. Until it exists, delivery evidence MUST say so.

## Build, Deployment, Dependencies, and Cleanup

### Toolchain and Supply Chain

- The repository MUST be one Bun workspace. Only the repository-pinned Bun
  version and `bun.lock` may be used; npm, pnpm, and Yarn are forbidden.
- Dependencies MUST be exact-pinned. Dependency updates MUST be separate,
  audited changes that run the full verification gate. Manual lockfile edits are
  forbidden.
- Installation, native modules, and WASM require audit and an explicit
  allowlist. `trustedDependencies` MUST be minimal. CI MUST check the lockfile,
  vulnerabilities, and licenses; high or critical findings MUST block delivery.
  Runtime download of unpinned code is forbidden.
- CI MUST use a clean frozen lockfile and the exact Bun version. Tests MUST NOT
  mutate the repository or depend on caches or a network. Build artifacts MUST
  record metadata and be reproducible.

### Release Artifacts

- Each deployable app MUST produce a target-specific, self-contained release;
  the bot MUST be a Bun executable or full bundle.
- Releases MUST NOT contain `node_modules`, a package manager, or source code.
  A manifest MUST record commit, version, OS/architecture, configuration, and
  hashes.
- A clean temporary offline smoke test MUST validate each release. External
  configuration, secrets, and data mounts MUST be documented and MUST NOT be
  embedded in the artifact.

### Repository Hygiene

- Root `.gitignore` MUST exclude dependencies, builds, releases, coverage,
  Turbo data, caches, temporary files, logs, secrets, state, downloads,
  backtest outputs, and data reports. It MUST track environment examples, the
  data README, schemas/catalogues, and deterministic fixtures.
- Reports MUST be committed only when explicitly requested. Ignore and
  documentation changes required by a data workflow MUST be delivered in the
  same change.
- `bun run clean:artifacts` MUST be idempotent, allowlisted, logged, and limited
  to known build, coverage, cache, and temporary artifacts. Pre-commit MUST run
  it and inspect the worktree afterwards.
- `clean:all` MUST be a separate command. Pre-commit MUST NOT delete
  `node_modules`. `git clean`, broad globs, and recursive root deletion are
  forbidden. `data/reports`, state, user data, and unknown untracked files MUST
  never be deleted. Uncertain targets require inspection and explicit direction.

## Documentation, Commits, Pull Requests, and Reports

### Documentation and Change History

- Documentation and examples MUST change with their implementation in the same
  pull request. Each fact MUST have one source of truth; stale references are
  forbidden.
- Commits MUST be small, atomic Conventional Commits in the form
  `type(scope): imperative summary`. Refactoring, formatting, and behaviour
  changes MUST be separate. A commit MUST NOT leave shared branches broken.
- Pull requests MUST describe the problem, solution, alternatives, trade-offs,
  risk, rollback, validation evidence, screenshots where relevant, migration or
  compatibility impact, and linked issue.

### Formal Reports

- A formal audit, review, research, backtest, benchmark, test, performance, or
  result report MUST be created only when the user explicitly requests a report
  or the coordinator records in delivery evidence why standalone HTML
  materially improves representation or comprehension of substantial results.
  When created, it MUST be standalone Hungarian HTML saved as
  `data/reports/<YYYY>/<MM>/<YYYY-MM-DD-HHmm>-<slug>.html`.
- Filename timestamps MUST use Europe/Budapest time. Reports MUST be UTF-8,
  declare `lang="hu"`, embed their styling, and use no CDN.
- Each report MUST include date, timezone, scope, commit, worktree status,
  method, executive summary, evidence, results, limitations, and checks.
- Ordinary status, completion, chat, CI output, and routine retrospectives MUST
  NOT create a formal report file. When a formal report is created, chat
  communication about it MUST contain only a concise report link. Formal reports
  MUST NOT be deleted.

## Agent Orchestration and Retrospective

### Agent Conduct

- Agents MUST meet the same quality requirements as human contributors. They
  MUST preserve unrelated user changes, claim only checks actually run, report
  skipped checks, and avoid commits, unrelated edits, and broad migrations
  without explicit authority.
- Substantive repository work MUST be coordinator-led at the root. Subagents MAY
  perform analysis, research, implementation, testing, review, and reporting.
- Every subagent brief MUST state goal, scope, out-of-scope work, files, write
  authority, acceptance criteria, validation, and expected output. Independent
  tasks SHOULD run in parallel; dependent tasks MUST run sequentially. The root
  MUST NOT silently take over a delegated task because capacity is unavailable.
- Model routing MUST be documented and applied: Terra for complex, high-risk,
  multi-package, deep, security, risk, and final technical review work; Luna for
  read-only inventory, routine documentation, mechanical work, and quick checks;
  GPT-5.3-Codex-Spark for fast isolated coding, UI work, targeted tests, and
  small fixes.
- The coordinator MUST verify model callability. Low-risk Spark work MAY route
  to Luna; complex work MUST route to Terra. High-risk work without a suitable
  model is blocked.

### Session Retrospective

- Before normal closure of every substantive repository session, at least two
  independent non-implementing subagents MUST review the work directly. A
  technical reviewer MUST inspect objective, diff, architecture, tests,
  coverage, security, and evidence. A process reviewer MUST inspect task
  decomposition, brief accuracy, model selection, scope control, failures,
  retries, and compliance.
- Reviewers MUST inspect relevant files and test results rather than relying
  only on an implementer's summary. Every valid reviewer finding and every
  known open error MUST be fixed, then independently re-reviewed to PASS before
  completion or commit; neither MAY be waived or communicated as an open risk.
  A disputed finding MUST be decided by an independent adjudicator: a valid
  finding MUST be fixed and independently re-reviewed to PASS, while an invalid
  finding MUST have its rationale documented in delivery evidence.
- The required session evaluation MUST record completed checks even when there
  are no findings. Its HTML report file is optional and MUST be created only
  under the Formal Reports trigger policy; when triggered, it MUST use
  `data/reports/<YYYY>/<MM>/<YYYY-MM-DD-HHmm>-session-retrospective.html` and
  comply with every Formal Reports requirement. A session interrupted before
  the required reviews and evaluation is incomplete; the next continuation MUST
  complete them.

### Controlled Evolution of Standards and Skills

- The process retrospective MUST determine whether an observed issue is durable
  and recurring enough to justify an automated workflow or repository rule.
  One-off and task-specific lessons MUST remain in delivery evidence, or in a
  formal report when one is created, and MUST NOT create permanent policy.
- A justified proposal MUST target only `AGENTS.md`, this standards document, or
  a repository skill, and MUST include evidence, expected benefit, risk, and an
  exact patch. A repository skill MUST have a clear trigger, input, output,
  scripts, and tests.
- The coordinator MUST classify each retrospective finding before changing its
  governing policy or skill. A finding that affects product mission, live
  trading or risk, security, data semantics, cost, scope, external effects,
  permissions, or governing policy is material and MUST be discussed with the
  user and explicitly approved before its change. This requirement supersedes
  any blanket separate-approval requirement for retrospective findings.
- A low-risk internal-maintenance finding that does not alter user-visible or
  product semantics MUST be fixed automatically in the appropriate repository
  skill, `AGENTS.md`, or this standards document, independently re-reviewed to
  PASS, and summarized. Such an automatic fix MUST NOT lower quality or safety
  gates, broaden authority, override system or platform instructions, mutate
  memory, or perform external or destructive actions.
- Governing files and skills MUST NOT modify themselves automatically. Every
  repository-skill change MUST use the `skill-creator` requirements, and every
  approved material change or automatic low-risk maintenance change MUST receive
  independent validation.
- System and platform instructions MUST NEVER be overridden.
