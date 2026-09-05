# Reproducible Application Releases Implementation Plan — Tasks 5–6

This continuation contains Tasks 5–6 of the [main plan](2026-09-05-reproducible-app-releases.md). Read that plan for the goal, architecture, global constraints, file map, interfaces, and Tasks 1–4; the [design spec](../specs/2026-09-05-reproducible-app-releases-design.md) remains authoritative.

### Task 5: Implement extraction, guarded smoke, reproducibility, and publication

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
  `assertReproducibleRelease`, one atomic publication operation, and the three
  remaining root release entrypoints.

- [ ] **Step 1: Write RED smoke and reproducibility tests.**

```ts
await expect(smokeVerifiedRelease(noUnshareDependencies, botArtifact)).rejects.toThrow("network namespace");
await expect(smokeVerifiedRelease(exitOneHelpDependencies, botArtifact)).rejects.toThrow("--help");
await expect(assertReproducibleRelease(differentSecondBuild, "bot")).rejects.toThrow("byte-identical");
await expect(assertReproducibleRelease(existingDestinationDependencies, "bot")).rejects.toThrow(
  "destination",
);
await expect(assertReproducibleRelease(noAtomicPublishProofDependencies, "bot")).rejects.toThrow(
  "atomic absent-only",
);
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
smoke both candidates. Only after all of those steps succeed, call
`publishCandidateDirectory` exactly once to atomically promote the first
complete candidate directory to its exact final destination. The primitive
enforces that destination absence atomically: a pre-existing directory,
symlink, or non-directory is an error and is never replaced or merged. The
assembler, verifier, and smoke modules never publish. Candidate creation,
partial writes, verification failure, byte mismatch, smoke failure, and failed
publication must all leave no final release output.

The production publication adapter is enabled only when the pinned
Linux/runtime can prove atomic absent-only whole-directory semantics; otherwise
the command fails closed before final output. It must not use `renameat2`,
`openat`, `openat2`, native descriptor adapters, or inspect-then-rename
emulation. Tests cover unavailable proof, a pre-existing symlink or
non-directory destination, and assert that no final destination is passed to
`inspectPath`.

- [ ] **Step 4: Run the smoke/reproducibility checkpoint.**

Run: `bun test scripts/release/release-smoke.test.ts scripts/release/release-reproducibility.test.ts && bun scripts/release/reproducibility.ts`

Expected: Unit PASS; the real command either PASSes every clean target or fails
closed before release output on a dirty worktree, unavailable `unshare`,
toolchain mismatch, compiler failure, partial write, verifier failure, unequal
bytes, smoke failure, symlink/non-directory destination, or failed atomic
publication.

### Task 6: Wire safe cleanup, CI evidence, and complete end-to-end coverage

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

- [ ] **Step 1: Write RED integration and workflow tests.**

```ts
expect(cleanerLogs).toContain("remove releases");
expect(await Bun.file(path.join(repoRoot, "unknown.txt")).exists()).toBe(true);
expect(workflow).toContain("bun run release:reproducibility");
expect(workflow).toContain("releases/**/*.zip");
expect(workflow).toContain("releases/**/*.zip.sha256");
await expect(runReleaseCoverage("unit", malformedLcovDependencies)).rejects.toThrow("missing branch metric");
await expect(runReleaseCoverage("e2e", partialLcovDependencies)).rejects.toThrow("100%");
```

- [ ] **Step 2: Run the RED integration tests.**

Run: `bun test scripts/tooling/clean-artifacts.test.ts scripts/tooling/ci-format-workflow-contract.test.ts scripts/release/release-e2e.test.ts scripts/release/release-coverage.test.ts`

Expected: FAIL because `releases` is not yet a cleaner allowlist entry, CI does
not have the reproducibility job, and the release LCOV gate does not exist.

- [ ] **Step 3: Complete only the approved integration wiring.**

Add `"releases"` to the existing literal `artifactPaths` tuple, preserving its
component-by-component symlink validation. Add a CI `release-reproducibility`
job with `actions/checkout@v4`, `oven-sh/setup-bun@v2` using `.bun-version`,
`actions/setup-node@v4` using `.nvmrc`, `bun install --frozen-lockfile`,
`bun run release:reproducibility`, and one `actions/upload-artifact@v4` step
whose paths are exactly `releases/**/*.zip` and `releases/**/*.zip.sha256`.
The E2E test creates a private fixture Git repository with a committed fixed
source timestamp, replaces only its compiler/process ports with deterministic
fakes, and proves both apps' two-candidate ZIP/sidecar/manifest/verification/
smoke/publication path. It adversarially exercises symlink and non-directory
final destinations plus partial candidate writes, and proves each failure
leaves no final release output.

Add these exact root package scripts in the existing `scripts` record:

```json
{
  "coverage:release": "bun scripts/release/release-coverage.ts --level=all",
  "coverage:release:e2e": "bun scripts/release/release-coverage.ts --level=e2e",
  "coverage:release:unit": "bun scripts/release/release-coverage.ts --level=unit",
  "release:build": "bun scripts/release/build.ts",
  "release:reproducibility": "bun scripts/release/reproducibility.ts",
  "release:smoke": "bun scripts/release/smoke.ts",
  "release:verify": "bun scripts/release/verify.ts"
}
```

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

- [ ] **Step 4: Run final scoped gates.**

Run: `bun test scripts/release/*.test.ts scripts/tooling/clean-artifacts.test.ts scripts/tooling/ci-format-workflow-contract.test.ts && bun run coverage:release && bun run format:check && bun run lint && bun run typecheck && bun run test:tooling`

Expected: PASS with all new release runtime files at 100% unit/E2E coverage;
if `bun run verify` remains unavailable, report that target-state gap rather
than claiming it passed.
