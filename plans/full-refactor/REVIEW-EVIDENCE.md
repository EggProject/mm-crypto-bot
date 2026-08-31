# Review Evidence Ledger — DRAFT

## RE-087 Current logging technical review and process-remediation record

Recorded `2026-08-24` Europe/Budapest. This record supersedes stale current
logging claims in RE-076; RE-076 remains historical evidence only. The exact
temporary-index review snapshot before this self-recording evidence addendum
has 98 allow-listed paths (79 package paths plus
approved root integration/evidence paths), sorted-list SHA-256
`2e8ad511ca16eb29b21ef1db88114cf1a0751e41b49d098a52b43a848818faf5`, binary
patch SHA-256 `ae7d456df677f3a5b2d4d81c5b5bd53c49e592e46de0696fd55780c9b32d782a`,
and tree `2009143100d9df5f7983731dfc4e3c49999f262e`. It has 16,661 insertions,
21 deletions, zero unmerged entries, zero unexpected allow-list paths, and a
passing cached diff check. It retains HEAD CCXT 4.5.64 and excludes staged CCXT
4.5.75 and all unrelated bot/exchange/shared/ledger work, apart from two
additive consumer logging-dependency lines. The shared real index is preserved
and explicitly excluded as a commit source.

The final snapshot `/tmp/mmcb-logging-stage.jrsjNQ` passed frozen install (496
packages), lint, typecheck, typecheck:e2e, build, 57/57 unit
(S452/B371/F85/L411 exact 100%), 19/19 genuine subprocess E2E
(S450/B371/F85/L409 exact 100%), 318/318 infrastructure Vitest
(S1220/B642/F234/L1120 exact 100%), and tooling boundaries 6/6. A first
candidate scan found a hard-coded repository-root literal in a publisher
`fstat` test; the narrow `REPOSITORY_ROOT` repair yields zero such literals in
the exact review snapshot. Root `coverage:full` remains unclaimed because known
unrelated package failures remain.

The repaired implementation snapshot received a fresh independent
`terra_reviewer` **TECH PASS** with zero valid findings. The final independent
`luna_process_reviewer` returned **PROCESS PASS** with zero open valid findings
for the isolated temporary logging-only index candidate tree
`84f4d781dff662ed8cfa245cb68c7d67162e56cf`, after Agy quarantine. The review
tree predates this status addendum; the eventual commit tree differs only by
this final evidence status, not by reviewed implementation, test, config,
package, or lock content.

Commit is authorized **only** from that reviewed temporary logging-only index.
The shared real combined index and every unrelated staged path are forbidden as
a commit source and must be preserved. The failed Agy build/test-split relay
remains **PROCESS NONCOMPLIANT / REJECTED**: it has zero bootstrap credit and
no review, implementation, routing-quality, predecessor, or commit-authority
role. Logging acceptance rests solely on the independently reviewed candidate
and exact gates above. Root `coverage:full` remains unclaimed because known
unrelated package failures remain. See [logging validation](evidence/logging-package-validation.md), [Agy evaluation](evidence/agy-logging-dispatch-evaluation.md),
and [ER-087](EXECUTION-RECORD.md).

**Status:** TECH PASS / PROCESS PASS. Earlier FAIL rows remain part of the
evidence chain; the current PASS is limited to this logging candidate and
creates no broader repository, release, or live-trading PASS. Decision approval
does not replace implementation evidence.

## Current C4a/C4b remediation state

**RE-078 P-03/P-04 correction:** Full relay hashes are brief
`a6e021adcc276ba92e82e64689324d82a821d0f24ad61446cf53197e388056d6`, retry
`2889be936039a8f2a8279b23297efa850ede23cd255e553e4146eeac987f7b21`, Attempt
A `8e46a875621ae4b29b144595ac0c25cff0c4e11dfa02ba287152b01b287f4a26`, Attempt
B `4207cc73fdb47e8a419c61836d8528decc2ec822e226d43c086362f55f3f5ebe`, B final
`a907cb52ad6c9f3f4b5b1c06c63c1b92979a22bca83d8f79e68f65a993cc71a5`, and
verifier `636a4434622c4bf9612b820523bc9f213e279add16d18e21a20b861ac154aded`.
Historical RE-078 FAIL remains preserved; RE-080 is TECH PASS only for the
historical official-v2 lineage. The later 20260823-03
correction is TECH FAIL / PROCESS FAIL and its evidence remediation is pending
re-review.

