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
