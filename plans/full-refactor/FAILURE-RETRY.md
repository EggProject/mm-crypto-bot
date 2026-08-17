# Failure and Retry Policy — DRAFT

**Status:** DRAFT. Policy application follows approved plan direction, but no
command, gate, dependency, or external action is executed without its phase
authority and validation evidence.

## Retry matrix

| Condition                                                  | Class                      | Action                                                                                             | Retry bound / evidence                                                                                                  |
| ---------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Transient local process interruption with identical inputs | Retryable                  | Re-run exact command after preserving first output.                                                | At most 2 identical-input retries; third failure blocks and is recorded.                                                |
| Deterministic lint/type/test/build failure                 | Nonretryable until changed | Diagnose; do not repeat unchanged command.                                                         | Preserve output, reproduce once, make scoped correction, rerun relevant gate.                                           |
| Flaky validator                                            | Retryable only to classify | Run same inputs/environment up to 2 times.                                                         | Any disagreement marks validator flaky; block closure, preserve outputs, add deterministic fix, rerun from clean state. |
| Network audit/dependency lookup failure                    | External-evidence failure  | Do not claim audit clean; preserve error and retry only after network availability is established. | At most 2 identical attempts; otherwise block dependency approval/release.                                              |
| Required route unavailable                                 | Nonretryable routing block | Do not escalate automatically; reclassify only with recorded new evidence.                         | Block task; record route/model/effort and absence.                                                                      |
| Interrupted independent review                             | No-result                  | Restart the same required review from current diff/evidence.                                       | No PASS/FAIL inference; record interruption and re-review trigger.                                                      |
| Review finding                                             | Corrective loop            | Fix every valid finding, then independently re-review.                                             | No closure with open valid findings.                                                                                    |
| Secret/data/live-safety evidence failure                   | Critical nonretryable      | Stop affected work, quarantine/redact evidence, fail closed.                                       | Requires user/security owner direction and new validation.                                                              |

## Evidence preservation and continuation

Every failure/retry record retains command, working directory, input/lockfile
hash where relevant, environment identifiers excluding secrets, stdout/stderr,
exit status, timestamp, changed paths, and next action. Continuation resumes
from the last recorded successful gate; it may not use an old green result after
dependency, source, artifact, or validation-scope changes. A changed diff,
validator, route, or approval requires re-review when it alters reviewed scope.

## Re-review triggers

Re-review is mandatory after: any valid review finding fix; changed live/risk,
numeric, DTO/data, dependency, artifact, runtime, or governing evidence; a
flaky-gate repair; an interrupted review; or a final commit/diff change after a
review. The remediation writer is not eligible to mark the re-review PASS.