**RE-078 table-row status:** The historical RE-078 table row is
**HISTORICAL TECH FAIL, SUPERSEDED BY RE-080** for technical status. Current
official-v2-lineage status is **TECH PASS via RE-080; PROCESS FAIL remediation
pending re-review**. Overall current D-07 correction status remains **TECH FAIL
/ PROCESS FAIL pending re-review**.

**RE-080 P-05/P-06 command detail:** The reviewer recorded `sha256sum` exit
0; `jq` field validation exit 0; the snapshot `cd` plus four Git commands,
each exit 0; the verifier `jq` plus direct `rg` transaction exit 0; scoped Git
diff exit 0; and scoped `git diff --check` exit 0. The direct-`rg` transaction
used `set -o pipefail` and exited 0 overall; individual `rg` `$pipestatus`
values were NOT RECORDED. Prettier, lint, and tests were NOT RUN. Current state
for the historical official-v2 lineage is TECH PASS via RE-080; historical
RE-078 FAIL is superseded by RE-080 for that lineage's technical status only.
The later 20260823-03 correction remains TECH FAIL / PROCESS FAIL pending
re-review.

**RE-080 verbatim command transcript:**

```text
/usr/bin/sha256sum plans/full-refactor/evidence/agy-d07-active-reference-inventory-brief.xml plans/full-refactor/evidence/agy-d07-active-reference-inventory-permission-retry.xml /tmp/agy-d07-active-reference-inventory-result-20260823-01/result.json /tmp/agy-d07-active-reference-inventory-result-20260823-02/result.json /tmp/agy-d07-active-reference-inventory-result-20260823-02/final.txt /tmp/verify-agy-d07-inventory.mjs
# exit 0
/usr/bin/jq '{model,effort,sandbox,readOnly,dangerouslySkipPermissions,status,exitCode,touchedFiles,readOnlyViolation,startedAt,finishedAt}' /tmp/agy-d07-active-reference-inventory-result-20260823-{01,02}/result.json
# exit 0
cd /tmp/mm-crypto-bot-agy-d07-inventory-20260823-01
git rev-parse HEAD
git status --porcelain=v1 | wc -l
git status --porcelain=v1 | /usr/bin/shasum -a 256
git ls-files | wc -l
# each exit 0; outputs: 6fc07f723b86650330ce7a16bd6ac16cd4a46473, 0, e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, 621
bun /tmp/verify-agy-d07-inventory.mjs /tmp/mm-crypto-bot-agy-d07-inventory-20260823-01 | /usr/bin/jq '{aggregate,production,top25: .top25[0:25]}'
# exit 0
git diff -- plans/full-refactor/evidence/agy-d07-active-reference-inventory-evaluation.md plans/full-refactor/EXECUTION-RECORD.md plans/full-refactor/REVIEW-EVIDENCE.md
# exit 0
git diff --check -- plans/full-refactor/evidence/agy-d07-active-reference-inventory-evaluation.md plans/full-refactor/EXECUTION-RECORD.md plans/full-refactor/REVIEW-EVIDENCE.md
# exit 0
```

The ten direct production pipelines were executed under `set -o pipefail`:

```text
set -o pipefail
/usr/lib/chatgpt/resources/rg --pcre2 --line-number --no-heading '\bPhase[ _-]*[0-9][A-Za-z0-9._-]*' apps packages scripts .github | wc -l # 916
/usr/lib/chatgpt/resources/rg --pcre2 --line-number --no-heading '\bPhase[ _-]*[0-9][A-Za-z0-9._-]*' apps packages scripts .github | cut -d: -f1 | sort -u | wc -l # 152
/usr/lib/chatgpt/resources/rg --pcre2 --line-number --no-heading '\blegacy\b' apps packages scripts .github | wc -l # 26
/usr/lib/chatgpt/resources/rg --pcre2 --line-number --no-heading '\blegacy\b' apps packages scripts .github | cut -d: -f1 | sort -u | wc -l # 9
/usr/lib/chatgpt/resources/rg --pcre2 --line-number --no-heading '\b(?:backward|backwards?)[ -]?compat(?:ibility|ible)?\b' apps packages scripts .github | wc -l # 14
/usr/lib/chatgpt/resources/rg --pcre2 --line-number --no-heading '\b(?:backward|backwards?)[ -]?compat(?:ibility|ible)?\b' apps packages scripts .github | cut -d: -f1 | sort -u | wc -l # 11
/usr/lib/chatgpt/resources/rg --pcre2 --line-number --no-heading '(?<!crypto-)mm-bot' apps packages scripts .github | wc -l # 128
/usr/lib/chatgpt/resources/rg --pcre2 --line-number --no-heading '(?<!crypto-)mm-bot' apps packages scripts .github | cut -d: -f1 | sort -u | wc -l # 34
/usr/lib/chatgpt/resources/rg --pcre2 --line-number --no-heading 'run-bot' apps packages scripts .github | wc -l # 13
/usr/lib/chatgpt/resources/rg --pcre2 --line-number --no-heading 'run-bot' apps packages scripts .github | cut -d: -f1 | sort -u | wc -l # 5
# enclosing transaction exit 0; individual $pipestatus values NOT RECORDED
```

