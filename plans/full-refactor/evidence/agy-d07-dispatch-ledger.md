# D-07 Agy Dispatch Ledger

**Recorded:** 2026-08-23

## Current disposition

**COMPLETED TOOL RUN / REJECTED EVALUATION.** The official v2 tool run completed
without a relay read-only violation, but independent technical and process
reviews found its inventory invalid. It is not accepted, does not count toward
the at-least-five Agy bootstrap gate, and requires no further D-07 retry for
routing-governance closure.

This is not a provider-model failure. The run's requested/dispatched CLI route
was `gemini-3.7-flash-low` / `low`; provider-effective model and effort are
**not observable**. The relay result has `model` and `effort` fields, but no
separate provider-attestation schema fields. Token, cache, quota, and cost
metrics are **not available**.

## Task classification and authority

| Field                | Recorded value                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Task class           | Read-only lexical repository inventory                                                                                        |
| Product/trading risk | Low; repository confidentiality and permission-boundary risk remains                                                          |
| Reasoning shape      | Bounded mechanical extraction; no design decisions                                                                            |
| Review role          | Non-review; independent technical and process review required before any use                                                  |
| Fallback             | None; no stronger model was selected                                                                                          |
| Scope                | `AGENTS.md`, root `package.json`, `turbo.json`, `apps/**`, `packages/**`, `scripts/**`, and `docs/**`                         |
| Exclusions           | `.git/**`, `node_modules/**`, coverage, `data/**`, `temp/**`, `results/**`, `raw/**`, logs, generated bundles, and `plans/**` |
| Package manifests    | 12 workspace package manifests; root `package.json` was separate                                                              |
| External authority   | No extra directories or network authority; only lexical command use in scope                                                  |

The v1 canonical brief SHA-256 is
`b68a3464db287612c64810cf7deaaab9ee22a67081853f26ace1fc30b184e0ea`.
The successful v2 brief SHA-256 is
`7f7eadc67746c3b32932f35e72921828c45bc1fa6a3cbabf1d5b5258ad98680b`.
Both briefs forbid business, financial, trading, code-organization,
architecture, module-boundary, migration, deletion, and fix decisions.

The user explicitly approved repository exposure and separately approved
`--dangerously-skip-permissions` for D-07 under a read-only/sandbox intent. The
relay rejects combining it with `--read-only`; no dangerous-only dispatch was
used or inferred.

## Permission configuration and official-doc boundary

At the user's explicit request, central user configuration was set outside the
repository in `~/.gemini/antigravity-cli/settings.json` with
`enableTerminalSandbox=true`, and these `permissions.allow` command prefixes:
`rg`, `find`, `wc`, `sort`, `grep`, and the exact `git status --porcelain`
command. No repository configuration was changed. Before I8,
`allowNonWorkspaceAccess=false` was set and verified. After the run, the
settings file omits that default-valued key because Agy normalized sparse
settings; the current configuration must not be represented as retaining an
explicit key. The effective non-workspace boundary relies on the documented
default-off behavior together with `--sandbox` and the workspace roots.

