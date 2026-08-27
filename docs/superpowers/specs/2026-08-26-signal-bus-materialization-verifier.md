# SignalBus Materialization Verifier Specification

## Status and scope

This specification defines a separate root `scripts/tooling` verifier that is a prerequisite for the
SignalBus draft. The first slice has no hook or CI integration, package-manifest change, runtime or trading
dependency, network access, staging, or commit. It operates only on explicitly supplied local Git worktrees
and a versioned manifest. Invalid, ambiguous, partial, or unsupported input fails verification; the verifier
never repairs or infers a success.

## Threat model and explicit scope decision

This verifier is a cooperative local build/process tool. It runs after the sole materialization writer has
stopped; no malicious or concurrent actor may mutate the toolchain root, manifest, or candidate tree during
one invocation. The verifier fails closed for an ordinary symlink or path-traversal condition observed while
it inspects an input, and for malformed or unexpected Git state observed during that invocation.

It does not provide a kernel-enforced guarantee against hostile concurrent filesystem mutation or a
time-of-check/time-of-use race. Per the explicit user decision, this slice has no `openat2` dependency, native
addon, immutable producer handoff, or equivalent descriptor-based protocol. Runtime configuration changes are
out of scope and require a separate validated configuration-reload design; they are not a reason to harden
this verifier's input paths.

## CLI contract

```text
bun scripts/tooling/verify-signal-bus-materialization.ts \
--mode=baseline|candidate|history \
--toolchain-root=<trusted verifier worktree> \
--candidate-root=<target worktree> \
--manifest=<versioned absolute manifest> \
--role=active|exact \
[--brief=<canonical brief>] [--base=<40hex>] [--approval=<40hex>]
```

Every option is supplied exactly once except `--brief`, `--base`, and `--approval`, which are
mode-gated. `baseline` and `candidate` require `--base`; `history` requires `--base` and
`--approval`; `--brief` is optional only when the manifest contains exactly one canonical brief. In
`history` mode it identifies only the requested terminal brief; it never narrows the history transaction.
On a history pass, the returned digest is the requested brief's latest valid materialization digest. A later
materialization of another brief must not replace that result.
All
roots and the manifest path are absolute. The manifest is a regular file outside both worktrees. All supplied
root and manifest components must be non-symlink paths when inspected. Both roots canonicalize to their Git
top-level; the toolchain root binds the actual `import.meta.url` source. The manifest and candidate files use
one nofollow read-time identity check per read. Symlinked components, malformed Git roots, duplicate or unknown
options, and malformed values fail. These checks apply at inspection time under the cooperative threat model.

The command writes one deterministic JSON result to stdout and diagnostics to stderr. Exit codes are zero for
a pass, one for verification failure, and two for malformed invocation.

Direct execution compares `fileURLToPath(import.meta.url)` with `path.resolve(process.argv[1])`; it must not
compare an encoded URL pathname with a decoded argv path. The direct-entry regression builds the executable in a
directory whose path contains a space, supplies malformed input, and requires exit two with exactly
`signal-bus-materialization:invocation\n` on stderr.

## Manifest contract

The strict JSON manifest has this exact versioned shape. Unknown keys, duplicate JSON object keys,
non-canonical strings, an empty materialization list, duplicate paths, duplicate
`(brief, owner, path)` triples, or a role mismatch fail.

```ts
export type MaterializationRole = "active" | "exact";
export type AllowedMaterializationOperation = "create" | "modify" | "delete";

export interface SignalBusMaterializationEntry {
  readonly role: MaterializationRole;
  readonly path: SafeRepoRelativePath;
  readonly owner: CanonicalOwner;
  readonly allowedOperation: AllowedMaterializationOperation;
  readonly prerequisite: readonly CanonicalBrief[];
  readonly brief: CanonicalBrief;
}

export interface SignalBusMaterializationManifestV1 {
  readonly schemaVersion: 1;
  readonly role: MaterializationRole;
  readonly materializations: readonly SignalBusMaterializationEntry[];
}
```

