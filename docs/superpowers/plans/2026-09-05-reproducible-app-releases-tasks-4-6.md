# Reproducible Application Releases Implementation Plan — Tasks 4–6

This continuation contains Tasks 4–6 of the main implementation plan. Read the [main plan](2026-09-05-reproducible-app-releases.md) for the goal, architecture, global constraints, file map, interfaces, and Tasks 1–3; the [design spec](../../specs/2026-09-05-reproducible-app-releases-design.md) remains authoritative.

### Task 4: Make config-search a typed unavailable compiled CLI

**Files:**

- Modify: `apps/config-search/src/index.ts`
- Modify: `apps/config-search/src/index.test.ts`
- Create: `apps/config-search/src/cli-e2e.test.ts`

**Interfaces:**

- Consumes: no release module; this is a standalone application boundary.
- Produces: `ConfigSearchUnavailableResult`, `runConfigSearchCli`, and a direct entrypoint with exact exit codes.

- [ ] **Step 1: Write RED public CLI tests.**

```ts
expect(runConfigSearchCli([], output)).toBe(1);
expect(output.stdout).toBe(
  '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n',
);
expect(runConfigSearchCli(["--help"], output)).toBe(0);
expect(runConfigSearchCli(["--search"], output)).toBe(2);
```

- [ ] **Step 2: Run the RED CLI test.**

Run: `bun test apps/config-search/src/index.test.ts apps/config-search/src/cli-e2e.test.ts`

Expected: FAIL because source entrypoint behavior and exit codes are incomplete.

- [ ] **Step 3: Implement the closed unavailable surface.**

```ts
export interface ConfigSearchOutput {
  readonly writeStderr: (text: string) => void;
  readonly writeStdout: (text: string) => void;
}

export interface ConfigSearchUnavailableResult {
  readonly available: false;
  readonly code: "CONFIG_SEARCH_UNAVAILABLE";
  readonly operation: "config-search";
  readonly reason: "exact-strategy-run-corridor-unavailable";
  readonly schema: "mm-crypto-bot.config-search.result/v1";
}
```

Use an object literal with the specified insertion order and `JSON.stringify`
plus LF for default and `--status`. Implement exact `--help` text without a
clock, color, config read, or runtime-root access. The direct entrypoint sets
`process.exitCode = runConfigSearchCli(process.argv.slice(2), processOutput)`;
do not throw and do not import search/backtest/exchange/data/config modules.

- [ ] **Step 4: Run the config-search checkpoint.**

Run: `bun run --filter @mm-crypto-bot/config-search test && bun run --filter @mm-crypto-bot/config-search build`

Expected: PASS; the compiled app `--help` exits `1`, default and `--status`
produce the exact unavailable document and exit `1`, and no test observes a
search call.

### Task 5: Implement extraction, guarded smoke, and two-build reproducibility

**Files:**

- Create: `scripts/release/release-smoke.ts`
- Create: `scripts/release/release-smoke.test.ts`
- Create: `scripts/release/release-reproducibility.ts`
- Create: `scripts/release/release-reproducibility.test.ts`
- Create: `scripts/release/smoke.ts`
- Create: `scripts/release/reproducibility.ts`
- Create: `scripts/release/build.ts`

**Interfaces:**

- Consumes: Task 2 assembly results and Task 3 verifier result.
- Produces: `extractVerifiedRelease`, `smokeVerifiedRelease`, `assertReproducibleRelease`, and the three remaining root release entrypoints.

- [ ] **Step 1: Write RED smoke and reproducibility tests.**

```ts
await expect(smokeVerifiedRelease(noUnshareDependencies, botArtifact)).rejects.toThrow("network namespace");
await expect(smokeVerifiedRelease(exitOneHelpDependencies, botArtifact)).rejects.toThrow("--help");
await expect(assertReproducibleRelease(differentSecondBuild, "bot")).rejects.toThrow("byte-identical");
expect(spawnedArgv).toEqual(["unshare", "--user", "--map-root-user", "--net", extractedBinary, "--help"]);
```

- [ ] **Step 2: Run the RED smoke/reproducibility tests.**

Run: `bun test scripts/release/release-smoke.test.ts scripts/release/release-reproducibility.test.ts`

Expected: FAIL because guarded smoke and repeat assembly modules do not exist.

- [ ] **Step 3: Implement verified extraction and repeatable assembly.**

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

Call Task 3 verification before extraction. Create each directory only after
checking its parent is an owned private directory and no component is a
symlink; write only validated bytes and apply `0644`/`0755`. Invoke the fixed
`unshare` argv with a strict environment allowlist. Assert bot `--help` exit
`1`; assert config-search `--help` exit `0` and `--status` exit `1` with the
exact stdout JSON. Build each app twice into separate `mkdtemp` roots, verify
each result, compare equal-length byte arrays and SHA-256 strings, and reject
any difference before retaining only the final expected release paths.

- [ ] **Step 4: Run the smoke/reproducibility checkpoint.**

Run: `bun test scripts/release/release-smoke.test.ts scripts/release/release-reproducibility.test.ts && bun scripts/release/reproducibility.ts`

Expected: Unit PASS; the real command either PASSes every clean target or fails
closed before release output on a dirty worktree, unavailable `unshare`, toolchain mismatch, compiler failure, verifier failure, or unequal bytes.

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
fakes, and proves both apps' ZIP/sidecar/manifest/smoke/reproducibility path.

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
