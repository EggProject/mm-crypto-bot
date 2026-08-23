# Antigravity Routing and Evidence

**Date:** 2026-08-23
**Status:** provisional routing contract for the full refactor; no Agy model/task
class is a routine route until its local evaluation gate passes.

## Purpose and boundary

Antigravity (`agy`) is an auxiliary researcher or implementer for cost-aware
work. It does not replace a mandatory Terra final technical reviewer or Luna
process reviewer, cannot review its own output, and cannot commit. The binding
routing summary is [AGENTS.md](../../AGENTS.md).

Before every dispatch, the coordinator records task class, read/write mode,
exclusive file or package ownership, package count, domain risk, reasoning
shape, external or mutable resources, review role, and required independence.
Mandatory Terra/Luna first-match routing is decided before Agy eligibility.

## Verified local capability

- `agy` 1.1.19 and delegate relay 0.5.0 are callable.
- The callable exact model slugs are `gemini-3.7-flash-{high,medium,low}`,
  `gemini-3.6-flash-{high,medium,low}`, `gemini-3.5-flash-{high,medium,low}`,
  and `gemini-3.1-pro-{high,low}`.
- An isolated `gemini-3.7-flash-high` web-research run completed with
  `readOnly=true`, `sandbox=true`, `dangerous=false`, and no touched files.
  It is evidence for the research dispatch only, not for routine model use.

## Dispatch contract

Each Agy delegation has exactly one bounded XML brief with objective,
in-scope/out-of-scope boundary, exclusive ownership, write authority,
acceptance gates, validation, expected report, exact model slug, and required
independence. The agent cannot expand its scope, authority, model, or ownership.

Agy cannot make business-logic, financial, trading, code-organization,
architecture, or module-boundary decisions. It only executes a pre-decided,
fully specified plan. Every brief must explicitly define required behavior,
output, file/module structure, owner, invariants, prohibitions, acceptance
gates, and exact boundaries. A missing requirement, ambiguity, new design
trade-off, or required organizational decision stops and blocks the task with a
report to the coordinator; Agy cannot infer, expand scope, or choose an
architecture.

The model slug and `--effort` suffix must agree: `*-high` with `high`,
`*-medium` with `medium`, and `*-low` with `low`. The relay command and result
must record that requested/dispatched pair and a successful exit/status. The
relay fields are not independent provider-side model/effort attestation.
Effective model/effort is recorded only when the selected supported tool
actually attests it; otherwise record `not observable`. A mismatch in observable
attested data fails and blocks. Missing attestation is not a mismatch, but it
cannot prove a model/task class for the routine evaluation gate. Effort is a
reasoning-variant selection, not an independent cost or pricing dimension.

The supported `agy-delegate` relay 0.5.0 path and its `result.json` are
mandatory. The coordinator records and inspects `status`, `readOnlyViolation`,
`touchedFiles`, requested/dispatched model and effort, sandbox, read-only,
dangerous, identifiers, and timing when available. Effective model and effort
are recorded only when independently attested by the selected supported tool;
otherwise the record explicitly says `not observable`. Token, cache, and
thinking metrics are recorded only when this approved path actually reports
them; otherwise the record explicitly says `not available`. No direct-Agy
invocation or alternate path may be used to bypass this contract.

Repository write work must run only in a dedicated isolated worktree/workspace
that contains only brief-owned files or packages, or with effective allow/deny
permission rules that enforce the same boundary. Direct write access to a shared
dirty worktree is forbidden. Before dispatch, record `git status`, a
secret/sensitive-data scan, actual allowed paths, and the effective
sandbox/permission configuration. If the boundary cannot be proven, block.

Read-only research uses `--read-only --sandbox`. Repository data additionally
requires explicit data scope/approval and a redaction scan; otherwise use an
empty workspace. `--dangerously-skip-permissions` requires explicit human
approval. It MUST NOT be represented as compatible with `--read-only` or as
providing sandbox-enforced read-only protection.

After completion, the coordinator inspects the relay outcome and the actual
staged, unstaged, and untracked diff, reruns required gates, obtains independent
reviews, and performs any commit.

## Test-implementation operating contract

