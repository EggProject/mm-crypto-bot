# Reproducible Application Releases Implementation Plan — Tasks 5–11

This continuation contains Tasks 5–11 of the [main plan](2026-09-05-reproducible-app-releases.md). Read that plan for the goal, architecture, global constraints, file map, interfaces, and Tasks 1–4; the [design spec](../specs/2026-09-05-reproducible-app-releases-design.md) remains authoritative.

### Task 5: Implement retained private extraction, guarded smoke, and reproducibility

**Files:**

- Create: `scripts/release/release-smoke.ts`
- Create: `scripts/release/release-smoke.test.ts`
- Create: `scripts/release/release-reproducibility.ts`
- Create: `scripts/release/release-reproducibility.test.ts`
- Create: `scripts/release/smoke.ts`
- Create: `scripts/release/reproducibility.ts`
- Create: `scripts/release/build.ts`

**Interfaces:**

- Consumes: Task 3 private candidate assemblies and Task 4 verifier results.
- Produces: `extractVerifiedRelease`, `smokeVerifiedRelease`,
  `assertReproducibleRelease`, and private smoke/reproducibility entrypoints.

- [ ] **Step 1: Write RED smoke and reproducibility tests.**

```ts
await expect(smokeVerifiedRelease(noUnshareDependencies, botArtifact)).rejects.toThrow("network namespace");
await expect(smokeVerifiedRelease(exitOneHelpDependencies, botArtifact)).rejects.toThrow("--help");
await expect(assertReproducibleRelease(differentSecondBuild, "bot")).rejects.toThrow("byte-identical");
expect(finalReleaseDirectoryExists()).toBe(false);
expect(inspectedPaths).not.toContain(destinationDirectory);
expect(spawnedArgv).toEqual(["unshare", "--user", "--map-root-user", "--net", extractedBinary, "--help"]);
```

- [ ] **Step 2: Run the RED smoke/reproducibility tests.**

Run: `bun test scripts/release/release-smoke.test.ts scripts/release/release-reproducibility.test.ts`

Expected: FAIL because guarded smoke and repeat assembly modules do not exist.

- [ ] **Step 3: Implement verified extraction, repeatable assembly, and one publication.**

```ts
export async function extractVerifiedRelease(
  dependencies: ReleaseDependencies,
  artifact: ReleaseArtifactPaths,
): Promise<ExtractedRelease>;
export async function smokeVerifiedRelease(
  dependencies: ReleaseDependencies,
  artifact: ReleaseArtifactPaths,
): Promise<void>;
export async function assertReproducibleRelease(
  dependencies: ReleaseDependencies,
  application: ReleaseApplication,
): Promise<void>;
```

Call Task 4 verification before extraction. Use
`createPrivateCandidate("release-extraction-")` for extraction and write only
verified in-memory bytes with `0644`/`0755`; do not perform an
`lstat`/existence-check then write sequence against a final path. Invoke the
fixed `unshare` argv with a strict environment allowlist. Assert bot `--help`
exit `1`; assert config-search `--help` exit `0` and `--status` exit `1` with
the exact stdout JSON.

For each application, build two independent private candidates. Verify both,
compare equal-length ZIP and sidecar byte arrays plus SHA-256 strings, then
smoke both candidates. This retained task ends private: the obsolete public
whole-directory `publishCandidateDirectory` contract is superseded and no
assembler, verifier, smoke, or inner reproducibility module publishes. Candidate
creation, partial writes, verification failure, byte mismatch, and smoke failure
must leave no public release output. Release-set Tasks 7–10 add the only public
publication operation after the cross-application gate.

- [ ] **Step 4: Run the smoke/reproducibility checkpoint.**

Run: `bun test scripts/release/release-smoke.test.ts scripts/release/release-reproducibility.test.ts && bun scripts/release/reproducibility.ts`

Expected: Unit PASS; the real command either PASSes every eligible clean private
target or fails closed before public output on a dirty worktree, unavailable
`unshare`, toolchain mismatch, compiler failure, partial write, verifier
failure, unequal bytes, or smoke failure.

### Task 6: Deferred future root, cleaner, CI, and output wiring

This is retained as a future target only. It requires separate user approval
and a new brief; it is not implemented, staged, committed, or validated by this
release-set slice. Any future publication/upload wording must name only the
single release-set ZIP, not legacy per-app public ZIP/sidecar entries.

**Files:**