The official [settings documentation](https://antigravity.google/docs/cli/settings/)
identifies the central settings path and default-off/sparse-persistence behavior.
The official
[permissions documentation](https://antigravity.google/docs/cli/permissions/)
documents command-prefix rules. The official
[changelog](https://antigravity.google/changelog) describes interactive chained
Allow Always permission handling. These sources do not document a
noninteractive project-grant writer, a settings-profile selector, or how a
shell pipeline is decomposed for allow matching. That gap explains the three
v1 model-compliance failures below; it does not change the task scope or
authorize a stronger model.

## Preflight and pre-official-run status evidence

Immediately before the first safe relay, the coordinator ran this filename-only
scan; it emits no file content:

```sh
rg --files AGENTS.md package.json turbo.json apps packages scripts docs search-best-config run-bot 2>/dev/null | rg -i '(^|/)(\.env($|\.)|[^/]*(secret|credential|private[-_]?key|api[-_]?key)[^/]*$)' | wc -l
```

Its output was `0`. The pipeline exit was observed as `0` because `wc -l` is
the final command. Without `pipefail`, that does not independently prove the
upstream commands succeeded. The scan conservatively included
`search-best-config` and `run-bot`; neither is in the canonical brief scope.

Before the official v2 run, a prior safe relay captured a pre/post sorted
status comparison: both files had 152 rows, each with SHA-256
`789813e740b0da68858b9f7f193fc782532e3bb6fb16959c87cc18f327377454`, and
`cmp -s current-status.sorted post-touched.sorted` exited `0`. The 152 paths
are intentionally not reproduced because they pre-existed in the shared dirty
worktree.

The official v2 run did **not** capture a separate standalone pre/post status
snapshot. Its relay `touchedFiles` array has 153 entries and matches the
then-current 153-entry status list, but that is not a replacement for an
independent pre/post comparison. `readOnlyViolation=false` is the relay's
complete no-write fingerprint; it supports no repository-write violation, but
does not validate the agent's own inventory or `git status` narrative.

## Attempt and rework record

There were nine recorded attempts: two environment/argument attempts without a
successful relay result, six failed relay executions, and one completed relay
execution. The completed v2 run took approximately 58.43 seconds. Rework is
therefore eight prior attempts; the v1 fresh/resume/resume2 failures are also
model instruction-compliance failures because the agent generated compound
commands outside the granted command shape.

| Attempt | Evidence                                          | Result and disposition                                                                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C0      | Outer Codex sandbox                               | `listen tcp 127.0.0.1:0` environment socket failure; exit `1`; no Agy relay result.                                                                                                                                                                                                             |
| I1      | `/tmp/agy-d07-inventory-20260823/result.json`     | `2026-08-23T18:39:58.605Z`–`18:40:11.443Z`; failed, exit `1`; Agy `1.1.19`; project `296fcc54-79b2-436c-9317-6be8a22a37b0`; conversation `3cfec114-7c03-4c00-88e8-aee74645e32c`; low/low; read-only+sandbox true; dangerous and read-only-violation false. `git status --porcelain` was denied. |
| I2      | `/tmp/agy-d07-safe.rDbm7j/result.json`            | `2026-08-23T18:52:21.133Z`–`18:52:31.732Z`; failed, exit `1`; same project; conversation `9fc2a043-5c5e-4d5d-9855-49cb44102eee`; low/low; read-only+sandbox true; dangerous and read-only-violation false. Headless command permission was denied.                                              |
| I3      | Relay argument validation                         | `--read-only --dangerously-skip-permissions` was rejected as mutually exclusive; exit `2`; no result record.                                                                                                                                                                                    |
| I4      | `/tmp/agy-d07-safe-configured.u9LbKB/result.json` | `2026-08-23T18:55:16.715Z`–`18:55:29.300Z`; failed, exit `1`; project `296fcc54-79b2-436c-9317-6be8a22a37b0`; conversation `37e02da7-033d-422d-8424-c6bd842bd45e`; global allow rules loaded, but the old project had no grants and was cleared.                                                |
| I5      | `/tmp/agy-d07-safe-global.yh8wbm/result.json`     | `2026-08-23T18:55:57.192Z`–`18:56:14.150Z`; failed, exit `1`; fresh project `8d7da7db-dfd0-48aa-9b50-12406d5246a4`; conversation `55b0e7a6-9eee-4d50-a5af-69180508c945`; generated `find` output piped to `sort` was denied.                                                                    |
| I6      | `/tmp/agy-d07-safe-resume.7s3Xqp/result.json`     | Failed, exit `1`; resume generated `find` output piped through `grep` and `sort` despite the prior denial and allowed-prefix boundary.                                                                                                                                                          |
| I7      | `/tmp/agy-d07-safe-resume2.awA0pf/result.json`    | Failed, exit `1`; repeat of the compound-command failure despite delta feedback.                                                                                                                                                                                                                |
| I8      | `/tmp/agy-d07-official.LF4DkX/result.json`        | Completed, exit `0`; official v2 run described below. Its output is rejected by independent review.                                                                                                                                                                                             |

All I4–I8 result records have Agy `1.1.19`, requested/dispatched
`gemini-3.7-flash-low` / `low`, `readOnly=true`, `sandbox=true`,
`dangerouslySkipPermissions=false`, and `readOnlyViolation=false`. I4 has 152
relay touched entries. I5 has 152; I6 and I7 have 153. I6 resumed the I5
project and conversation at `2026-08-23T18:56:57.644Z`–`18:57:19.966Z`; I7 did
the same at `2026-08-23T18:58:11.420Z`–`18:58:20.069Z`. I8 has 153.

## Official v2 completed run and invalid evaluation

The official run result is `/tmp/agy-d07-official.LF4DkX/result.json` with
`final.txt` SHA-256
`78a9206419e4640f22f0e36be3cb79838af048744756153229f1d4e6daef5a1c`.
It recorded Agy `1.1.19`, project `eb1ea61e-03e1-41b8-bfb9-9aea9530158d`,
conversation `dcf06b46-49ba-49a3-aaca-f6b75c233632`,
`gemini-3.7-flash-low` / `low`,
`2026-08-23T19:02:26.036Z`–`2026-08-23T19:03:24.466Z`, `completed`, exit
`0`, `readOnly=true`, `sandbox=true`, `dangerouslySkipPermissions=false`, and
`readOnlyViolation=false`.

Independent review found these exact valid defects in its final inventory:

- `search-best-config` was reported as 25, while its evidence and exact `rg`
  check produce 35.
- The TypeScript-over-500-lines list was reported as 35 but omitted known
  `store.ts` (637 lines at run time; 656 currently); the independent inventory
  found additional omissions.
- Legacy subtotals were internally inconsistent; phase and other counts did not
  agree with the exact checks.
- The test-support semantic classification violated the required reproducible
  lexical classification and is invalid.
- Its final `git status` claimed 146 entries, conflicting with the relay and
  current 153 entries. Command exits and transcript evidence were incomplete.

These defects reject the output without claiming Agy changed any repository
file. The relay's `readOnlyViolation=false` remains no-write evidence; it does
not make false counts or an incomplete transcript acceptable. The result fails
both independent technical and process evaluation and cannot count toward the
bootstrap gate.

## Separate web-research provenance

The earlier isolated model-routing research is not D-07 evidence. Its retained
redacted brief has SHA-256
`cc88841d97835b8325648f49532a81732f1de62003224e630da29fff79fb3a18`.
The relay record is `/tmp/agy-model-routing.Hhv64w/result.json`:
`gemini-3.7-flash-high` / `high`, Agy `1.1.19`, project
`b6f5e387-8ac8-4b0a-ace6-b195cad8ed90`, conversation
`d4846e9b-3f68-4e53-9e53-81fa2fc08abe`,
`2026-08-23T17:33:24.529Z`–`2026-08-23T17:35:22.260Z`, `completed`, exit
`0`, `readOnly=true`, `sandbox=true`, `dangerouslySkipPermissions=false`,
`readOnlyViolation=false`, and `touchedFiles=[]`. Its provider-effective model
and effort are still `not observable`, so it is provisional research evidence,
not a routine evaluation-gate record.
