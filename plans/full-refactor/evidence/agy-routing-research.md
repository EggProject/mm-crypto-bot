# Agy Routing Web-Research Evidence

**Recorded:** 2026-08-23
**Evidence status:** completed isolated research run; provisional routing evidence,
not a routine model-class approval.

## Classification

| Field                           | Value                                               |
| ------------------------------- | --------------------------------------------------- |
| Task                            | Web benchmark and model-routing research            |
| Read/write mode                 | Read-only                                           |
| Owned packages                  | 0                                                   |
| Domain risk                     | Cost and governance research                        |
| Reasoning shape                 | Complex comparative research                        |
| Review role                     | Non-review                                          |
| Requested/dispatched route      | `gemini-3.7-flash-high` with `high` effort          |
| Effective provider model/effort | `not observable` from relay 0.5.0                   |
| Routing predicate               | Explicit user request plus comparative web research |
| External resources              | Public documentation and benchmark pages            |
| Fallback                        | None                                                |
| Required independence           | Independent source verification after the run       |

## Isolation and result

The research ran in an empty isolated workspace class without repository data.
Its reported execution settings and result were:

| Field                           | Value                                  |
| ------------------------------- | -------------------------------------- |
| Agy version                     | 1.1.19                                 |
| Delegate relay version          | 0.5.0                                  |
| Sandbox                         | `true`                                 |
| Read-only                       | `true`                                 |
| Dangerous permissions           | `false`                                |
| Status                          | `completed`                            |
| Exit code                       | `0`                                    |
| Read-only violation             | `false`                                |
| Touched files                   | `[]`                                   |
| Project ID                      | `b6f5e387-8ac8-4b0a-ace6-b195cad8ed90` |
| Conversation ID                 | `d4846e9b-3f68-4e53-9e53-81fa2fc08abe` |
| Token/cache/thinking metrics    | `not available` from relay 0.5.0       |
| Structured JSON-schema evidence | `not available` from relay 0.5.0       |

The relay result is the supported evidence path. This run predates the final
dispatch contract, so it is not claimed compliant with that contract. The
relay's model/effort fields identify the requested/dispatched options; they are
not independent provider-side model/effort attestation. This result remains
provisional and cannot prove a routine model/task-class gate.

## Redacted brief summary

Research the available Gemini model variants using current public benchmark,
capability, pricing-ratio, and operational documentation. Recommend
cost-aware routing, with no access to repository content and no workspace
modification.

The full external response and payload are intentionally not retained here.

## Independent verification

The research claims were checked against the following sources:

- [Antigravity CLI usage](https://antigravity.google/docs/cli/using/),
  [headless mode](https://antigravity.google/docs/cli/headless/), and
  [permissions](https://antigravity.google/docs/cli/permissions)
- [Antigravity sandbox](https://antigravity.google/docs/cli/sandbox/),
  [settings](https://antigravity.google/docs/cli/settings/), and
  [shared quota pricing ratio](https://antigravity.google/blog/changes-to-antigravity-plans)
- [Gemini 3.7 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash),
  [latest-model guidance](https://ai.google.dev/gemini-api/docs/latest-model),
  and [pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini 3.7 Flash model card](https://deepmind.google/models/model-cards/gemini-3-7-flash/),
  [Gemini 3.6 Flash model card](https://deepmind.google/models/model-cards/gemini-3-6-flash/),
  [Gemini 3.5 Flash model card](https://deepmind.google/models/model-cards/gemini-3-5-flash/),
  [Gemini 3.1 Pro model card](https://deepmind.google/models/model-cards/gemini-3-1-pro/)
- [Artificial Analysis: Gemini 3.7 Flash](https://artificialanalysis.ai/models/gemini-3-7-flash)

## Final classification

**PROVISIONAL — NOT ROUTINE.** A model/task class requires at least five
representative repository-local bootstrap tasks with independent review, zero
critical error/regression/security/trading violation, exact scope, and passing
gates before routine use. The evaluation records must include rework turns,
wall time, available metrics or `not available`, and a relative quota/cost proxy.

## Current access evidence

D-07's repository-access approval, redaction scan, configured permission
boundary, relay attempts, and independent rejection of its completed v2 output
are recorded separately in the
[D-07 dispatch ledger](agy-d07-dispatch-ledger.md). The completed tool run is
not an accepted inventory and does not establish a model/task-class evaluation
record.

The active routing contract is aligned across [AGENTS.md](../../../AGENTS.md),
the [engineering standards](../../../.codex/ENGINEERING-STANDARDS.md), and the
[Luna worker configuration](../../../.codex/agents/luna-worker.toml). This
research evidence remains provisional and does not approve any Agy model/task
class for routine use.