The enclosing transaction exited 0. Individual `$pipestatus` values were NOT
RECORDED; no per-pipeline exit is inferred. Prettier, lint, and tests were
NOT RUN.

| RE-080 | Independent final technical review of the historical official-v2 Agy D-07 evidence. Recorded `2026-08-23T22:53:46+0200 CEST`; route `terra_reviewer`; model `gpt-5.6-terra`; effort `high`; read-only. Inspected evaluation, ER-070, RE-078, sanitized snapshot metadata, and verifier artifacts. | `sha256sum`, `jq` field checks, snapshot Git `HEAD`/status/hash/`ls-files`, verifier `jq` plus direct `rg` production counts, scoped Git diff, and `git diff --check` all exited 0. Prettier, lint, and tests were NOT RUN. **TECH PASS for that historical lineage only**, zero technical findings. | Historical-official-v2 evidence-integrity TECH PASS only; no source-gate or implementation-quality claim. Historical rejected/zero-credit result remains. Its **PROCESS FAIL remediation remains pending re-review**. The later 20260823-03 correction is **TECH FAIL / PROCESS FAIL pending re-review**. |

## RE-081 D-07 correction-run evidence disposition

This is a non-review evidence disposition, not a substitute for an independent
review. It preserves all earlier D-07 rows. The first correction relay usage
combined `--project 2b9bd576-a4b6-44f0-87ea-fa6a4ab7c42a` and
`--conversation d52e3003-1e8c-460c-b13d-d7b577d0ebad`, exited `2`, and created
no result artifact. The corrected dispatch used only the conversation identifier
and produced `completed` / exit `0` with Agy `1.1.19`, project
`2b9bd576-a4b6-44f0-87ea-fa6a4ab7c42a`, requested/dispatched
`gemini-3.7-flash-low` / `low`, and provider-effective model/effort **not
observable**. It ran `2026-08-23T21:17:41.291Z`–`2026-08-23T21:18:02.534Z`.
Token/cache/thinking/quota/cost fields and a cost proxy are **not available**.

The complete shell-command transcript for neither correction invocation was
preserved. Exact flag ordering, full snapshot/brief/output-path spelling, and
the first invocation's complete stdout/stderr are **NOT EVIDENCED** and cannot
be reconstructed. The retained artifacts support only the stated arguments and
result fields; no reproducible command is inferred. This unresolved provenance
gap keeps the correction process rejected and zero-credit.

Relay facts are `sandbox=true`, `readOnly=false`,
`dangerouslySkipPermissions=true`, `resumed=true`, `touchedFiles=[]`, and
`readOnlyViolation=null`; dangerous approval does not transform that into a
read-only run or prove an effective path boundary. The isolated snapshot remains
commit `6fc07f723b86650330ce7a16bd6ac16cd4a46473`, 621 tracked files, zero
status rows, status SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Brief/verifier/result/final/raw-log hashes are
`2c88094f8a2e207d1f7a26ce2a81b4c860a13873b9e3caf76ebd2a57f2a1c170`,
`636a4434622c4bf9612b820523bc9f213e279add16d18e21a20b861ac154aded`,
`f250fa38ab2c6fdd1fa3a05ff1d45b97d2306d703842fb326e65e27dc8c7629b`,
`a0809d77aa05eb8d90b95e209c1fc8925a6cacb6ce8ad976b66648b717d2c763`, and
`2f7a487a091c94926c7cd12bccbb2798b92d1c6551f5f7999e0a8d15f2b29154`.