Agy may mechanically implement tests, including tests around trading or risk
code, only from one bounded brief in which the coordinator or Terra has already
decided every business scenario, event/state sequence, input, expected output,
error, log, state transition, financial invariant (including exact 10x on live
paths), public test boundary, allowed mock/fake, prohibited fabricated/private
state, exact owned test/support file, forbidden production file, and validation
and coverage gate.

Agy must not choose scenarios, business behaviour, expected results, acceptance
semantics, coverage scope/thresholds, architecture, module boundaries, or
production changes. It must stop, block, and report any ambiguity, conflicting
behaviour, missing public seam, suspected product defect, dead/unreachable
branch, or required production/test-architecture change. Private casts, `any`,
disables, impossible-state mocks, assertion padding, scope/threshold weakening,
and production edits are prohibited.

Terra retains mandatory authority for risk/trading scenario design and
acceptance. Each Agy-implemented test task requires an independent
`terra_reviewer` technical review and `luna_process_reviewer` process review;
Agy never self-reviews or commits. A brief may batch sufficiently large coherent
test work to reduce coordinator-token use, but must retain one bounded ownership
set and must not bundle unrelated scenarios.

Test implementation remains subject to the bootstrap/effective-attestation
gate. An evaluated `gemini-3.7-flash-medium` may implement bounded simple tests.
`gemini-3.7-flash-high` may implement complex multi-file tests only as an
auxiliary with pre-decided scenarios. Low is never a code-write route.

Any repository read/write exposure for Agy test work requires explicit
risk-informed user approval, preflight redaction/secret scanning, and an
isolated workspace boundary. A general request to use Agy does not grant this
approval. Prefer sanitized or empty workspaces.

## Routing matrix

| Model                     | Eligible task                                                                         | Limitation                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `gemini-3.7-flash-low`    | Sufficiently large batched read-only inventory or extraction                          | Never for trivial inline work or code writes.                                     |
| `gemini-3.7-flash-medium` | Bounded, isolated, low-risk, single-owner implementation, tests, or documentation     | Routine default only after the local gate passes; test scenarios are pre-decided. |
| `gemini-3.7-flash-high`   | Difficult coding, research, or medium-complexity multi-file work                      | Auxiliary only when a Terra trigger exists; tests require pre-decided scenarios.  |
| `gemini-3.1-pro-high`     | Secondary high-complexity research or implementation                                  | Requires mandatory Terra owner/reviewer and demonstrated evaluation benefit.      |
| `gemini-3.1-pro-low`      | None                                                                                  | Not a routine route.                                                              |
| `gemini-3.6-*`            | Same task-class fallback after documented `gemini-3.7-*` unavailability or regression | Attach evidence to the dispatch record.                                           |
| `gemini-3.5-*`            | None                                                                                  | Not selectable.                                                                   |

The official Gemini 3.7 guidance identifies medium as the default, low for
lower latency, and high for difficult mathematics and coding. It documents a
one-million-token context and a 65K output limit. Public per-effort benchmark
data is incomplete; routing must not invent an effort-specific ranking.

## Bootstrap evaluation gate

For a new model/task class, the first at least five representative
repository-local tasks are an explicit evaluation-only bootstrap route. Each
must be bounded, isolated, low-risk, single-owner work, use a matching
slug/effort pair, and receive independent review. It is not a routine default
before the gate passes. A record with `not observable` effective model/effort
can remain provisional evidence, but cannot count as proof for the routine
model/task-class gate.

All five records must prove:

- every brief acceptance requirement;
- exact ownership and no scope expansion;
- every required gate passed with no weakened check;
- independent review;
- observable independently attested effective model and effort;
- zero critical error, regression, security violation, or trading violation.

Each record measures rework turns, wall time, available
input/output/thinking/cache metrics or `not available`, and a relative
Antigravity quota/cost proxy. `gemini-3.7-flash-medium` becomes the routine
default only after this gate passes. A bootstrap failure records the failure and
rework, then reclassifies or blocks under the existing Luna/Terra route; it does
not automatically select a stronger model. `gemini-3.7-flash-high` requires
concrete scope-growth, failed-validation, or capability evidence.
`gemini-3.1-pro-high` requires measured quality or rework improvement
sufficient to justify its relative quota cost.

Antigravity shared-quota consumption is a relative API-pricing-ratio proxy.
Gemini API dollar prices must not be represented as Agy billing.

## Isolated web-research evidence

