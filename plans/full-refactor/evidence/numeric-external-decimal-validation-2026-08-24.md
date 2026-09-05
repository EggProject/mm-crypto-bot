# Numeric external-decimal validation record

Date: 2026-08-24 (Europe/Budapest)

This record is being rebased to the current five-path candidate.

## Rebased candidate

Supersedes all earlier claims tied to `a9935d5`, a four-code-path candidate,
or evidence outside the candidate. Current parent:
`6f4867c7ab39515b2756e8905ce1965b44df4d3e` (`6f4867c`), the C3B commit
`fix(tooling): restore pre-commit formatting gate`.

- Classification: non-review evidence write; Terra predicate: exact-financial
  and data-integrity evidence.
- Requested/effective route: `terra_worker`, `gpt-5.6-terra`, high;
  effective runtime attestation is not observable.
- Authority: this evidence only; no network, real index, staging, or commit.

Exactly five prospective-commit paths:

| Path                                            | SHA-256                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `packages/numeric/src/canonical.ts`             | `19c7851db377537aff0ba4bddd92d9355af221f47c97fb73cc0fd96de8873fb0` |
| `packages/numeric/src/index.ts`                 | `8f6901b4f480a690340c14c935b894b8758611dd980651b8fe98ae68cfd9ec38` |
| `packages/numeric/src/public-api.test.ts`       | `3a622881238c9fc7627d7168c4c04d21dd7ca92414c4d6b1322c2fd9cb969421` |
| `packages/numeric/src/external-decimal.test.ts` | `dd5a81a8a2b4c509ec05e5bb5fbb4de59e149ebc9710a66f300455b95d8a535e` |
| This evidence                                   | Pre-status-addendum snapshot below                                 |

## Validation and independent reviews

Prior local no-network replay: focused Bun tests 35/35; Vitest coverage 68/68
and S 201/201, B 158/158, F 41/41, L 200/200; numeric typecheck, build,
scoped ESLint, Prettier, and diff-check PASS. Durable logs are under
`/tmp/mm-numeric-replay.ODSSAo`; primary log hashes are
`e15d531c5093c55bcca46913a7f41ab12af6cdb0634bb78838cc7d8007119c05` and
`806ccb66dc12ac2ca87323e65ad89489bce7cd0c8f3d7cfc23c1f68483cc1885`.
The earlier wrapper failed only after a successful test because zsh rejected
the variable name `status`; its durable rerun is authoritative.

Fresh supplied independent review status for the current code-and-evidence
candidate: **TECH PASS** and **PROCESS PASS**, both zero open findings.

| Review    | Role and authority                                                  | Result       |
| --------- | ------------------------------------------------------------------- | ------------ |
| Technical | `terra_reviewer`, `gpt-5.6-terra`, high; read-only five-path review | TECH PASS    |
| Process   | `luna_process_reviewer`; read-only five-path/evidence review        | PROCESS PASS |

Reviewer commands, timestamps, task IDs, and artifacts were not supplied and
are not invented. These are not repository-wide, release, or live-trading PASS
claims.

## Shared-index preservation

No real index was used. The unrelated cached index still has 24 paths:

| Observation             | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| NUL path list           | `37e1c8643f28f3418782c42987dedb904d5eadffd9e6b3039edc15ff7b57289d` |
| NUL name/status         | `111e68ee18decc0e09c65d34f0f49050184d948d847a18945ac617c2dd648a48` |
| Binary full-index patch | `625916c3f042505c769297fd7065ee725dd103ba4013bfaffd1843e335871380` |

The full stage-entry hash is deliberately not claimed stable: the committed C3B
paths legitimately changed it. No numeric candidate path was staged.

## Pre-status-addendum identity snapshot

Isolated candidate: `/tmp/mm-numeric-commit-v2.CrIeWv/worktree`; ephemeral
index `.numeric-candidate-index.9Z9eLb`; isolated object directory
`.numeric-candidate-objects.VGCiaQ`. Neither is shared metadata.