Two independent verifier JSON runs were byte-identical (SHA-256
`dd860e190f3a8b392c0094f66420fef462dd07d0915c3997607810ac525aaf77`; `cmp`
exit `0`), proving inventory-data correctness: aggregate phase 3285/244,
legacy 35/17, compat 24/19, mm-bot 184/45, run-bot 31/12; production phase
916/152, legacy 26/9, compat 14/11, mm-bot 128/34, run-bot 13/5. The content
preflight had 11 matches, classified solely as test sentinel/placeholder
literals and logger redaction-key strings; no values were retained.

The raw log documents automatic Playwright-driver download attempts, a **HIGH
network-scope violation**, and contains a personal email address that is neither
quoted nor committed. Thus the correction run is **TECH FAIL / PROCESS FAIL**
despite its correct inventory. It earns zero bootstrap credit, establishes no
routing-quality PASS, supplies no usable recommendation, and must not be
retried. No source gate, implementation claim, commit authorization, or broader
PASS follows from this record.

**RE-077 correction (process re-review):** The tracked D-07 diff is only
`config.ts` and `config.test.ts`. The E2E driver is wholly untracked and has
no `HEAD` version; current 37 `assertCondition` callsites and zero
`validateConfigForEdit` references are present-state evidence only. Historical
E2E consumer removal is not Git-provable. Any earlier wording implying a
tracked E2E removal is superseded by this correction.

**RE-078 TECH remediation correction:** Attempt B raw fields are
`sandbox=true`, `readOnly=false`, and `dangerouslySkipPermissions=true`. It was
not read-only and used automatic tool-permission approval; the sandbox flag is
not relied on as the access/permission boundary. Isolation is evidenced by the
dedicated sanitized snapshot and unchanged clean status. The historical
review is **HISTORICAL TECH FAIL, SUPERSEDED BY RE-080** for technical status.
The historical official-v2 lineage is **TECH PASS via RE-080; PROCESS FAIL
remediation pending re-review**. The later 20260823-03 correction remains
**TECH FAIL / PROCESS FAIL pending re-review**.

**RE-078 PROCESS remediation:** Full dispatch classification, exact
12-workspace-package/13-manifest count, 621-file read scope, supplied allowed
path, low inventory/evidence-integrity risk, mechanical counting, no intended
external resource, required Terra technical plus Luna process review, and
no-fallback/reclassify-on-failure rule are recorded in the evaluation
evidence. Rework is exactly 1 (A initial plus B resume); nine historical D-07
attempts are explicitly excluded as a different lineage. Full SHA-256 values
for all artifacts are recorded there and in ER-070. Historical rejected result
and the official-v2-lineage TECH PASS remain preserved; that lineage's
**PROCESS FAIL remediation remains PENDING RE-REVIEW**. The later 20260823-03
correction remains **TECH FAIL / PROCESS FAIL pending re-review**.

| RE-078 | D-07 Agy active-reference inventory evaluation review record. Recorded 2026-08-23 Europe/Budapest. Evidence-only Luna route; no source/test/config ownership, staging, commit, or external resource. It records the 216-row preflight, sanitized 621-file snapshot, brief/result/final/verifier hashes, both attempt flags and exit/timing fields, and absence of secret output. | Independent replay confirms aggregate/top-25 data but rejects the Agy production/tooling `phase` subaggregate (Agy 574/104; verifier/direct `rg` 916/152). Independent durable snapshot counts are recorded in [the evaluation](evidence/agy-d07-active-reference-inventory-evaluation.md). | **HISTORICAL TECH FAIL, SUPERSEDED BY RE-080** for the official-v2 lineage's technical status. That lineage is **TECH PASS via RE-080** with **PROCESS FAIL remediation pending re-review**. The later 20260823-03 correction is **TECH FAIL / PROCESS FAIL pending re-review**. Both completed tool runs receive zero bootstrap credit; no routing-quality PASS or recommendation is accepted. |

