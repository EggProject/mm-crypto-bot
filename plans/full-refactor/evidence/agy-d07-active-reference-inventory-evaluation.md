# D-07 Agy historical active-reference inventory evaluation

Recorded 2026-08-23 Europe/Budapest. This is a self-contained historical
rejected evaluation record, not implementation authority and not a
routing-quality PASS. The candidate worktree state atop base HEAD
`ad64be3a1f8824e6d6c83f4787c2ed28d109043a` records this five-file bundle and
does not assert a tree or commit identity. It establishes only **COMPLETED TOOL
RUN / REJECTED EVALUATION / ZERO CREDIT** and relies on no external execution
record or review ledger for that disposition. The later 20260823-03 correction
is **TECH FAIL / PROCESS FAIL**; neither lineage grants bootstrap credit, a
routing-quality PASS, a usable recommendation, or a retry.

## Dispatch classification and preflight

Task class: bounded repository-wide read-only inventory/extraction bootstrap
evaluation. Review role: non-review. The snapshot contains exactly 12
workspace package manifests (one app and 11 packages) plus one root manifest,
13 `package.json` files total; this was inspected, not guessed. Ownership was
read-only over the entire 621-file sanitized snapshot and relay output/result
paths, with no repository writes. Domain risk was low source-inventory risk
with material evidence-integrity and permission semantics. Reasoning was
mechanical lexical counting. No external or mutable resource was intended.
Required independent review is Terra technical plus Luna process. There was
no fallback or model escalation: failure/rejection means zero credit and
reclassify or block.

The supplied allowed path was
`/tmp/mm-crypto-bot-agy-d07-inventory-20260823-01`. Attempt A intended
read-only sandbox execution. Attempt B retained `sandbox=true` but had
`readOnly=false` and automatic tool-permission mode, so effective path
confinement is **NOT ATTESTED**, even though only the sanitized snapshot was
supplied.

## Preflight and brief identity

The original shared-worktree preflight recorded 216 status rows and SHA-256
`57ba429e111cd36c6daeedf549868059bf1464cce39a1a2dc30821b9b5836828`. The
filename-only secret scan and active double-quoted secret-assignment scan both
returned zero; no secret values were emitted. The sanitized isolated snapshot
contained 621 files at commit
`6fc07f723b86650330ce7a16bd6ac16cd4a46473`; before/after clean-status hashes
were
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, with
zero status rows.

The historical deployed full brief artifact has SHA-256
`a6e021adcc276ba92e82e64689324d82a821d0f24ad61446cf53197e388056d6`; the
historical retry brief artifact has SHA-256
`2889be936039a8f2a8279b23297efa850ede23cd255e553e4146eeac987f7b21`.
The co-located XML files are archival transcriptions with an explicit
historical-status notice; their current file hashes are not asserted to equal
the retained historical-artifact hashes.

## Attempts

Attempt A requested and dispatched `gemini-3.7-flash-low` / `low`, with
`readOnly=true`, `sandbox=true`, and `dangerous=false`. It failed at denied
`git status` with exit 1; `touchedFiles=[]`, `readOnlyViolation=false`, and
wall time was 7.724 seconds. Result SHA-256 was
`8e46a875621ae4b29b144595ac0c25cff0c4e11dfa02ba287152b01b287f4a26`;
project and
conversation identifiers are retained in the relay result. The historical
record reports prior human authorization for dangerous mode only, but no durable
independent approval artifact was supplied: it is **NOT INDEPENDENTLY
EVIDENCED**.

Attempt B resumed the same conversation with requested/dispatched
`gemini-3.7-flash-low` / `low`. The raw result fields were
`sandbox=true`, `readOnly=false`, and
`dangerouslySkipPermissions=true`. It therefore was not read-only and ran
with automatic tool-permission mode; the claimed human-approval provenance is
**NOT INDEPENDENTLY EVIDENCED**. The sandbox flag is not relied on as the
access/permission boundary. Isolation evidence is instead the dedicated
sanitized snapshot and its unchanged clean-status hash. It completed exit 0
with `touchedFiles=[]`, `readOnlyViolation=null`, and 39.322 seconds wall time.
Result SHA-256 was
`4207cc73fdb47e8a419c61836d8528decc2ec822e226d43c086362f55f3f5ebe`;
final SHA-256 was
`a907cb52ad6c9f3f4b5b1c06c63c1b92979a22bca83d8f79e68f65a993cc71a5`.

Rework turns: **1** (Attempt A initial plus one Attempt B resume/rework).
The earlier nine historical D-07 attempts belong to a different evaluation
and ledger lineage and are excluded from this count.

Provider-effective model/effort were not observable. Input/output/thinking/
cache-token and cost fields were not available in the supported relay
contract. No repository file mutation was observed.

## Independent evaluation and rejected result

The independent local verifier `/tmp/verify-agy-d07-inventory.mjs` has
SHA-256
`636a4434622c4bf9612b820523bc9f213e279add16d18e21a20b861ac154aded`. Its
direct `rg` replay confirms the aggregate counts
and exact top-25 ordering, but the Agy production/tooling `phase` subaggregate
reported **574 lines / 104 files** while the verifier and direct `rg` prove
**916 lines / 152 files**. The other production subaggregates matched:

| Category | Lines | Files |
| -------- | ----: | ----: |
| legacy   |    26 |     9 |
| compat   |    14 |    11 |
| mm-bot   |   128 |    34 |
| run-bot  |    13 |     5 |

Because the material `phase` subaggregate is wrong, this is a **COMPLETED
TOOL RUN / REJECTED EVALUATION**. It earns zero bootstrap credit, establishes
no routing-quality PASS, and its recommendations are not used.