| Identity                         | Value                                                              |
| -------------------------------- | ------------------------------------------------------------------ |
| Sorted NUL path list SHA-256     | `6eafa8d8c688e9ccff9738511fb783879b77719941a39800c011d734b9ec4d34` |
| Binary full-index patch SHA-256  | `fa851ec41c837a10b519f7e837b004999e06f5792d6745b117889f489a8e3b68` |
| Tree                             | `ac56f73261bd9a985fba002dc8fd37f422c56aa9`                         |
| NUL stage-entry SHA-256          | `d1bcabf13d230f9c0bd686a75fa3ecebccde5a24fea1d474245347cd6c4afda5` |
| Evidence before addendum SHA-256 | `f9944081041cfb736655f8f12e95c4104b4d5ea3aa2bf5118cf88a4502b5c623` |

This is explicitly a prior pre-addendum rebased-evidence snapshot: final
self-hash, blob, patch, or tree claims would alter the evidence. No final
self-hash is claimed.

## Current status

- TECH PASS and PROCESS PASS apply to the five-path candidate, with zero open
  findings.
- The rebased candidate awaits fresh status review before any coordinator
  commit.
- This dispatch did not stage or commit.
- The coordinator-observed clean-candidate full-hook exit is not restated as a
  fresh replay for this final evidence text; Prettier and diff checks below are
  the only evidence-file gates claimed by this dispatch.

## Pre-final-ledger candidate hook

The exact clean isolated candidate worktree
`/tmp/mm-numeric-commit-v2.CrIeWv/worktree` at parent `6f4867c` ran:

```text
bun run hook:pre-commit
```

Its CWD was that worktree; it started at
`2026-08-24T23:36:13.564567153+0200`, ended at
`2026-08-24T23:38:52.150564542+0200`, and exited 0. The durable transcript is
`/tmp/mm-numeric-final-hook.log`, SHA-256
`f1c3f48a27472c741721afb9105a8f2f7aa1c96057abd53a236c80ea3504ce44`.
It covered exactly these pre-final-ledger candidate bytes:

| Path                                            | SHA-256                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `packages/numeric/src/canonical.ts`             | `19c7851db377537aff0ba4bddd92d9355af221f47c97fb73cc0fd96de8873fb0` |
| `packages/numeric/src/index.ts`                 | `8f6901b4f480a690340c14c935b894b8758611dd980651b8fe98ae68cfd9ec38` |
| `packages/numeric/src/public-api.test.ts`       | `3a622881238c9fc7627d7168c4c04d21dd7ca92414c4d6b1322c2fd9cb969421` |
| `packages/numeric/src/external-decimal.test.ts` | `dd5a81a8a2b4c509ec05e5bb5fbb4de59e149ebc9710a66f300455b95d8a535e` |
| Evidence before this ledger                     | `4fefcf247dea20613089e0e8609bf941aed737c6dfea9dbb4007a193cd5bdef0` |

The hook's worktree inspection listed only those five paths. The two named
ephemeral identity-calculation artifacts were removed before it ran. Only this
evidence ledger changed after the hook; the final self-reference limitation
continues to apply, so this record does not claim an impossible final
self-hash/tree identity.

## Historical four-path snapshot (not the rebased candidate)

The following preserved receipt is a historical 2026-08-24 snapshot for parent
`a9935d5d2bbf8ad52298a3fe91a591397dc9da32`, not evidence for the current
five-path candidate or its parent `6f4867c`. It records ownership of only the
`packages/numeric` external-decimal boundary; no secrets, network access, or
external effects were involved, and unrelated dirty-worktree changes were
excluded.

| Historical candidate path                       | SHA-256                                                            | Lines |
| ----------------------------------------------- | ------------------------------------------------------------------ | ----: |
| `packages/numeric/src/canonical.ts`             | `19c7851db377537aff0ba4bddd92d9355af221f47c97fb73cc0fd96de8873fb0` |   230 |
| `packages/numeric/src/index.ts`                 | `8f6901b4f480a690340c14c935b894b8758611dd980651b8fe98ae68cfd9ec38` |     6 |
| `packages/numeric/src/public-api.test.ts`       | `3a622881238c9fc7627d7168c4c04d21dd7ca92414c4d6b1322c2fd9cb969421` |    16 |
| `packages/numeric/src/external-decimal.test.ts` | `dd5a81a8a2b4c509ec05e5bb5fbb4de59e149ebc9710a66f300455b95d8a535e` |    96 |

