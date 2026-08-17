# Full Refactor Plan — DRAFT

**Status:** DRAFT — no implementation authority is granted by this plan.

## Purpose

This directory is the proposed controlled migration plan for `mm-crypto-bot`.
It records observed evidence, target requirements, open decisions, sequencing,
and acceptance evidence. It is developer documentation and is therefore
English under `.codex/ENGINEERING-STANDARDS.md`.

No document in this directory authorizes a production, security, data,
governing-policy, release-platform, or live-trading change. All material plan
decisions D-01 through D-09 are approved in [APPROVALS.md](APPROVALS.md), but
their implementation and validation gates remain unperformed.

## Reading order

1. [GOAL.md](GOAL.md) — measurable outcome, scope, and stop conditions.
2. [DECISIONS.md](DECISIONS.md) and [APPROVALS.md](APPROVALS.md) — choices
   and the sole machine-auditable approval record.
3. [ARCHITECTURE.md](ARCHITECTURE.md) — target package graph, RiskGate, and
   exact financial/accounting boundaries.
4. [MIGRATION.md](MIGRATION.md) — staged, reversible implementation sequence.
5. [VALIDATION.md](VALIDATION.md) — gates and plan-package self-check.
6. [EXECUTION-RECORD.md](EXECUTION-RECORD.md),
   [FAILURE-RETRY.md](FAILURE-RETRY.md), and
   [REVIEW-EVIDENCE.md](REVIEW-EVIDENCE.md) — routing, failure, and review
   evidence.
7. [RISKS.md](RISKS.md) and [ROLLBACK.md](ROLLBACK.md) — safety controls.
8. [DEPENDENCIES.md](DEPENDENCIES.md), [SCRIPTS.md](SCRIPTS.md), and
   [ARTIFACTS.md](ARTIFACTS.md) — supply chain, commands, and release design.

## Document status vocabulary

| Term                | Meaning                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `OBSERVED`          | Verified from the current worktree; command is named where useful.                 |
| `REQUIRED TARGET`   | Binding requirement from `AGENTS.md` or engineering standards.                     |
| `PROPOSAL`          | A recommendation only; it must not be implemented yet.                             |
| `APPROVED`          | User-approved scope; implementation, validation, and review still apply.           |
| `TO VERIFY`         | The inventory or evidence is incomplete; execute the stated command before acting. |
| `NOT YET EVIDENCED` | A planned test/check has not been run or does not prove the claim.                 |

## Current observed baseline

- `apps/bot` is the only workspace application. Six workspace packages exist:
  `backtest`, `backtest-tools`, `core`, `exchange`, `paper`, and `shared`.
- `search-best-config/` exists outside the workspace and has no package
  manifest. `run-bot/config/` is versioned inside the repository.
- `bin/mm-bot`, a root `postinstall`, root `mm-bot` scripts, and the bot
  package `bin` field implement the alias chain requested for removal.
- The root has TypeScript `6.0.3`, Bun `1.3.14`, and Turbo `2.10.2`; not all
  dependency ranges are exact pins.
- Current source and test inventories contain files over 500 lines. The plan
  requires decomposition before the migrated file becomes authoritative.
- Current code/config evidence shows dynamic or maximum leverage semantics and
  JavaScript-number financial values. It must not be described as conforming to
  the fixed exactly-10x or exact-numeric target until later proof exists.
- No current evidence proves canonical starting equity/gross exposure values,
  authoritative valuation binding, an unbypassable central RiskGate, immutable
  live configuration lifecycle, deterministic release ZIPs, or icon licensing.
  These are required target gaps, not accepted risks.
- D-04 permits CCXT Pro public market-data research/ingestion only; it grants no
  credential, account, order, borrow, margin, paper, or live-execution authority.
- D-07 requires a zero-legacy final repository. There is no `docs/legacy/`
  target; Git history remains the sole history. Protected formal reports under
  `data/reports/` retain the governing-standard protection.

## Control rule

This plan is intentionally complete enough to guide implementation, but it is
not a substitute for approval. Any contradiction between this draft and binding
repository standards is resolved in favor of the standards and escalated to the
user before modification.
