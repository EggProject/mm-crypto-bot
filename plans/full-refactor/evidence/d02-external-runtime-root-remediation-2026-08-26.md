# D-02 external runtime-root remediation evidence

## Decision and scope

D-02 was approved to make the CLI's default configuration discovery safe when
the runtime root is external to the repository. The remediation preserves an
explicit `--config=<path>` as an intentional override, including when no
runtime root is available. It covers resolver admission, public CLI handlers,
state/config file boundaries, parser behavior, and governed unit and subprocess
E2E coverage. No gate, coverage threshold, ignore list, or command contract was
weakened.

The integration worktree branch is `codex/runtime-root-integrated`, based on
`42a80c9f20e00ff670d2df350ac36cf084a64693`. The read-only materialization
source was `codex/runtime-root-resolver` at
`2d2df6fc7bbdb4db29abb69286fd86ca90c85495`, with an empty source index. No
commit, staging operation, network request, live-venue access, or external
write was performed.

## Exact materialization inventory

The final atom contains exactly these 49 owned paths:

```text
apps/bot/src/cli/argv.ts
apps/bot/src/cli/cli-e2e.test.ts
apps/bot/src/cli/commands/config.test.ts
apps/bot/src/cli/commands/config.ts
apps/bot/src/cli/commands/kill-switch-dry-run.test.ts
apps/bot/src/cli/commands/kill-switch-dry-run.ts
apps/bot/src/cli/commands/kill-switches.ts
apps/bot/src/cli/commands/start-log-routing.test.ts
apps/bot/src/cli/commands/start.ts
apps/bot/src/cli/commands/status.ts
apps/bot/src/cli/commands/strategies.ts
apps/bot/src/cli/commands/trades.ts
apps/bot/src/cli/router.test.ts
apps/bot/src/cli/router.ts
apps/bot/test/e2e/runtime-driver/cli-boundaries.ts
apps/bot/src/cli/cli-e2e-backtest.test.ts
apps/bot/src/cli/cli-e2e-core.test.ts
apps/bot/src/cli/cli-e2e-signal.test.ts
apps/bot/src/cli/cli-e2e-test-support.test.ts
apps/bot/src/cli/commands/command-state-file.test.ts
apps/bot/src/cli/commands/command-state-file.ts
apps/bot/src/cli/commands/config-init.test.ts
apps/bot/src/cli/commands/config-path-commands.test.ts
apps/bot/src/cli/commands/config-path.test.ts
apps/bot/src/cli/commands/config-path.ts
apps/bot/src/cli/commands/config-public-api.test.ts
apps/bot/src/cli/commands/kill-switch-dry-run-command.test.ts
apps/bot/src/cli/commands/kill-switch-dry-run-command.ts
apps/bot/src/cli/commands/kill-switch-dry-run-report.test.ts
apps/bot/src/cli/commands/kill-switch-dry-run-report.ts
apps/bot/src/cli/commands/kill-switch-dry-run-state.ts
apps/bot/src/cli/commands/kill-switch-dry-run-test-support.test.ts
apps/bot/src/cli/commands/read-only-command-config-coverage.test.ts
apps/bot/src/cli/commands/read-only-command-default-adapters.test.ts
apps/bot/src/cli/commands/read-only-command-state-coverage.test.ts
apps/bot/src/cli/commands/start-log-routing-command.test.ts
apps/bot/src/cli/commands/start-log-routing-lifecycle.test.ts
apps/bot/src/cli/commands/status-command.test.ts
apps/bot/src/config/runtime-root.test.ts
apps/bot/src/config/runtime-root.ts
apps/bot/test/e2e/runtime-driver/cli-boundaries-argv.ts
apps/bot/test/e2e/runtime-driver/cli-boundaries-config.ts
apps/bot/test/e2e/runtime-driver/cli-boundaries-d02-backtest.ts
apps/bot/test/e2e/runtime-driver/cli-boundaries-d02-config-command.ts
apps/bot/test/e2e/runtime-driver/cli-boundaries-d02-core.ts
apps/bot/test/e2e/runtime-driver/cli-boundaries-d02-readonly.ts
apps/bot/test/e2e/runtime-driver/cli-boundaries-d02-start.ts
scripts/coverage-tools/bot-runtime-scope.json
plans/full-refactor/evidence/d02-external-runtime-root-remediation-2026-08-26.md
```