The historical direct Bun and package tests each reported 68/68; exact
coverage reported S 201/201, B 158/158, F 41/41, and L 200/200. Prettier,
lint, typecheck, build, and cached diff-whitespace checks passed.

### Historical independent review receipts

| Receipt                                    | Historical candidate identity                                                                                                                                                                      | Route and result                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `TECH-NUMERIC-EXTERNAL-DECIMAL-2026-08-24` | Path `7ae01b85e7f97138d937a285e9109aa32b03c70f51eee0ee9732e6fe9891ec77`; patch `acb541eab01076fb1ef7e4f7a543e8d8576dbe50fd722c23a3272d987ffa14c7`; tree `4d04196ce657ca20f5082f7bfc9ac3f05882cd41` | `terra_reviewer`, profile-pinned `gpt-5.6-terra`, high; TECH PASS, zero open valid findings |
| Historical process review                  | Exact four-path candidate and this evidence record                                                                                                                                                 | `luna_process_reviewer`, `gpt-5.6-luna`, medium; PROCESS PASS, zero open process findings   |

The technical review's canonical task was
`/root/numeric_external_decimal_final_review`; it was an independent,
read-only final technical review of exactly the four candidate paths, with no
edits, staging, commits, network access, or external effects. It inspected the
Bun tuple-only delta, adjudicated the prior PROCESS direct-Bun finding fixed,
and completed on 2026-08-24. Reviewer commands, timestamps, task artifacts,
and per-command log hashes were not supplied and remain not observable.

The process review's canonical task was
`/root/numeric_external_decimal_process_review`; it was read-only over the
four-path candidate and this evidence record, completed on 2026-08-24, and
found the candidate process-eligible. It recorded that commit was not executed
and required separate coordinator or user authorization.

### Historical isolated-index and replay receipts

The historical isolated candidate used ephemeral index
`/tmp/mm-numeric-candidate.xkZdhM/index` and exactly the four sorted paths
above. Its NUL-separated path-list SHA-256 was
`7ae01b85e7f97138d937a285e9109aa32b03c70f51eee0ee9732e6fe9891ec77`; its
binary-patch SHA-256 was
`acb541eab01076fb1ef7e4f7a543e8d8576dbe50fd722c23a3272d987ffa14c7`; its
write-tree-preparation index SHA-256 was
`690c9b3a5d58400c34c61cdcf10c0a2367ab6319a69126b18b8576155092c6a0`; its
reproducible final index SHA-256 after `git write-tree` and diff/path/patch
checks was `bdb155439299bd511669ebdbbc7bd559093d2a0957acf68481ec9e675e915037`;
and its tree was `4d04196ce657ca20f5082f7bfc9ac3f05882cd41`. The historical
candidate stat was four files, +189/-1.

