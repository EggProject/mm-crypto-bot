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
5. Every remaining non-review task MUST receive an Antigravity (`agy`)
   eligibility assessment before dispatch. A bootstrap Agy task is
   evaluation-only: it MUST be bounded, isolated, low-risk, single-owner work,
   pin matching exact model-slug and `--effort` suffixes, use an isolated
   workspace or worktree, and receive independent review. The first at least
   five representative tasks for a model/task class MAY use this route only to
   establish its local evaluation record; it is not a routine default. A
   bootstrap failure MUST record its failure and rework, then reclassify or
   block under the existing Luna/Terra routes; it MUST NOT automatically select
   a stronger model. After that evaluation passes, an eligible Agy task MUST
   use the lowest-cost model that passed the repository-local task-class
   evaluation: `gemini-3.7-flash-low` only for sufficiently large batched
   read-only inventory or extraction; `gemini-3.7-flash-medium` for bounded,
   isolated, low-risk, single-owner implementation, tests, or documentation;
   and `gemini-3.7-flash-high` for difficult coding, research, or medium-
   complexity multi-file work. A Terra-triggered task MAY use Agy only as an
   auxiliary, never as its sole authority. `gemini-3.1-pro-high` is permitted
   only as an evaluated secondary high-complexity research or implementation
   route beside the required Terra owner or reviewer. `gemini-3.1-pro-low` is
   not a routine route. `gemini-3.6-*` requires documented `gemini-3.7-*`
   unavailability or regression evidence; `gemini-3.5-*` is not selectable.
6. If no eligible evaluated Agy route applies, `luna_reader` MUST perform the
   remaining read-only task and `luna_worker` MUST perform routine
   documentation-only or mechanical non-code work. Their model and reasoning
   effort MUST match their custom-agent profiles.

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

An Agy delegation MUST use one bounded XML brief with explicit ownership,
acceptance gates, validation, and report contract. It MUST pin the exact model
slug and matching CLI `--effort` suffix (`*-high` with `high`, `*-medium` with
`medium`, and `*-low` with `low`) without treating effort as a separate cost or
pricing dimension. The coordinator MUST verify that the relay command and
result record the requested/dispatched pair and exit/status. Repository write
work MUST use a dedicated isolated
worktree/workspace containing only brief-owned files or packages, or effective
allow/deny permissions that prove the same boundary; direct write access to a
shared dirty worktree is forbidden. Before dispatch, the coordinator MUST
record `git status`, a secret/sensitive-data scan, actual allowed paths, and
effective sandbox/permission configuration; inability to prove the boundary
blocks dispatch. Read-only research MUST use `--read-only --sandbox`; repository
data requires explicit scope/approval and a redaction scan, otherwise it MUST
use an empty workspace. `--dangerously-skip-permissions` requires explicit
human approval. Agy MUST NOT self-review or commit. The coordinator MUST
inspect the supported relay `result.json` contract: `status`,
`readOnlyViolation`, `touchedFiles`, requested/dispatched model and effort,
sandbox, read-only, dangerous, identifiers, and timing when available. Effective
model and effort MUST be recorded only when the selected supported tool attests
them; otherwise they are `not observable`. A mismatch in observable attested
data MUST fail and block; absence of attestation is not a mismatch. An
unattested model/effort result may remain provisional evidence but MUST NOT
prove a model/task class for the routine evaluation gate. The coordinator MUST
inspect the actual diff including staged and untracked files, rerun the required
gates, obtain independent reviews, and perform any commit.

Agy MUST NOT make business-logic, financial, trading, code-organization,
architecture, or module-boundary decisions. It MAY only execute a pre-decided,
fully specified plan. Every brief MUST explicitly state the required behavior,
output, file/module structure, owner, invariants, prohibitions, acceptance
gates, and exact boundaries. A missing requirement, ambiguity, new design
trade-off, or required organizational decision MUST stop and block the Agy task
with a report to the coordinator; Agy MUST NOT infer, expand scope, or select
an architecture.

For test implementation, Agy is mechanical only. The coordinator or Terra
MUST pre-decide and specify every business scenario, event/state sequence,
inputs, expected outputs, errors, logs, state transitions, financial invariant
(including exact 10x for live paths), public test boundary, allowed fake/mock,
prohibited fabricated/private state, owned test/support files, production-file
prohibition, and validation/coverage gate. Agy MUST NOT choose scenarios,
expected business behaviour, acceptance semantics, coverage scope or threshold,
architecture, module boundaries, or production changes. Ambiguity, conflicting
behaviour, a missing public seam, suspected product defect, dead/unreachable
branch, or a required production/test-architecture change MUST block and be
reported. Private casts, `any`, disables, impossible-state mocks, assertion
padding, weakened thresholds/scopes, and production edits are forbidden. Risk
and trading scenario design and acceptance remain Terra authority; resulting
tests require independent `terra_reviewer` technical and
`luna_process_reviewer` process review. Agy never self-reviews or commits.
Sufficiently large coherent test batches are permitted to reduce coordinator
tokens only under one bounded brief and ownership; unrelated scenarios MUST NOT
be bundled. Tests use evaluated `gemini-3.7-flash-medium` when bounded and
simple; `gemini-3.7-flash-high` is auxiliary-only for complex multi-file tests
with pre-decided scenarios; low is never a code-write route. Repository
read/write access also requires explicit risk-informed user approval plus
preflight redaction/secret scan and isolation; a general Agy request is not
such approval, and sanitized or empty workspaces remain preferred.

An unproven Agy task class or model is bootstrap-only until at least five
representative repository-local tasks pass with zero critical error,
regression, security violation, or trading violation. Each evaluation MUST
prove brief acceptance, exact scope, required gates, no weakened checks, and an
independent review, plus observable independently attested model and effort; a
`not observable` record remains provisional and MUST NOT count toward the five.
Each evaluation MUST record rework turns, wall time, available
input/output/thinking/cache tokens or `not available` when the supported relay
contract does not report them, and an Antigravity quota/cost proxy.
`gemini-3.7-flash-medium` becomes the default only after that gate. Escalation
to `gemini-3.7-flash-high` requires concrete scope-growth, validation-failure,
or capability evidence. `gemini-3.1-pro-high` requires evidence of better
quality or lower rework sufficient to justify its relative quota cost.

Antigravity shared-quota consumption is a relative API-pricing-ratio proxy, not
an assertion that Gemini API dollar prices equal Agy billing. The detailed
evidence, operating contract, and source links are in
`plans/full-refactor/ANTIGRAVITY-ROUTING.md`.

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