The excluded `scripts/tooling/eslint-bot-typed-project.test.ts` remained
byte-identical between source and target. The initial materialization was
byte-identical for all 49 owned files and preserved their `100644` modes.

## Approval and prerequisite review receipts

On 2026-08-27, the user rejected openat2 and hostile concurrent-filesystem
hardening (`nem kell ilyen védelem`) and approved the cooperative local
filesystem model; the configuration change is handled separately. D-02 keeps
that approved boundary and adds no hardening beyond its existing canonical-path
and symlink-escape checks.

The D-02 source prerequisite was independently reviewed before materialization.
Its source HEAD was `2d2df6fc7bbdb4db29abb69286fd86ca90c85495` and its exact
four-path scope was `scripts/tooling/eslint-bot-typed-project.test.ts`,
`apps/bot/src/cli/commands/kill-switch-dry-run-command.test.ts`,
`apps/bot/src/cli/commands/kill-switch-dry-run-report.test.ts`, and
`apps/bot/src/cli/commands/status-command.test.ts`. Independent
`/root/d02_mechanical_prerequisite_review` used `terra_reader`; its initial
sole Medium formatter-proof finding was closed by fix round 2's recovered
snapshot and exact no-index diff. The prerequisite ended Spec PASS, task
quality APPROVED, with zero open findings. Source records:
`.superpowers/d02-mechanical-prerequisite-plan.md` (SHA-256
`5353ff0ad5618946827f6bc38ccc94cc595e4c5abad3b2fff49a70ec15b6fd7d`),
`.superpowers/sdd/d02-mechanical-prerequisite-plan/progress.md` (SHA-256
`9f63dace8cdd51189978e680ff78e26d0068e4395212eb3eb0ca009c27e04399`), and
`.superpowers/sdd/d02-mechanical-prerequisite-plan/task-1-report.md` (SHA-256
`4c54067de9f1ee25179ead884eefabfbb8116e78b85a36185458e38e8346cc50`).

## RED to GREEN chronology

1. RED: default CLI discovery lacked an external runtime-root resolver; an
   explicit config path was the only safe admission path.
2. RED: resolver probing found a symlink-to-repository acceptance risk; this
   was recorded as a TECH finding. Resolver tests now reject repository and
   escaping configuration symlinks while accepting a real external template.
3. RED: a stale E2E import and an incomplete coverage-scope inventory prevented
   governed coverage from representing the current runtime surface. Both were
   corrected, and scope verification became green for 33 owned runtime files.
4. RED: exact coverage exposed public CLI branch gaps. Public DI seams and real
   temporary filesystem fixtures covered explicit, no-root, parser, schema,
   output, default-adapter, runtime-root, and symlink paths.
5. Intrinsic branches were proved rather than mocked: direct `JSON.parse`
   cannot throw a non-Error without replacing the intrinsic; its messages now
   use branchless `String(error).replace(/^SyntaxError: /, "")` with malformed
   JSON regressions. Validated strategy passthrough drops `undefined`; the
   unreachable formatter guard was removed after a schema-parse regression.
6. GREEN: all Unicorn findings in `argv.ts` were structurally remediated with
   public parser behavior preserved. The TypeScript 6 coverage-tooling issue in
   the E2E child-environment predicate was fixed without unsafe assertions.
7. RED: Bun returned `JSON Parse error: Unexpected identifier "not"` for
   malformed dry-run state, while the public test asserted Node-specific parser
   text. The test now proves only the stable `invalid JSON in <path>:` prefix.
   A first Bun-only matcher attempt exposed a Vitest/Chai incompatibility during
   governed unit coverage; the final assertion uses
   `String.prototype.startsWith(...) === true`. No production code changed for
   this portability correction.