| Field                           | Recorded value                                                             |
| ------------------------------- | -------------------------------------------------------------------------- |
| Classification                  | Cost/governance web benchmark and routing research                         |
| Read/write mode                 | Read-only                                                                  |
| Owned packages                  | 0                                                                          |
| Domain risk                     | Cost and governance research                                               |
| Reasoning shape                 | Complex comparative research                                               |
| Review role                     | Non-review                                                                 |
| Requested/dispatched route      | `gemini-3.7-flash-high` / `high`                                           |
| Effective provider model/effort | `not observable` from relay 0.5.0                                          |
| Routing predicate               | Explicit user request and comparative web research                         |
| Workspace class                 | Empty isolated workspace; no repository data                               |
| Sandbox/read-only/dangerous     | `true` / `true` / `false`                                                  |
| Fallback                        | None                                                                       |
| Result                          | `completed`, exit code `0`, `readOnlyViolation=false`, `touchedFiles=[]`   |
| Tool versions                   | Agy 1.1.19; delegate relay 0.5.0                                           |
| Project ID                      | `b6f5e387-8ac8-4b0a-ace6-b195cad8ed90`                                     |
| Conversation ID                 | `d4846e9b-3f68-4e53-9e53-81fa2fc08abe`                                     |
| Token/cache/thinking metrics    | `not available` from relay 0.5.0                                           |
| Structured JSON-schema evidence | `not available` from relay 0.5.0                                           |
| Compliance status               | The run predates this final contract; it is not claimed compliant with it. |
| Final classification            | Provisional; not routine until the five-task gate passes.                  |

Redacted brief summary: compare the available Gemini models using current
public benchmark, capability, pricing-ratio, and operational documentation;
produce a cost-aware routing recommendation without accessing repository files
or modifying any workspace content. The original external report/payload is not
included here.

The research claims were independently checked against the primary and
benchmark sources below. They are not a substitute for repository-local
evaluation.

## Current repository-access evidence

The reproducible D-07 dispatch facts, configured permission boundary, and
independent rejection of the completed v2 inventory are recorded in the
[D-07 dispatch ledger](evidence/agy-d07-dispatch-ledger.md). D-07 is a
completed tool run but a rejected evaluation: it does not establish an Agy
model/task-class gate and needs no retry for routing-governance closure.

The active contract is aligned in [AGENTS.md](../../AGENTS.md), the
[engineering standards](../../.codex/ENGINEERING-STANDARDS.md), and the
[Luna worker configuration](../../.codex/agents/luna-worker.toml). This removes
the routing-text inconsistency only; all Agy model/task-class gates remain
provisional until their independent five-task evaluation records pass.

## Sources

- [agy-delegate skill v0.5.0](https://github.com/amElnagdy/delegate-skills/blob/master/skills/agy-delegate/SKILL.md)
- [Antigravity CLI usage](https://antigravity.google/docs/cli/using/), [headless mode](https://antigravity.google/docs/cli/headless/), and [execution modes](https://antigravity.google/docs/cli/modes/)
- [Permissions](https://antigravity.google/docs/cli/permissions), [sandbox](https://antigravity.google/docs/cli/sandbox/), [settings](https://antigravity.google/docs/cli/settings/), and [CLI reference](https://antigravity.google/docs/cli/reference/)
- [Subagents](https://antigravity.google/docs/cli/subagents/), [models](https://antigravity.google/docs/models/), [usage](https://antigravity.google/docs/cli/commands/usage), [credits](https://antigravity.google/docs/cli/credits), and [changelog](https://antigravity.google/changelog)
- [Shared quota and pricing ratio](https://antigravity.google/blog/changes-to-antigravity-plans)
- [Gemini 3.7 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash), [latest-model guidance](https://ai.google.dev/gemini-api/docs/latest-model), and [API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini 3.7 Flash model card](https://deepmind.google/models/model-cards/gemini-3-7-flash/), [3.6 Flash model card](https://deepmind.google/models/model-cards/gemini-3-6-flash/), [3.5 Flash model card](https://deepmind.google/models/model-cards/gemini-3-5-flash/), and [3.1 Pro model card](https://deepmind.google/models/model-cards/gemini-3-1-pro/)
- [Artificial Analysis: Gemini 3.7 Flash](https://artificialanalysis.ai/models/gemini-3-7-flash)