Entries form a complete expected-path bijection: each path occurs once. `owner` matches
`[a-z0-9][a-z0-9._-]*`; `brief` and every prerequisite match `[A-Z][A-Z0-9-]{2,127}`. A prerequisite
cannot reference itself and must name a brief represented in the manifest. The entry role, path, owner,
allowed operation, prerequisite, and brief are required declared input and never defaults.

`SafeRepoRelativePath` matches exactly
`[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*`. It rejects absolute paths, traversal, empty
segments, backslashes, tabs, newlines, NUL or any control character, escape, spaces, and every special path
outside the grammar. Validate each manifest and observed Git path before joining it to a root.

Governed manifest, candidate, and history-tree files are strict UTF-8 text: C0 controls, including NUL, fail
except tab, CR, and LF. Every present governed candidate/history-tree file is regular, nofollow, and at most
500 physical lines; 501 fails.

## Canonical materialization and digest

The canonical materialization is the path-sorted final state, not intermediate index/worktree operations.

```ts
export interface CanonicalMaterializationRecord {
  readonly operation: "A" | "M" | "D";
  readonly path: SafeRepoRelativePath;
  readonly blobIdentity: `git:${Lowercase<string>}` | "absent";
}
```

`A` means absent at base and present in final state; `M` means present at both with different Git blob
identity; `D` means present at base and absent at final state. A present identity must match exactly
`git:[a-f0-9]{40}`; the TypeScript template literal documents its shape but the parser enforces lower-case
40-hex length. Deletion uses literal `absent`. Sort records by bytewise POSIX path and hash UTF-8 lines exactly
`operation + "\t" + path + "\t" + blobIdentity + "\n"` with SHA-256. The result is
`sha256:` plus 64 lowercase hexadecimal characters. Empty final materialization fails.

Every Git output containing paths uses `-z` and NUL tokenization. Run each pair below once with `--raw` and
once with `--name-status`, preserving the shown NUL, detection, and full-object flags. Do not consult or trust
repository, user, or global Git abbreviation configuration:

```text
git diff --raw -z --no-abbrev --find-renames --find-copies --find-copies-harder <base>..HEAD
git diff --name-status -z --no-abbrev --find-renames --find-copies --find-copies-harder <base>..HEAD
git diff --raw -z --cached --no-abbrev --find-renames --find-copies --find-copies-harder
git diff --name-status -z --cached --no-abbrev --find-renames --find-copies --find-copies-harder
git diff --raw -z --no-abbrev --find-renames --find-copies --find-copies-harder
git diff --name-status -z --no-abbrev --find-renames --find-copies --find-copies-harder
git diff --raw -z --no-abbrev --find-renames --find-copies --find-copies-harder <parent> <commit>
git diff --name-status -z --no-abbrev --find-renames --find-copies --find-copies-harder <parent> <commit>
git ls-files --others --exclude-standard -z
```

Reject any raw or name-status `R*`/`C*` before union or normalization. A raw mode-only change with unchanged
blob identity is unsupported and fails; it must not disappear as an unchanged final record. Unsupported status,
malformed NUL record, unsafe or duplicate final path, missing blob, or non-40-hex Git identity fails.
The only additional parsed file object identity is generated by `git hash-object --stdin`, whose complete
output still must match the exact 40-hex parser rule. No parsed identity may be shortened through Git config.

## Modes

All modes validate roots, the supplied manifest, requested role, non-empty complete bijection, safe paths, and
an existing 40-hex commit base. `candidate` and `history` require base ancestry of candidate HEAD;
`baseline` requires candidate HEAD equal to base. All fail on empty expected materialization, unexpected or
unowned paths, missing outputs, wrong owner, dependency/order failure, invalid/unknown base, digest mismatch,
unsafe path, rename/copy, or a governed text, source, test, config, script, or document file over 500
physical lines.