| RE-079 | C4c market-event-controller process-review remediation. Recorded 2026-08-23 Europe/Budapest. Non-review documentation-only writer; package count 0; ownership limited to C4c plan/evidence ledgers; no source/test/config mutation, staging, commit, external resource, or product decision. ER-071 records the Terra implementation route `terra_worker` / `gpt-5.6-terra` / high, exact three-file ownership, and workspace-write authority. | The missing execution provenance and Agy-to-Terra scope delta are now explicit: Agy specified eight scenarios but implemented zero; Terra delivered ten approved scenario tests plus two approved boundary tests, 12 total/45 assertions, including heterogeneous ATR and invalid-symbol/tick-counter rationale. File sizes are recorded as 268/466/114, all <=500 lines. Agy remains separate and receives zero bootstrap credit. | Both reviewer findings are remediated at evidence level. **PENDING INDEPENDENT PROCESS RE-REVIEW**; technical PASS remains limited to the prior Terra review and no commit/broader PASS is authorized. |

| RE-077 | D-07 config CLI removal process-evidence remediation. Recorded `2026-08-23` Europe/Budapest. Non-review evidence writer `luna_worker` / Luna profile / medium, workspace-write, exact evidence and plan-ledger ownership only; no source/test ownership, staging, commit, or external resource. | The remediation records exact unit multiset/expectation accounting, the three removed helper tests and four assertions, current E2E `assertCondition` callsites, and the fact that the HEAD E2E baseline is unavailable because the driver is untracked. It categorizes the bounded `formatToml` decomposition, naming/import/error handling, fixture, and stale Phase-comment cleanup. Scoped lint/format, 23/23 unit, direct E2E driver, diff-check, file-size, and current-symbol scans are recorded; exchange errors block bot/E2E typecheck and build. | **PROCESS FAIL REMEDIATION PENDING RE-REVIEW.** The 40/39 E2E discrepancy remains explicitly unresolved because neither report is reproducible from the available Git baseline; no invented count is treated as evidence. D-07 overall and zero-legacy remain open due to the separate `run-bot`/`mm-bot` deployment-config dependency. |

### RE-076 C4c central logging implementation evidence — historical

Recorded `2026-08-18T06:25:15+0200` as a non-review `terra_worker` evidence
entry. Its 27-test counts and missing-review state are historical and are not
current logging validation claims. **Superseded for current logging review and
process status by RE-087.** It authorizes no commit or repository-wide PASS.

### RE-073 C4b independent-review closure

Ledger recording timestamp `2026-08-18T04:18:31+0200` Europe/Budapest. Scope:
the current C4b exact-numeric foundation diff only (`packages/numeric/**`, the
exact lock resolution, and C4b plan/evidence). Review completion timestamps,
worktree identity, and exact commands are **NOT OBSERVED** in the supplied
reviewer results.

`terra_reviewer` / `gpt-5.6-terra` / high / read-only returned **TECH PASS**
with zero open valid findings. `luna_process_reviewer` / `gpt-5.6-luna` /
medium / read-only returned **PROCESS PASS** with zero open valid findings.
The closure covers the ER-056 fixed-BigInt precheck, exact-rational public
boundary, package gates and coverage, dependency evidence, and the corrected
evidence lineage. ER-056 remains the sole current C4b implementation/evidence
record; ER-052 through ER-055 and RE-067 through RE-072 are historical.

This PASS authorizes only the separate C4b commit. It does not establish a
repository-wide lint/test/verify, release, data, or live-trading PASS.

### RE-074 C4a independent technical review closure

Ledger recording timestamp `2026-08-18T05:15:30+0200` Europe/Budapest. Review scope:
current C4a RxJS prototype-removal scope (`temp/ts/rxjs/**`, root lint scripts,
tooling contract test, and C4a evidence). Independent reviewer identity,
completion timestamp, and exact command text are **NOT OBSERVED** in this record.

`terra_reviewer` / `gpt-5.6-terra` / high / read-only returned **TECH PASS**
with zero open valid findings for this scoped diff. This PASS is limited to the
scoped C4a evidence only.

### RE-075 C4a process review closure

Ledger recording timestamp `2026-08-18T05:15:30+0200` Europe/Budapest. Review scope:
current C4a scope-owned closure and commit readiness. Independent reviewer identity,
completion timestamp, and exact command text are **NOT OBSERVED** in this record.

`luna_process_reviewer` / `gpt-5.6-luna` / medium / read-only returned
**PROCESS PASS** with zero open valid findings for this scoped C4a diff. This
pass does not make repository-wide lint, broad tests, full verify, release, or
live-trading PASS.

### RE-072 C4b evidence-lineage correction