8. RED: a router regression showed that the dispatch context had an own
   `config: undefined` property despite the router having no configuration
   loading authority. The context contract now makes configuration optional and
   dispatches `{}`. The regression passes only when no fabricated config field
   is present. The config-command fixture uses the same truthful `{}` context;
   strategy nested-record output remains covered while its redundant record
   assertion was removed. The argv header now documents parser intent without a
   delivery-history label.

## Security and behavior invariants

- Runtime roots must be absolute, canonical, external to the repository, and
  contain a real `config/default.toml`; repository and escaping symlinks fail
  closed.
- `--config=<path>` remains explicit caller authority and is not replaced by
  runtime-root discovery.
- CLI state/config operations use validated public boundaries and hostile
  injected errors are handled without fabricating private state.
- Test filesystem effects are confined to fresh temporary directories; no
  external systems, credentials, or persistent external writes are used.

## Validation record

| Command                                         | Result                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `bun test` of the 24 owned test files           | 144 passed, 433 expectations                                          |
| `bun run coverage:bot:unit`                     | 41 files, 564 tests; S 2069/2069, B 1098/1098, F 363/363, L 1957/1957 |
| `bun run coverage:bot:e2e`                      | 46/46 cases; S 2065/2065, B 1098/1098, F 364/364, L 1953/1953         |
| `bun run --filter @mm-crypto-bot/bot typecheck` | pass                                                                  |
| `bun run typecheck:coverage-tools`              | pass                                                                  |
| `bun run --filter @mm-crypto-bot/bot build`     | pass                                                                  |
| 47 owned TypeScript paths with ESLint max 0     | pass                                                                  |
| Prettier check of all 49 owned paths            | pass                                                                  |
| scoped diff, secret-pattern, and LOC checks     | pass; 0 whitespace errors, 0 secret matches, 0 files above 500 lines  |

`bun run verify` is a required target but is not implemented in this repository;
it was not run and this record makes no full-root-green claim.

## Fix round 1 review remediation

The four TECH findings were remediated without new production behavior: router
contexts now truthfully omit unloaded configuration, the config test uses the
real empty context, nested strategy objects use the existing object narrowing,
and the argv header has timeless intent-only wording. The four PROCESS findings
are recorded in this evidence and the D-02 ledger, including the user approval,
review-route observability, historical status correction, and prerequisite
review receipt.

Fresh candidate execution was 144 tests and 433 expectations. Governed unit
coverage remained S 2069/2069, B 1098/1098, F 363/363, L 1957/1957; governed
E2E remained 46/46 cases with S 2065/2065, B 1098/1098, F 364/364, L
1953/1953. Bot and coverage-tools typechecks, the bot build, ESLint0, Prettier,
diff, secret, LOC, status, and index checks passed. The source 49-path
content aggregate SHA-256 is
`e5f761224ef6741862b5272f57753bfe648532c1ef8b19d5fd7af52b0d58589d`.

## Independent review closure (2026-08-27)

- TECH PASS: mandatory `/root/d02_runtime_root_final_tech` used
  `terra_reviewer` at high reasoning effort with read-only authority. It
  independently examined the exact current 49 paths against parent
  `42a80c9f20e00ff670d2df350ac36cf084a64693` and reported zero findings.
  It verified candidate 144/433, unit 564 with S/B/F/L
  2069/1098/363/1957, E2E 46 with S/B/F/L 2065/1098/364/1953, and passing
  typechecks, build, lint, format, and scope gates.
- PROCESS PASS: mandatory `/root/d02_runtime_root_final_process` used
  `luna_process_reviewer`, requested `gpt-5.6-luna` / `medium`, with effective
  model/effort not observable and read-only authority. It independently
  reported zero findings and verified the provenance, scope, TDD, gate, and
  evidence receipts.

The reviews are PASS. Final identity confirmation remains **PENDING** until
this evidence-only delta is independently rechecked.

## Risk, rollback, and review

The migration risk is limited to default configuration discovery and CLI output
formatting for malformed JSON. Rollback is a normal source revert of the
runtime-root/CLI slice; explicit `--config` remains the operational fallback.
No external data migration is required. Effects were confined to the isolated
target worktree and temporary test/coverage/build output.

Final identity confirmation after the evidence-only delta: **PENDING**.