`baseline` proves the candidate is the clean exact base: candidate HEAD equals base and no staged, unstaged,
or untracked input remains. For every requested manifest entry at base, `create` paths are absent, while
`modify` and `delete` paths are present as regular governed text files. The expected path set stays non-empty.
A baseline pass is a digest-less state proof: it returns no digest and creates no approval or history-trailer
evidence.

`candidate` takes the union of `base..HEAD`, staged, unstaged, and untracked paths. It parses all sources
with NUL-delimited Git output, deduplicates by safe path, reads final candidate filesystem state once per path,
compares it with the base tree, and creates one final A/M/D record for each materially changed path. A reverted
path contributes no record. Candidate final `create` and `modify` paths must be present regular files with the
required exact changed final blob identity; candidate final `delete` paths must be absent. The result must
exactly match requested role and brief manifest paths, allowed operations, owner, prerequisites, and canonical
digest. Only a candidate pass returns that real canonical digest.

`history` first validates every manifest path that is present in the supplied `base` tree before traversal: it must be
a regular governed file with strict UTF-8 governed text, no forbidden C0 byte (including NUL), and at most 500 physical
lines. An absent `create` path at base is permitted. It then proves `approval` is an ancestor of candidate HEAD and
walks `git rev-list --topo-order --reverse <approval>..HEAD` so every direct parent precedes its child. It always
validates the complete manifest transaction and dependency closure, regardless of `--brief`; it ignores commits with no
governed path and fails when zero governed commits remain. For each traversed commit, obtain all direct parents with
`git rev-list --parents -n 1 <commit>`, inspect the NUL-delimited diff against each parent, and apply rename/copy
rejection pairwise before path normalization.

For each governed path, the final commit-tree state and every direct-parent state are exactly either `absent` or a
`git:<40 lowercase hexadecimal>` blob identity. A commit materializes a path only when its final state differs from
every direct-parent state. If its final state equals any direct-parent state, it creates no record for that path even
when another parent differs. A merge whose governed paths are touched but all are nonmaterializing has no
materialization records and MUST contain no reserved SignalBus trailer; a reserved trailer fails
`history-nonmaterialized-trailer`. A novel governed merge has canonical A/M/D records over only its novel paths and
requires the full trailer set and a digest over exactly those records. This applies to ordinary, conflict-resolution,
and octopus merges.

Every materializing governed commit has exactly one of each trailer:

```text
Signal-Bus-Materialization-Brief: <CanonicalBrief>
Signal-Bus-Materialization-Owner: <CanonicalOwner>
Signal-Bus-Materialization-Digest: sha256:<64 lowercase hexadecimal characters>
```

Terminal Git parses the final trailer block through `git interpret-trailers --parse`; hand-rolled splitting is
not accepted. All governed materialization records in a commit belong to its trailer brief and owner, and its canonical
commit digest matches the digest trailer. A path's first materialization equals its manifest operation; successors retain
owner and brief, may only modify, and may not follow delete. A brief's first materialization follows prior first
materialization of all prerequisite briefs. Every manifest path must have a first materialization; a missing one fails
with `history-incomplete`. No successor substitutes for a missing first materialization. At the end, every manifest
path's exact canonical base-to-HEAD final record must exist and equal that path's declared operation; a discarded
feature, or any other final-state mismatch, fails `history-final-state`. Only a history pass returns its real canonical
digest: the digest from the latest materializing commit whose trailer brief is the requested brief. The verifier still
validates the complete manifest transaction before returning it; a requested brief without a materialization, and any
partial complete-manifest traversal, fail `history-incomplete`.

## Owned files and quality gates

The later implementation owns only these files, each at most 500 physical lines:

```text
scripts/tooling/signal-bus-materialization-contract.ts
scripts/tooling/signal-bus-materialization-git.ts
scripts/tooling/signal-bus-materialization-verifier.ts
scripts/tooling/verify-signal-bus-materialization.ts
scripts/tooling/signal-bus-materialization-test-support.ts
scripts/tooling/signal-bus-materialization-contract.test.ts
scripts/tooling/signal-bus-materialization-candidate.test.ts
scripts/tooling/signal-bus-materialization-history.test.ts
scripts/tooling/signal-bus-materialization-history-merge.test.ts
scripts/tooling/signal-bus-materialization-repo-test-support.ts
scripts/tooling/vitest.signal-bus-materialization.config.mjs
```