Ledger recording timestamp `2026-08-18T04:14:16+0200` Europe/Budapest.
Evidence-only, non-review writer: `terra_worker` / `gpt-5.6-terra` / high /
workspace-write. Scope is C4b plan evidence only; no numeric source/test,
config, lock, generated artifact, external resource, provider, trading, hook,
consumer, or Git action. Independent reviewer identity, completion timestamp,
commands, findings, and adjudication are **NOT OBSERVED**.

ER-057 makes ER-056 the sole current C4b implementation/evidence record;
ER-052 through ER-055 and RE-067 through RE-071 are historical evidence only. It makes no
implementation claim and does not change the current fixed-BigInt behavior or
gate evidence. **PENDING TECHNICAL AND PROCESS RE-REVIEW** remains the only
current C4b review state.

### RE-071 C4b fixed-BigInt precheck correction

Ledger recording timestamp `2026-08-18T04:11:45+0200` Europe/Budapest.
Non-review writer: `terra_worker` / `gpt-5.6-terra` / high / workspace-write.
Scope is C4b numeric source/tests and evidence only; no network, lock mutation,
provider, trading, hook, consumer, or Git action. Independent reviewer identity,
completion timestamp, commands, findings, and adjudication are **NOT OBSERVED**.

Historical record at its recording time. ER-056 replaces the string-length magnitude precheck with the fixed exclusive
BigInt bound, adds direct and arithmetic overflow contracts, and records the
scoped/restored `BigInt.prototype.toString` proof plus its Bun-runner mock
limitation. The source change invalidates prior process PASS coverage; both
independent re-reviews are **PENDING**. No implementation, package, repository,
full-verify, release, data, or live-trading PASS is created.

### RE-070 C4b receiver and resource-bound correction

Ledger recording timestamp `2026-08-18T04:05:47+0200` Europe/Budapest.
Non-review writer: `terra_worker` / `gpt-5.6-terra` / high / workspace-write.
Scope is C4b numeric source/tests and evidence only; no network, lock mutation,
provider, trading, hook, consumer, or Git action. Independent reviewer identity,
completion timestamp, commands, findings, and adjudication are **NOT OBSERVED**.

ER-055 adds uniform proxy-receiver typed errors, the central 1024-digit exact
integer resource limit, direct/adversarial bound contracts, current 33-pass V8
100% evidence, and corrected raw-`rg` versus wrapper exit semantics. **PENDING
TECHNICAL AND PROCESS RE-REVIEW.** It invalidates any C4b current-diff
conclusion predating ER-055 and creates no implementation, package, repository,
full-verify, release, data, or live-trading PASS.

### RE-069 C4b portability correction

Ledger recording timestamp `2026-08-18T03:52:32+0200` Europe/Budapest.
Non-review writer: `terra_worker` / `gpt-5.6-terra` / high / workspace-write.
Scope is C4b numeric guard/tests and evidence only; no external resource, lock
mutation, provider, trading, hook, consumer, or Git action. Independent
reviewer identity, completion timestamp, commands, findings, and adjudication
are **NOT OBSERVED**.

ER-054 replaces the engine-format-specific native Object comparison with a
current-realm reference comparison, adds the fake-constructor custom
null-parent-prototype negative, and binds the current 18-pass/520-expectation
run plus final V8 LCOV hash. **PENDING TECHNICAL AND PROCESS RE-REVIEW.** This
invalidates any current-diff conclusion predating ER-054 and creates no
implementation, package, repository, full-verify, release, data, or
live-trading PASS.

## RE-082 CCXT 4.5.75 review-remediation state

Classification: non-review evidence remediation after an independent process
review **FAIL**. Writer route requested/effective `terra_worker` /
`gpt-5.6-terra` / high; observed workspace-write authority. The review roles
required for closure remain independent `terra_reviewer` technical and
`luna_process_reviewer` process. No fallback/escalation, staging, commit,
source, manifest, lock, or external action occurred in this remediation.

The process finding is remediated in
[`ccxt-4.5.75-upgrade-validation.md`](evidence/ccxt-4.5.75-upgrade-validation.md):
it records the full dispatch contract; shared-hunk exclusion/staged-patch
strategy; the absence of a task-time baseline as **NOT EVIDENCED**; corrected
endpoint-probe lineage; and the distinct ESM/CJS results. It also records
remaining validation failures without claiming a pass.