- Modify: `scripts/tooling/clean-artifacts.ts`
- Modify: `scripts/tooling/clean-artifacts.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/tooling/ci-format-workflow-contract.test.ts`
- Create: `scripts/release/release-e2e.test.ts`
- Create: `scripts/release/release-coverage.ts`
- Create: `scripts/release/release-coverage.test.ts`

**Interfaces:**

- Consumes: all prior task entrypoints and the existing `cleanArtifacts` contract.
- Produces: root `release:build`, `release:verify`, `release:smoke`, `release:reproducibility`, `coverage:release:unit`, `coverage:release:e2e`, and `coverage:release` scripts, the release CI job, and end-to-end release evidence.

- [ ] **Future Step 1: Write RED integration and workflow tests after approval.**

```ts
expect(cleanerLogs).toContain("remove releases");
expect(await Bun.file(path.join(repoRoot, "unknown.txt")).exists()).toBe(true);
expect(workflow).toContain("bun run release:reproducibility");
expect(workflow).toContain("releases/**/*.zip");
expect(workflow).toContain("releases/**/*.zip.sha256");
await expect(runReleaseCoverage("unit", malformedLcovDependencies)).rejects.toThrow("missing branch metric");
await expect(runReleaseCoverage("e2e", partialLcovDependencies)).rejects.toThrow("100%");
```

- [ ] **Future Step 2: Run the RED integration tests after approval.**

Run: `bun test scripts/tooling/clean-artifacts.test.ts scripts/tooling/ci-format-workflow-contract.test.ts scripts/release/release-e2e.test.ts scripts/release/release-coverage.test.ts`

Expected: FAIL because `releases` is not yet a cleaner allowlist entry, CI does
not have the reproducibility job, and the release LCOV gate does not exist.

- [ ] **Future Step 3: Complete separately approved integration wiring.**

The historical per-app `releases/**/*.zip` plus `releases/**/*.zip.sha256`
upload target is superseded. A future approved cleaner/CI task must preserve
component-by-component symlink validation and upload only the one release-set
ZIP after an approved release-set reproducibility command; exact root-script,
workflow, and artifact identifiers are deferred to that brief.
The E2E test creates a private fixture Git repository with a committed fixed
source timestamp, replaces only its compiler/process ports with deterministic
fakes, and proves both apps' two-candidate ZIP/sidecar/manifest/verification/
smoke/publication path. It adversarially exercises symlink and non-directory
final destinations plus partial candidate writes, and proves each failure
leaves no final release output.

The historical root scripts are also superseded/deferred; this slice does not
name or add root wiring. Release-local coverage remains specified by Task 11.

Implement `runReleaseCoverage(level, dependencies)` in
`scripts/release/release-coverage.ts` with `level: "unit" | "e2e"`. Its unit
argv names every release module test except `release-e2e.test.ts`; its E2E argv
names only `release-e2e.test.ts`. Each fixed argv runs Bun coverage into a new
private `coverage/release/{unit|e2e}` directory with LCOV output. Parse LCOV
records directly: every `LF`, `FNF`, and `BRF` total is nonzero and exactly
equals its `LH`, `FNH`, and `BRH` covered value for every `scripts/release/*.ts`
runtime file; missing records, zero totals, uninstrumented owned file, malformed
line, or any non-owned source record is an error. Add root scripts
`coverage:release:unit`, `coverage:release:e2e`, and `coverage:release` where
the last runs both levels in order. Do not use host `lcov`.

- [ ] **Future Step 4: Run final scoped gates after approval.**

Run: `bun test scripts/release/*.test.ts scripts/tooling/clean-artifacts.test.ts scripts/tooling/ci-format-workflow-contract.test.ts && bun run coverage:release && bun run format:check && bun run lint && bun run typecheck && bun run test:tooling`

Expected: PASS with all new release runtime files at 100% unit/E2E coverage;
if `bun run verify` remains unavailable, report that target-state gap rather
than claiming it passed.

### Task 7: Define the release-set contract and specialized STORE ZIP policy

**Files:** create `scripts/release/release-set-contract.ts`,
`scripts/release/release-set-zip.ts`, `scripts/release/release-set-contract.test.ts`,
and `scripts/release/release-set-zip.test.ts`.

- [ ] **RED:** fixture the exact five `0644` outer entries in UTF-16/code-unit
      order, canonical two-space-LF `mm-crypto-bot.release-set-manifest/v1`,
      exactly two app records, and malformed, duplicate, traversal, wrong
      name/order/mode inputs. Run `bun test scripts/release/release-set-contract.test.ts scripts/release/release-set-zip.test.ts`; expect FAIL because release-set modules do not exist.