Tests use temporary local Git repositories only. Fixture subprocesses set `GIT_CONFIG_NOSYSTEM=1` and
`GIT_CONFIG_GLOBAL=/dev/null`, while intentional repository-local configuration remains effective. A
hostile-global-config regression proves this isolation. Cover baseline create-absent and modify/delete-present state;
candidate create/modify-present and delete-absent state; committed, staged, unstaged, and untracked union;
history/trailers; dependencies; unsafe paths; root/base/approval ancestor; empty delta; extra/missing output;
explicitly detected rename/copy; mode-only unchanged-blob rejection; manifest read-time integrity; deterministic ordering;
topological branch/merge dependency order; `core.abbrev=7` full-identity regression; and 500/501 lines for all
governed types. Real-Git history regressions prove that a deletion cannot hide a binary/C0 or 501-line governed file in
the supplied base. The dedicated merge suite covers a second-parent feature with an unchanged merge, a reserved trailer on
that nonmaterializing merge, a unique conflict-resolution blob, a discarded feature final state, malformed direct-parent
data, and an octopus merge. Cover direct CLI execution through the source module and a built artifact in a directory
with a space. A real-local-Git two-brief regression proves that requesting ABC returns ABC's terminal digest even after
a valid later DEF materialization, while full-manifest validation remains required. Vitest instruments exactly contract,
Git, verifier, and CLI runtime modules at 100% statements, branches, functions, and lines.

A fresh TECH FAIL found that two `Array.toSorted` calls were incompatible with the strict ES2022 target. Scoped
ES2022 TypeScript validation was RED before remediation. The contract and Git modules now make a copied array and
call `sort`, preserving non-mutating behavior; each call carries a narrow, line-local `unicorn/no-array-sort`
suppression that explains the ES2022 constraint. The subsequent scoped ES2022 TypeScript, lint, Prettier, build,
and diff checks pass. This remediation is not review acceptance: fresh independent TECH and PROCESS reviews remain
pending.

The latest TECH FAIL reproduced a direct-entry defect: `import.meta.url` was compared through its percent-encoded
`pathname` to decoded `process.argv[1]`, so a built artifact under a path containing a space skipped the verifier
and exited zero. The TDD regression was RED before changing the guard to `fileURLToPath(import.meta.url)` versus
`path.resolve(process.argv[1])`; it is GREEN with exit two and the exact stderr diagnostic above. At that point the
focused suite was 163/163 passing with V8 100%: statements 579/579, branches 429/429, functions 96/96, lines 480/480.
This remediation also awaited fresh independent TECH and PROCESS review acceptance.

A later TECH merge finding identified that the original single-parent history model could misclassify a merged branch.
A read-only design audit fixed the required all-direct-parent rule before a TDD implementation added real local-Git
merge tests. The test fixture was structurally split into repository support and the dedicated merge suite, then coverage
was closed. A subsequent TECH High found that history could delete a manifest path without validating its present base
tree text and line limit. Real-Git C0/binary base-delete and 501-line base-delete regressions were RED, then GREEN after
base-tree validation was placed before history traversal; the associated formatting finding was corrected.

A new integrated TECH finding established that history selected and validated `--brief`, but returned the globally last
materializing digest: an ABC request incorrectly returned a later DEF digest. The fix keeps full-manifest traversal and
closure intact, tracks only the requested brief's materializing digest, and retains `history-incomplete` both for a
nonmaterialized requested brief and for a partial full manifest. A real-local-Git two-brief test and a multi-file ABC
intermediate RED preceded the implementation; its focused history suite is GREEN at 22/22. The current full focused
evidence is 179/179 tests passing and V8 100%: statements 638/638, branches 466/466, functions 109/109, lines 526/526.

## Integrated-candidate identity and review boundary