| Historical replay command                                                                                                                                                            | Start / end (Europe/Budapest)                                               | Receipt                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun test packages/numeric/src/external-decimal.test.ts packages/numeric/src/public-api.test.ts`                                                                                     | `2026-08-24T22:57:03.324067008+0200` / `2026-08-24T22:57:03.536063492+0200` | Exit 0; 35/35; `/tmp/mm-numeric-replay.ODSSAo/focused-rerun.log`; SHA-256 `e15d531c5093c55bcca46913a7f41ab12af6cdb0634bb78838cc7d8007119c05`                                                                                                                                                                          |
| `bunx vitest run --config packages/numeric/vitest.config.ts --coverage`                                                                                                              | `2026-08-24T22:57:29.540228664+0200` / `2026-08-24T22:57:30.340037034+0200` | Exit 0; 68/68, S 201/201, B 158/158, F 41/41, L 200/200; `/tmp/mm-numeric-replay.ODSSAo/vitest-coverage.log` SHA-256 `806ccb66dc12ac2ca87323e65ad89489bce7cd0c8f3d7cfc23c1f68483cc1885`; `packages/numeric/coverage/coverage-summary.json` SHA-256 `c87d801740b29df9788d8f0d012d5189f08d4c0be48addd6dae9b04cf3778aaf` |
| `bun run --filter @mm-crypto-bot/numeric typecheck`                                                                                                                                  | `2026-08-24T22:57:43.941152806+0200` / `2026-08-24T22:57:44.852532813+0200` | Exit 0; `/tmp/mm-numeric-replay.ODSSAo/typecheck.log`; SHA-256 `7c08190882825024fac5719961b3e3c56cfacb41fff9defcf283a92754c9b106`                                                                                                                                                                                     |
| `bun run --filter @mm-crypto-bot/numeric build`                                                                                                                                      | `2026-08-24T22:57:50.213293618+0200` / `2026-08-24T22:57:51.155499939+0200` | Exit 0; `/tmp/mm-numeric-replay.ODSSAo/build.log`; SHA-256 `33c3eab549bb7244560a9d9c30ced896c040be54fb0100ec90ed7fbfb501e095`                                                                                                                                                                                         |
| `bunx eslint --max-warnings=0 packages/numeric/src/canonical.ts packages/numeric/src/index.ts packages/numeric/src/public-api.test.ts packages/numeric/src/external-decimal.test.ts` | `2026-08-24T22:57:56.736294122+0200` / `2026-08-24T22:57:58.809125171+0200` | Exit 0; `/tmp/mm-numeric-replay.ODSSAo/scoped-eslint.log`; SHA-256 `4f32d425676debaa50394de37b6dddd27b17338781bd03591a24542fc325079a`                                                                                                                                                                                 |
| `bunx prettier --check packages/numeric/src/canonical.ts packages/numeric/src/index.ts packages/numeric/src/public-api.test.ts packages/numeric/src/external-decimal.test.ts`        | `2026-08-24T22:58:08.325996446+0200` / `2026-08-24T22:58:08.664111136+0200` | Exit 0; `/tmp/mm-numeric-replay.ODSSAo/prettier.log`; SHA-256 `8e05d4303cf9ca1d24372ff2338a1f8c1aaeb2eedf34fe601b22791a6f8e46dc`                                                                                                                                                                                      |
| `git diff --check -- packages/numeric/src/canonical.ts packages/numeric/src/index.ts packages/numeric/src/public-api.test.ts packages/numeric/src/external-decimal.test.ts`          | `2026-08-24T22:58:14.707509005+0200` / `2026-08-24T22:58:14.880791915+0200` | Exit 0; `/tmp/mm-numeric-replay.ODSSAo/diff-check.log`; SHA-256 `f55933df2f8e539a080d91ccd64c60af8176bf227c479b68d0a10fd84bb02dd2`                                                                                                                                                                                    |

The first focused wrapper started at `2026-08-24T22:56:52.410587287+0200`,
ran the same 35/35 test successfully, then used the read-only zsh name
`status`, emitted `read-only variable: status`, and ended without a durable
end timestamp or hash. It was a failed wrapper rather than a failed numeric
test; the focused rerun above is authoritative. The historical package-script
test and coverage wrappers also exited 0, but their output omitted test detail;
the direct Vitest coverage receipt is authoritative for the 68/68 measurement.

Before and after that historical evidence-only work, the real index had 24
cached paths, NUL path-list SHA-256
`37e1c8643f28f3418782c42987dedb904d5eadffd9e6b3039edc15ff7b57289d`, raw
`.git/index` SHA-256
`b800e2bbe3397034f720c7fcf61842eafd4b8af45445ecd3870f0a9cce11c259`, and a
passing real cached diff-whitespace check. The later replay snapshot instead
recorded raw index SHA-256
`b36154912dc3f251160b061f623ba327cab6936ee95282e66ba065f2cd3d89ff` and
stage-entry SHA-256
`ab25fdf3119f3c100bfc7d617bafac1d03585e6be6060ec5131057aa0e120353`; both
are historical observations, not claims about the rebased candidate. The
historic numeric candidate was never added to the real index.