- [ ] **GREEN:** export pure `createReleaseSetManifest(inputs: readonly ReleaseSetInput[]): ReleaseSetManifestV1` and `encodeReleaseSetZip(inputs: readonly ReleaseSetInput[], sourceDateEpoch: number): ReleaseSetArchive`, where `ReleaseSetArchive` is exactly `{ manifest, zipBytes }`. Record common `commit`,
      `lockfileSha256`, `sourceDateEpoch`, `target`, `toolchain`, and `version`,
      plus exactly two records with exact ZIP/sidecar paths and `{bytes, sha256}`;
      never self-hash. Accept only prevalidated regular raw inner inputs and STORE.
- [ ] **Checkpoint:** run `bun test scripts/release/release-set-contract.test.ts scripts/release/release-set-zip.test.ts && bunx tsc --project tsconfig.json --noEmit`; expect PASS with deterministic bytes/layout.
- [ ] **Commit/review:** coordinator exact-stages the four paths, commits
      `feat(release): define release-set archive contract`, and gets actual-commit
      Terra/Luna reviews.

### Task 8: Assemble raw verified inner artifacts into a private set

**Files:** create `scripts/release/release-set-assembler.ts` and
`scripts/release/release-set-assembler.test.ts`.

- [ ] **RED:** assert exactly two independently verified raw ZIP+sidecar inputs,
      private archive result, and rejection of noncanonical/wrong manifest, digest,
      length, sidecar, app mapping, and cross-app identity. Run `bun test scripts/release/release-set-assembler.test.ts`; expect FAIL because assembly export is absent.
- [ ] **GREEN:** export `assembleReleaseSetCandidate(dependencies: ReleaseDependencies, inputs: readonly ReleaseSetInput[]): Promise<ReleaseSetPrivateCandidate>`, where `ReleaseSetPrivateCandidate` is exactly `{ archivePath, basename: "mm-crypto-bot-release-set-0.1.0-bun-linux-x64.zip", directory: ReleasePrivateDirectory, manifest }`. Invoke the current independent inner verifier, compare all common identities, then use only injected private `mkdtemp`/write operations for the candidate. It accepts no public destination and does not publish, inspect, or traverse one.
- [ ] **Checkpoint:** run `bun test scripts/release/release-set-assembler.test.ts && bunx tsc --project tsconfig.json --noEmit`; expect PASS, including no-publication/no-destination-inspection assertions.
- [ ] **Commit/review:** coordinator exact-stages both paths, commits
      `feat(release): assemble verified release sets`, and gets actual-commit
      Terra/Luna reviews.

### Task 9: Independently verify the outer release set

**Files:** create `scripts/release/release-set-verifier.ts` and
`scripts/release/release-set-verifier.test.ts`.

- [ ] **RED:** independently mutate malformed, duplicate, traversal, wrong
      name/order/mode outer entries, noncanonical manifest, each digest/length,
      sidecar spelling, app mapping, and cross-app identity. Run `bun test scripts/release/release-set-verifier.test.ts`; expect FAIL because no verifier exists.
- [ ] **GREEN:** export `verifyReleaseSetArchive(input: { readonly zipBytes: Uint8Array }): Promise<VerifiedReleaseSetArchive>`. Reparse outer layout/names/order/modes, canonical bytes/schema, all four byte lengths/digests, inner sidecars, and both inner archives through the current independent verifier; require equality of all common identities. This verifier must not call or reuse writer logic.
- [ ] **Checkpoint:** run `bun test scripts/release/release-set-verifier.test.ts && bunx tsc --project tsconfig.json --noEmit`; expect PASS without reusing writer logic.
- [ ] **Commit/review:** coordinator exact-stages both paths, commits
      `feat(release): verify release-set archives`, and gets actual-commit
      Terra/Luna reviews.

### Task 10: Publish one create-only release-set hard link

**Files:** create `scripts/release/release-set-publication.ts`,
`scripts/release/release-set-publication.test.ts`,
`scripts/release/release-set-reproducibility.ts`, and
`scripts/release/release-set-reproducibility.test.ts`; modify
`scripts/release/release-ports.ts`.

