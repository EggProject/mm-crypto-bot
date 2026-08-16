# Repository Guidelines

This contributor index points to binding requirements in [`.codex/ENGINEERING-STANDARDS.md`](.codex/ENGINEERING-STANDARDS.md); read them before changes. Existing code is not precedent: conform touched code to the standards.

## Product Mission

`mm-crypto-bot` is a multi-strategy, multi-ticker crypto trading bot. Its only live venue/product is Bybit EU Spot Margin via `bybiteu`. Every live order MUST use and verify fixed exactly 10x selected leverage; maximum, range, dynamic, and default leverage are forbidden. Launch baseline: exact USD 1000 account equivalent and exact USD 10000 initial gross exposure. These are targets, not current compliance. Live execution MUST fail closed if account/pair eligibility, borrow eligibility, or exact 10x cannot be verified.

## Repository map

Areas: `apps/bot`, `apps/web`, `packages`, `data`, `scripts`; preserve boundaries; never commit secrets.

## Local commands and quality gate

Use pinned Bun; run checks then `bun run verify` (not working until implemented). Evidence must show 100% in-scope unit/E2E coverage for statements, branches, functions, lines.

## Implementation principles

Use strict TypeScript, explicit APIs, pure deterministic functions, exhaustive handling, dependency injection, boundary guards, exact financial values, and tests. Forbid `any`, unsafe assertions, hidden state, ad hoc validation, binary floats, implicit coercion, and lossy serialization; validate configuration, exchange data, datasets, and orders.

Redact secrets, credentials, keys, personal data, sensitive payloads. Live paths fail closed on ambiguity, stale/broken reconciliation, unavailable dependencies, invalid risk state, or errors; paper/test paths state mode. Keep logs structured.

## Workflow and review

Coordinator-led, subagent-only: coordinator assigns briefs/integrates evidence; subagents change scope/report commands, findings, blockers. Route to Terra, Luna, or GPT-5.3-Codex-Spark. Use Conventional Commits; PRs state risk, migration, rollback. Two independent technical/process reviews precede closure. Fix every valid finding and independently re-review before completion or commit; no known finding may remain open. Create standalone Hungarian HTML report at `data/reports/<YYYY>/<MM>/<YYYY-MM-DD-HHmm>-session-retrospective.html` only on user request or when coordinator records that HTML materially improves representation or comprehension of substantial results; ordinary completion/status and routine retrospectives need none. Results requiring user decision or materially affecting product goal, trading/risk, security, data, cost, scope, external effects, or governing semantics MUST be discussed with user before change. Low-risk internal findings without user-visible impact MUST be auto-fixed in appropriate repo-local workflow, then independently re-reviewed; mention in final summary. Auto changes MUST NOT lower gates, broaden authority, override higher instructions, or perform external/destructive actions. Governing-file changes normally require separate approval and independent validation, except retrospectively-classified low-risk internal-maintenance findings without user-visible/product-semantic changes; these MUST be auto-fixed under controlled-evolution safeguards in standards and independently validated.
