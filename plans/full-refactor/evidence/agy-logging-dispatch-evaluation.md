# Agy logging dispatch evaluation

## Initial and delta lineage

The historical isolated task repository was
`/tmp/mm-bot-agy-structured.8YqASC/task`, with clean baseline/preflight. Its
supplied filename and key-pattern scan results were zero, but the exact commands
were not retained, so they are not independently replayable. The initial relay
failed because `node -e` was forbidden: project
`ddc37efc-2a9c-4750-b4db-1c7204197157`, conversation
`dbc36534-9cca-4d54-8ff0-27a822c07b4d`, requested/dispatched
`gemini-3.7-flash-medium`/`medium`, sandbox true, dangerous false,
`readOnly:false`, `readOnlyViolation:null`, touched 0, and
`2026-08-24T02:34:52.898Z`–`02:35:52.320Z`. Brief SHA-256:
`a7b33f28b0a10e03491d7d7482a1be45a04e8af4f0a1383c8678773ba524820d`.

The delta relay used the same IDs/model/effort/sandbox/dangerous values,
`readOnly:false`, and `readOnlyViolation:null`; it exited 0, touched only
`packages/logging/test/e2e/logging-e2e-structured-boundary-cases.ts`, and ran
`2026-08-24T02:36:33.718Z`–`02:39:23.021Z`. It produced 546 lines, 12 lint
errors, an invalid assertion, and a duplicate test, requiring coordinator
rework and a split. Delta SHA-256:
`ccb3bd60e060ec3f77640a143c0e8e2613053eef168e04b0cd5ced9e2d05eb77`.

## Build/test-split attempt — PROCESS NONCOMPLIANT / REJECTED, no edits

The latest separate attempt used brief
`agy-logging-build-test-split-brief.xml` (SHA-256
`f0d75d8723a606ce11cb83c699200905b04940eacb29d15de9c2f11ac8fad0b8`) and
result `/tmp/agy-logging-build-test-split/result.json` (SHA-256
`ecfc0408ea7d6727321ff0c650738df814775dfc87d6176b2f4d3f920285740f`). The
attested schema is `delegate-relay.result.v1`; Agy `1.1.19` requested and
dispatched `gemini-3.7-flash-low`/`low`, with sandbox true, `readOnly:false`,
dangerous false, status `failed`, exit 1, signal null, project
`9b0f7a8a-0908-4621-937d-e327feb330db`, conversation
`188ac7d5-9d03-4af4-a014-6e4d9320f573`, and
`2026-08-24T06:21:26.219Z`–`06:21:37.980Z`. `finalPath` is null,
`finalMessage` empty, and `readOnlyViolation` null.

Headless execution auto-denied a required command permission because it could
not prompt. Mandatory pre-dispatch current Git-status, secret/sensitive-data
scan, and effective allowed-path evidence were not retained and cannot be
recovered. The brief's stated ownership is not evidence of effective allowed
paths. `touchedFiles` is a broad snapshot of the already dirty shared worktree,
not a model-edit list, and is not a substitute for that missing preflight.

This attempt is therefore **PROCESS NONCOMPLIANT / REJECTED**. There is no
final artifact, accepted edit, Agy code change, recommendation, or dependency
of the logging candidate. Effective provider model/effort and token/cost metrics
are not observable from the result contract. It receives zero bootstrap credit,
cannot establish Agy routing quality or implementation evidence, is quarantined
from the logging acceptance lineage, and is not a compliant predecessor or
commit authorization. No dangerous-permission workaround was used. The
coordinator reclassified the work to Terra; logging acceptance rests solely on
the exact Terra-reviewed candidate and its independently rerun gates.

All three attempts remain bootstrap/provisional **FAIL**. They supply no
routine model-routing credit or closure. This document is non-review evidence;
the logging candidate has current independent TECH PASS, while PROCESS
re-review remains pending for closure.

Links: [logging validation](logging-package-validation.md),
[execution record](../EXECUTION-RECORD.md),
[review evidence](../REVIEW-EVIDENCE.md).