The preceding SignalBus review records concern the former candidate based at
`5a5c10bd12bef01ba756549fd61a93921438cb33`, including its historical ten-diagnostic global typecheck baseline. They are
historical only and cannot approve the integrated candidate.

The current uncommitted fourteen-file candidate is integrated on base
`98894a16f0337b1aa319778ae22babe100683a1a` (`fix(tooling): repair bot typed lint test`). That prerequisite changed only
`scripts/tooling/eslint-bot-typed-project.test.ts`: it repaired the former TypeScript 6 typed-lint diagnostics with
`isRecord`, `ParseConfigFileHost`, and bracket access. Its own TECH and PROCESS reviews passed after correction of the
SHA-256-versus-Git-SHA-1 evidence issue. It is a prerequisite integration fact, not a SignalBus review or an alteration of
the eleven tooling files.

After the requested-digest TDD remediation, the integrated candidate passed the focused Node V8 run (179/179; statements
638/638, branches 466/466, functions 109/109, lines 526/526), `bun run typecheck:coverage-tools`, owned strict ES2022
TypeScript, scoped zero-warning ESLint, Prettier, root `bun run build` (12/12), the built spaced-path malformed CLI
regression, and whitespace/scope/secret/TODO scans. The global typecheck passes with no baseline exception. Fresh
post-documentation verification passed. The `signal_bus_exact_identity_tech` follow-up TECH review passed with zero
findings; the subsequent PROCESS follow-up found one Medium stale-status finding, remediated in this snapshot. The next
exact-identity TECH confirmation and PROCESS re-review are pending; if both pass, the coordinator may commit without
another documentation mutation.

The present evidence update is `signal_bus_integrated_digest_evidence`: documentation/governing-evidence write,
non-review, exactly the three documentation/evidence paths, 0 packages, no external or mutable resource, requested
`terra_worker`, `gpt-5.6-terra` / high, with effective runtime route/model/effort `not observable`. It has workspace-write
authority only; no fallback, staging, commit, or self-review. It does not change the approved cooperative threat model,
trading behavior, runtime configuration behavior, or the eleven tooling paths.

All prior SignalBus TECH and PROCESS results, including `signal_bus_history_base_rereview`,
`signal_bus_process_rereview_final`, and `signal_bus_final_identity_tech`, are historical receipts for a different candidate
identity. The pre-mutation integrated final TECH/PROCESS receipts passed with zero findings. The follow-up
`signal_bus_exact_identity_tech` passed with zero findings; the PROCESS follow-up found one Medium stale-status finding,
remediated in this snapshot. The next exact-identity TECH confirmation and PROCESS re-review are pending; no closure or
commit is claimed.

```bash
node node_modules/vitest/vitest.mjs run --config scripts/tooling/vitest.signal-bus-materialization.config.mjs --coverage
bun run typecheck:coverage-tools
./node_modules/.bin/eslint scripts/tooling/signal-bus-materialization*.ts scripts/tooling/verify-signal-bus-materialization.ts --max-warnings=0
./node_modules/.bin/prettier --check scripts/tooling/signal-bus-materialization* scripts/tooling/verify-signal-bus-materialization.ts docs/superpowers/specs/2026-08-26-signal-bus-materialization-verifier.md docs/superpowers/plans/2026-08-26-signal-bus-materialization-verifier.md plans/full-refactor/evidence/signal-bus-materialization-verifier-2026-08-26.md
SIGNAL_BUS_MATERIALIZATION_OUTPUT="$(mktemp -d)"
bun build scripts/tooling/verify-signal-bus-materialization.ts --target=bun --outfile="${SIGNAL_BUS_MATERIALIZATION_OUTPUT}/verify.mjs"
git diff --check -- scripts/tooling docs/superpowers plans/full-refactor/evidence
```

The implementation worker does not stage or commit. The current integrated candidate requires fresh final TECH and PROCESS
reviews after the final post-documentation verification. After both pass, the coordinator must perform final verification,
stage exact scope, and create a Conventional Commit; do not integrate hook/CI or expand scope.
