# Repository Guidelines

This contributor index points to binding requirements in [`.codex/ENGINEERING-STANDARDS.md`](.codex/ENGINEERING-STANDARDS.md); read them before changes. Existing code is not precedent: conform touched code to the standards.

## Product Mission

`mm-crypto-bot` is a multi-strategy, multi-ticker crypto trading bot. Its only live venue/product is Bybit EU Spot Margin via `bybiteu`. Every live order MUST use and verify fixed exactly 10x selected leverage; maximum, range, dynamic, and default leverage are forbidden. Launch baseline: exact USD 1000 account equivalent and exact USD 10000 initial gross exposure. These are targets, not current compliance. Live execution MUST fail closed if account/pair eligibility, borrow eligibility, or exact 10x cannot be verified.

## Repository map

Areas: `apps/bot`, `packages`, `data`, `scripts`; preserve boundaries; never commit secrets.

## Local commands and quality gate

Use pinned Bun; run checks then `bun run verify` (not working until implemented). Evidence must show 100% in-scope unit/E2E coverage for statements, branches, functions, lines.

## Implementation principles

Use strict TypeScript, explicit APIs, pure deterministic functions, exhaustive handling, dependency injection, boundary guards, exact financial values, and tests. Forbid `any`, unsafe assertions, hidden state, ad hoc validation, binary floats, implicit coercion, and lossy serialization; validate configuration, exchange data, datasets, and orders.

Redact secrets, credentials, keys, personal data, sensitive payloads. Live paths fail closed on ambiguity, stale/broken reconciliation, unavailable dependencies, invalid risk state, or errors; paper/test paths state mode. Keep logs structured.

## Workflow and review

Coordinator-led, subagent-only: coordinator assigns briefs/integrates evidence; subagents change scope/report commands, findings, blockers. Use Conventional Commits; PRs state risk, migration, rollback. Two independent technical/process reviews precede closure. Fix every valid finding and independently re-review before completion or commit; no known finding may remain open. Create standalone Hungarian HTML report at `data/reports/<YYYY>/<MM>/<YYYY-MM-DD-HHmm>-session-retrospective.html` only on user request or when coordinator records that HTML materially improves representation or comprehension of substantial results; ordinary completion/status and routine retrospectives need none. Results requiring user decision or materially affecting product goal, trading/risk, security, data, cost, scope, external effects, or governing semantics MUST be discussed with user before change. Low-risk internal findings without user-visible impact MUST be auto-fixed in appropriate repo-local workflow, then independently re-reviewed; mention in final summary. Auto changes MUST NOT lower gates, broaden authority, override higher instructions, or perform external/destructive actions. Governing-file changes normally require separate approval and independent validation, except retrospectively-classified low-risk internal-maintenance findings without user-visible/product-semantic changes; these MUST be auto-fixed under controlled-evolution safeguards in standards and independently validated.

### Model routing

Before every delegation, the coordinator MUST record the task class; read/write
mode; owned files and packages; package count; domain risk; reasoning shape;
external or mutable resources; review role; and required independence.

Terra triggers are: complex or non-bounded work with substantive design
trade-offs; live trading, order, leverage, risk, or strategy behavior; security,
secrets, permissions, data integrity, or governing semantics; multi-package,
public-API, or architecture work; non-local root cause; or ambiguous, deep, or
novel reasoning.

For routing, a task MUST have exactly one review role: independent final
technical review, independent process review, or non-review. Classify the review
role before evaluating Terra triggers.

Apply the first matching route:

1. `terra_reviewer` MUST perform every independent final technical review.
2. `luna_process_reviewer` MUST perform every independent process review.
   This review-role exception applies before Terra triggers.
3. `terra_reader` MUST perform every other non-review read-only task with at
   least one Terra trigger or an explicit user request for a stronger Terra
   route.
4. `terra_worker` MUST perform every write or implementation task with at least
   one Terra trigger or an explicit user request for a stronger Terra route.
   `terra_reviewer`, `terra_reader`, and `terra_worker` use `gpt-5.6-terra`
   with `high` reasoning effort.
5. `luna_reader` MUST perform every remaining eligible read-only task without a
   Terra trigger. `luna_worker` MUST perform routine documentation-only or
   mechanical non-code write tasks without a Terra trigger. Their model and
   reasoning effort MUST match their custom-agent profiles.

If no route matches, the task MUST block before dispatch and the coordinator
MUST reclassify it; an automatically stronger model MUST NOT be selected.

Before dispatch, the coordinator MUST verify that the requested model and
reasoning effort are callable and that the effective sandbox permissions match
the recorded read/write authority. If this verification fails, the coordinator
MUST apply only the fallback specified below or block.

If no Terra trigger is recorded, Terra MUST NOT be selected, except for a
mandatory `terra_reviewer` final technical review or an explicit user request
for a stronger project-defined Terra route. That request means only
`terra_reader` or `terra_worker`, selected by the non-review task's read/write
mode; it MUST NOT select an unconfigured model or profile. An independent
process review MUST use `luna_process_reviewer`, not Terra. "Safer" or "more
capable" alone is not a trigger. An explicit weaker route MUST NOT override a
recorded Terra trigger or a mandatory reviewer route. Use the lowest-cost
eligible route only after it has met the task-class quality gate. For a new task
class, record a provisional bootstrap result, then establish the quality gate on
a representative evaluation set before routine reuse. The gate MUST define
acceptance, critical-error or regression, evidence-completeness, rework, latency,
and cost thresholds on the same representative task set.

Low confidence or a single failed attempt is insufficient for escalation.
Concrete evidence of scope growth, failed validation, inadequate capability, or
a newly discovered risk boundary requires coordinator reclassification.
Subagents MUST NOT change their own model, scope, or ownership.

If `spark_worker` lacks required write authority, `luna_worker` MAY replace it
only for an eligible low-risk task and only after verified effective write
authority; otherwise the task MUST block. An unavailable route or missing
permission MUST NOT justify escalation to Terra. If a required Terra route is
unavailable, the task MUST block.

Run agents in parallel only for independent bounded workstreams, with one writer
per file or package. Every delegation MUST explicitly request its custom-agent
route. Every custom-agent file MUST pin its `model` and
`model_reasoning_effort`; automatic or unpinned selection is non-deterministic.
The TOML `name` field, which MUST be `snake_case`, is the routing source of
truth.
Every delegation and final evidence record MUST include the classification,
requested and effective model and reasoning effort when observable, routing
predicate, sandbox and write authority, ownership, fallback or escalation,
validation, and result.