Current disposition: **PENDING TECHNICAL AND PROCESS RE-REVIEW**. The ESM
`4.5.74` self-identification inside the npm-resolved `4.5.75` artifact is a
**HIGH upstream release-integrity blocker**. Owner: upstream CCXT and the
dependency slice. Required resolution is an upstream corrected artifact or
official clarification followed by exact-latest revalidation; user-required
`4.5.75` remains pinned and no downgrade, range, local patch, or live-readiness
claim is authorized. A CCXT-only commit is additionally blocked until reviewed
staging proves separation from shared dirty-worktree hunks.

## RE-083 CCXT 4.5.75 technical-review remediation pending re-review

Classification: non-review implementation remediation after technical and
process findings. Writer route requested/effective `terra_worker` /
`gpt-5.6-terra` / high; workspace-write observed. Required independent roles
for re-review are `terra_reviewer` technical and `luna_process_reviewer`
process. Ownership, package count (four workspace declarations plus root/lock),
live/public-API/supply-chain domain risk, external npm/GitHub/Bun resources,
and no-fallback decision are recorded in ER-083 and the CCXT validation ledger.
Terra trigger: live exchange dependency + public API + multi-package
lockfile/supply-chain change => terra_worker.

Pending reviewers must inspect: exact fixture `copy()` semantics; public-only
feed test seams; resolved-artifact metadata provenance against the active exact
manifest pin and its malformed/name/missing/range/version-mismatch negatives;
read/resolver and semantic-version boundary negatives; focused V8 four-metric
100% evidence for both in-scope helpers from the repo-owned focused
configuration; intentional CCXT trust/lifecycle removal including the observed
Lefthook reporting limitation; extraction parity; current docs; and shared-worktree
scope contamination. They must rerun the stated gates and determine whether
the ESM `4.5.74` self-report remains the HIGH upstream release-integrity
blocker. No reviewer result exists yet. Status: **PENDING TECHNICAL AND PROCESS
RE-REVIEW**; no final dependency, live-readiness, release, or commit PASS.

## RE-084 CCXT 4.5.75 independent review closure

Recorded `2026-08-24T00:32:22+0200` Europe/Budapest. The independent final
technical review used `terra_reviewer` / `gpt-5.6-terra` / high / read-only;
the independent process review used `luna_process_reviewer` / `gpt-5.6-luna` /
medium / read-only. Both report **PASS** with zero closable-slice findings.
Reviewer identifiers, exact command text, timing, and sandbox telemetry are
**NOT OBSERVED** in this ledger; the coordinator supplied the final statuses.

The reviewed scope is the exact ER-084 CCXT slice: four `4.5.75` manifest
pins/root lock; exchange compatibility and public-feed tests; backtest
provenance/calculation sources, tests, and focused V8 configuration; trust
contract; current CCXT documentation; and the CCXT validation/ER/RE evidence
files. Review accepted the recorded frozen/no-script, untrusted, package-list,
and audit evidence; exchange **395/395** and exact-10 **16/16** tests; focused
backtest **19/54** and V8 **122/110/30/112**; recorded backtest/shared/bot
consumer gates; and `git diff --check` PASS.

Closure is strictly scoped. The ESM `4.5.74` self-report in the exact `4.5.75`
artifact is a **HIGH upstream release-integrity blocker**: no live-readiness or
final dependency PASS follows. Exchange test-inclusive TypeScript remains
separately **NOT PASS**. Commit preparation requires reviewed staging that
excludes concurrent logging hunks, the exchange `./testing` export, shared
`./logger` export removal, related lock entries, and unrelated C4c work. The
only proposed message is `build(deps): update ccxt to 4.5.75`; no stage or
commit occurred.

## Required review schema

| Field                          | Requirement                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Review ID / objective / scope  | Stable ID, objective and inspected paths.                                             |
| Diff / commit / worktree       | Exact revision(s), dirty status, and diff identity.                                   |
| Independence / route           | Reviewer relationship, exactly-one role, route/model/effort/sandbox.                  |
| Commands / evidence            | Directly inspected files and exact command output references.                         |
| Findings / status              | Each finding with validity and `PASS`, `FAIL`, `INTERRUPTED`, or `PENDING RE-REVIEW`. |
| Fix / re-review / adjudication | Corrective change, independent rerun, and adjudication rationale when applicable.     |

## Active review ledger

The active detailed review ledger continues without deletion in [review-evidence/part-01.md](review-evidence/part-01.md). It includes the D-11/D-12 actual-commit range-review failure record and remains the required review evidence entrypoint.