The durable snapshot-time truth uses independent counts only:

| Inventory          | Lines | Files |
| ------------------ | ----: | ----: |
| aggregate          |  3285 |   244 |
| phase              |  3285 |   244 |
| legacy             |    35 |    17 |
| compat             |    24 |    19 |
| mm-bot             |   184 |    45 |
| run-bot            |    31 |    12 |
| production phase   |   916 |   152 |
| production legacy  |    26 |     9 |
| production compat  |    14 |    11 |
| production mm-bot  |   128 |    34 |
| production run-bot |    13 |     5 |

These are snapshot-time counts, not current repository-wide zero-legacy
claims. No file mutation was observed. The official-v2 inventory remains
rejected for the material count and reproducibility defects recorded above.
The distinct 20260823-03 correction is **TECH FAIL / PROCESS FAIL** for the
permission, provenance, and network-scope facts recorded below.

## Routing consequence

The task class remains bootstrap-failed for this Agy route. No recommendation
from either attempt may be used to expand routing or select a routine model.
The recorded outcome is final for this evidence lineage: no further D-07 retry
is authorized or required. The correction result does not become a pass merely
because its inventory numbers match the independent verifier.

## 20260823-03 correction-run record

This is a distinct follow-up run, not a rewrite of Attempts A/B or the
historical official-v2 lineage. The first correction invocation incorrectly
supplied both `--project 2b9bd576-a4b6-44f0-87ea-fa6a4ab7c42a` and
`--conversation d52e3003-1e8c-460c-b13d-d7b577d0ebad`; relay argument
validation exited `2` before creating any result artifact. The corrected relay
command supplied only `--conversation d52e3003-1e8c-460c-b13d-d7b577d0ebad`
for resumption (not `--project`), with the supplied isolated snapshot,
`--sandbox`, and `--dangerously-skip-permissions`.

No durable exact shell-command transcript was recorded for either correction
invocation. Consequently, exact flag ordering, the complete snapshot/brief/
output-path spelling, and the first invocation's complete stdout/stderr cannot
be reconstructed and are **NOT EVIDENCED**. The known arguments above and the
successful run's fields below come from retained relay/result artifacts; they
must not be expanded into a fabricated reproducible command. This provenance
gap is an additional reason the run remains rejected with zero bootstrap
credit.

The corrected relay result is `completed` / exit `0`, Agy `1.1.19`, project
`2b9bd576-a4b6-44f0-87ea-fa6a4ab7c42a`, and conversation
`d52e3003-1e8c-460c-b13d-d7b577d0ebad`, from
`2026-08-23T21:17:41.291Z` to `2026-08-23T21:18:02.534Z`. Requested and
dispatched model/effort are `gemini-3.7-flash-low` / `low`; provider-effective
model and effort are **not observable**. Token, cache, thinking, and cost
fields, including an Antigravity quota/cost proxy, are **not available**. Raw
result fields are `sandbox=true`, `readOnly=false`,
`dangerouslySkipPermissions=true`, `resumed=true`, `touchedFiles=[]`, and
`readOnlyViolation=null`.

The raw dangerous-mode result is not read-only evidence and does not attest
effective path confinement. The dedicated sanitized snapshot is the only
isolation evidence; `--sandbox` cannot be used as a substitute for an
allow/deny permission boundary. The preflight assignment-pattern scan matched
11 files. Their coordinator classification was limited to test
sentinel/placeholder literals and logger redaction-key strings; no values were
retained or emitted, and no secret was copied to these records.

Snapshot identity is commit `6fc07f723b86650330ce7a16bd6ac16cd4a46473`, 621
tracked files, zero status rows, and status-stream SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
The historical correction brief artifact SHA-256 is
`2c88094f8a2e207d1f7a26ce2a81b4c860a13873b9e3caf76ebd2a57f2a1c170`; verifier
SHA-256 is `636a4434622c4bf9612b820523bc9f213e279add16d18e21a20b861ac154aded`.
Result, final, and raw-log SHA-256 values are respectively
`f250fa38ab2c6fdd1fa3a05ff1d45b97d2306d703842fb326e65e27dc8c7629b`,
`a0809d77aa05eb8d90b95e209c1fc8925a6cacb6ce8ad976b66648b717d2c763`, and
`2f7a487a091c94926c7cd12bccbb2798b92d1c6551f5f7999e0a8d15f2b29154`.

Independent verifier runs produced byte-identical JSON (SHA-256
`dd860e190f3a8b392c0094f66420fef462dd07d0915c3997607810ac525aaf77`; `cmp`
exit `0`). Exact inventory results are:

| Scope                  |    Phase | Legacy | Compat | mm-bot | run-bot |
| ---------------------- | -------: | -----: | -----: | -----: | ------: |
| Aggregate lines/files  | 3285/244 |  35/17 |  24/19 | 184/45 |   31/12 |
| Production lines/files |  916/152 |   26/9 |  14/11 | 128/34 |    13/5 |

Therefore inventory-data correctness is **PASS** for this correction run.
However, the raw log records automatic Playwright-driver download attempts:
this is a **HIGH network-scope violation**. The raw log also contains a
personal email address and must not be copied or committed; only this redacted
fact and its hash are retained. Combined with dangerous-mode/non-read-only
semantics, absent provider-effective attestation, and absent quota/cost proxy,
the correction run is **TECH FAIL** and **PROCESS FAIL** overall. It earns zero
bootstrap credit, establishes no routing-quality PASS, makes no routing
recommendation, and must not be retried under this evaluation lineage.