- [ ] **RED:** prove injected `link()` is not called before both apps complete
      two-build assembly, verification, byte comparison, and smoke; prove no
      destination inspection and exactly one final link. Assert `EEXIST` preserves
      regular-file/directory/symlink sentinels, `EXDEV`, and redacted unknown error.
      Run `bun test scripts/release/release-set-publication.test.ts scripts/release/release-set-reproducibility.test.ts`; expect FAIL because exports are absent.
- [ ] **GREEN:** in `release-ports.ts`, export `ReleasePublicationFileSystemPort { link(source: string, destination: string): Promise<void>; }`, `nodeReleasePublicationFileSystemPort`, and `ReleaseSetPublicationDependencies { readonly sourceFileSystem: Pick<ReleaseFileSystemPort, "lstat" | "readFile">; readonly publicationFileSystem: ReleasePublicationFileSystemPort; }`. Export `publishReleaseSet(input: { readonly candidate: ReleaseSetPrivateCandidate; readonly destinationArchivePath: string }, dependencies: ReleaseSetPublicationDependencies): Promise<ReleasePublicationOutcome>` and `assertReproducibleReleaseSet(input: { readonly releaseDependencies: ReleaseDependencies; readonly publicationDependencies: ReleaseSetPublicationDependencies; readonly destinationArchivePath: string }): Promise<ReleasePublicationOutcome>`. The publisher uses the real `verifyReleaseSetArchive` after source `lstat`/read immediately before the single Node/Bun `fsPromises.link(sourceArchivePath, destinationArchivePath)` call and never reads, inspects, or traverses destination. It never overwrites, renames, merges, copy-falls back, or creates an outer sidecar. Map `EEXIST`, `EXDEV`, and other errors to stable redacted outcomes; `EXDEV` hard-fails. Require/document a pre-existing non-symlinked process-controlled parent tree with no hostile writer and the pathname ancestor-replacement limit.
- [ ] **GREEN cleanup:** candidate content is verified regular non-symlink data
      inside an unpredictable private root and immutable-by-protocol. Before-link
      failure removes only proven private candidates; after-link never rolls back or
      destination-cleans, while separate cleanup failure returns published state.
- [ ] **Checkpoint:** run `bun test scripts/release/release-set-publication.test.ts scripts/release/release-set-reproducibility.test.ts && bunx tsc --project tsconfig.json --noEmit`; expect PASS, including mismatch/smoke failure with no public link.
- [ ] **Commit/review:** coordinator exact-stages the five paths, commits
      `feat(release): publish immutable release sets`, and gets actual-commit
      Terra/Luna reviews.

### Task 11: Release-local coverage and same-filesystem E2E evidence

**Files:** modify `scripts/release/release-coverage.ts`, `vitest.config.ts`, and
`vitest.e2e.config.ts`; create `scripts/release/release-set-coverage.test.ts`
and `scripts/release/release-set-e2e.test.ts`. Do not modify the existing
499-line `scripts/release/release-coverage.test.ts`.

- [ ] **RED:** use private `/tmp` fixtures on one filesystem to prove hard-link
      identity and final-file survival after private candidate removal. Assert no
      link after mismatch/smoke failure, published state after cleanup failure with
      no destination removal, malformed LCOV, zero totals, missing records, and
      partial S/B/F/L. Run `bun test scripts/release/release-set-e2e.test.ts scripts/release/release-set-coverage.test.ts`; expect FAIL because modules are absent.
- [ ] **GREEN:** extend the existing `runReleaseCoverage(level, dependencies)`
      signature in `scripts/release/release-coverage.ts`; do not create a second
      runner. Add every new release-set runtime file to both unit/E2E source
      lists in `vitest.config.ts` and `vitest.e2e.config.ts`. Change the parser
      condition from `total < 0` to `total <= 0`; a new
      `release-set-coverage.test.ts` proves the zero-total error. Require
      separate unit/E2E 100% statements,
      branches, functions, and lines with positive per-file totals. Do not use
      host `lcov` or root/CI/cleaner configuration.
- [ ] **Checkpoint:** run `bun test scripts/release/release-set-coverage.test.ts scripts/release/release-set-e2e.test.ts && bun test scripts/release/release-coverage.test.ts && bun run coverage:release && bunx tsc --project tsconfig.json --noEmit`; expect PASS with the existing runner and positive 100% per-file S/B/F/L totals.
- [ ] **Commit/review:** coordinator exact-stages these five paths, commits
      `test(release): cover release-set publication`, and gets actual-commit
      Terra/Luna reviews.
