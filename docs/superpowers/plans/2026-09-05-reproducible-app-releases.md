# Reproducible Application Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce verified, byte-reproducible, target-specific Bun executable ZIP releases for `bot` and `config-search` without embedding configuration, data, source, or secrets.

**Architecture:** Typed release modules assemble only prevalidated in-memory payloads in fresh private candidate directories and write deterministic ZIP STORE archives. An independent parser validates candidate archives and a Linux network-namespace smoke harness executes only safe CLI forms. The retained inner gate verifies two private candidates, compares their bytes, and smokes both. A later release-set layer independently verifies its outer archive and publishes one regular file with a final create-only hard link. Release entrypoints depend on injected Git, toolchain, filesystem, compiler, and process ports so unit tests exercise contracts while the dirty integration worktree remains ineligible for real release creation.

**Tech Stack:** Bun `1.3.14`, Node `24.19.0` metadata pin, TypeScript, Node built-in `crypto`, `fs/promises`, `os`, `path`, Bun compile, Bun test, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-reproducible-app-releases-design.md`

Tasks 5–11 continue in [`2026-09-05-reproducible-app-releases-tasks-4-6.md`](2026-09-05-reproducible-app-releases-tasks-4-6.md).

## Global Constraints

- Build and runtime basis is Bun `1.3.14`; Node `24.19.0` is verified metadata only and never a release runtime requirement.
- Release targets are only `bot` and `config-search`, version `0.1.0`, target `bun-linux-x64`, and the exact release paths named in the Spec.
- Build uses a standalone `bun build --compile --target=bun-linux-x64` executable in a fresh, unpredictable private candidate directory; no source, `node_modules`, package manager, config, data, state, logs, credentials, or secrets enter the ZIP.
- ZIP is an in-process deterministic STORE writer: sorted POSIX paths, fixed compatible Git timestamp, no compression/extra fields/comments, fixed modes, exact bytes; shell `zip`, dependency, and lockfile changes are forbidden.
- Real release creation requires a clean exact Git commit and exact Bun/Node/toolchain metadata; any discrepancy fails closed. Tests use injected ports and may run in this dirty worktree.
- Config-search only implements `--help`, unavailable default, and unavailable `--status`; it never searches or imports a search/exchange/data/config execution path.
- Verification independently parses central and local ZIP headers and validates paths, modes, hashes, manifest, forbidden contents, and sidecar.
- Smoke extraction is private, safe, outbound-network guarded with required Linux `unshare --user --map-root-user --net`, and runs only bot `--help` plus config-search `--help`/`--status`.
- Assembly never writes `releases/`. The retained inner gate verifies, byte-compares, and smokes two complete private candidates per app. The old public whole-directory `publishCandidateDirectory` model is superseded; the release-set gate publishes only one outer regular file after both apps pass all gates.
- The filesystem port creates private candidates with an unpredictable secure primitive. The release-set publication port uses only create-only `fsPromises.link` and never destination inspection, overwrite, rename, merge, or copy fallback; predictable names and `lstat`/existence-check then write emulation are forbidden.
- A release-set candidate carries only its direct-child temporary directory, fixed basename, and archive path. `publishReleaseSet` receives the trusted private root separately from its caller, so a forged candidate cannot choose that anchor. Before any port call, publisher-owned pure validation requires that caller-supplied root relationship, the exact private-directory prefix with a nonempty suffix, and the exact archive join. The current restricted candidate filesystem port alone may later call `removePrivateDirectory(candidate.directory)`; it never operates on the public root or destination. The reproducibility orchestration explicitly supplies `releaseDependencies.temporaryRoot` as that trusted root.
- Cleaner, root scripts, CI, upload, and actual `releases/**` output remain explicit future wiring targets requiring separate approval. This plan slice adds no root/CI/cleaner wiring.
- No `openat`, `openat2`, `/proc` file descriptors, native descriptor adapters, unsafe assertions, `any`, suppressions, weakened gates, shell interpolation, or files over 500 lines.
- Every owned release runtime source has 100% statements, branches, functions, and lines in separate unit and E2E coverage reports.
- The coordinator may land each completed task scope as a separate exact-path Conventional Commit after that scope's gates; incomplete or finding-blocked files remain uncommitted. Clean-worktree real release compilation, reproducibility, and smoke still wait for the relevant exact release implementation commits and all final integration gates. Individual tasks end in verification checkpoints and must not stage or touch unrelated dirty-union paths.

---

## File Map

| Path                                                                              | Responsibility                                                                                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `scripts/release/release-contract.ts`                                             | App/target constants, manifest and result types, canonical JSON/sidecar helpers.                                            |
| `scripts/release/release-ports.ts`                                                | Injected private/publication filesystem, Git, toolchain, compiler, and process ports.                                       |
| `scripts/release/zip-store.ts`                                                    | Strict payload validation and deterministic ZIP STORE encode/decode primitives.                                             |
| `scripts/release/release-assembler.ts`                                            | Clean preflight, private compilation, manifest/README assembly, and candidate output only.                                  |
| `scripts/release/release-verifier.ts`                                             | Independent ZIP/sidecar/manifest/payload validation.                                                                        |
| `scripts/release/release-smoke.ts`                                                | Safe extraction and Linux network-namespace subprocess smoke.                                                               |
| `scripts/release/release-reproducibility.ts`                                      | Private two-candidate verification, byte comparison, and smoke per application.                                             |
| `scripts/release/release-set-contract.ts`, `release-set-zip.ts`                   | Outer release-set types, canonical manifest, and specialized STORE policy.                                                  |
| `scripts/release/release-set-assembler.ts`, `release-set-verifier.ts`             | Raw verified-inner set assembly and independent outer validation.                                                           |
| `scripts/release/release-set-publication.ts`, `release-set-reproducibility.ts`    | Trusted-private-root candidate validation, separate private cleanup, and final create-only hard link after cross-app gates. |
| `scripts/release/build.ts`, `verify.ts`, `smoke.ts`, `reproducibility.ts`         | Thin fixed-argument command entrypoints.                                                                                    |
| `scripts/release/release-coverage.ts`, `.test.ts`                                 | Separate unit/E2E coverage execution and fail-closed positive-total JSON/LCOV 100% gate.                                    |
| `scripts/release/*.test.ts`                                                       | Unit contracts for every release module, with injected ports and byte fixtures.                                             |
| `scripts/release/release-e2e.test.ts`                                             | Private fixture-repository compilation, verification, smoke, and two-build contract.                                        |
| `apps/config-search/src/index.ts`, `.test.ts`                                     | Typed unavailable CLI and public process behavior.                                                                          |
| `apps/config-search/package.json`, `apps/bot/package.json`, `package.json`        | Matching compiled app build tasks and root release scripts.                                                                 |
| `scripts/tooling/clean-artifacts.ts`, `.test.ts`                                  | Exact `releases` cleanup allowlist and symlink/idempotency test.                                                            |
| `.github/workflows/ci.yml`, `scripts/tooling/ci-format-workflow-contract.test.ts` | Frozen-install release-reproducibility CI job and artifact-upload contract.                                                 |

## Interfaces

```ts
export type ReleaseApplication = "bot" | "config-search";
export type ReleaseTarget = "bun-linux-x64";
export interface ReleaseCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}
export interface ReleaseProcessPort {
  run(input: {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  }): Promise<ReleaseCommandResult>;
}
export interface ReleaseGitPort {
  headCommit(): Promise<string>;
  headCommitEpoch(): Promise<string>;
  porcelainStatus(): Promise<string>;
}
export interface ReleaseToolchainPort {
  bunVersion(): Promise<string>;
  nodeVersion(): Promise<string>;
}
export interface ReleaseCompilerPort {
  compile(input: {
    readonly entryPoint: string;
    readonly outputPath: string;
    readonly target: ReleaseTarget;
  }): Promise<void>;
}
export type ReleasePathKind = "directory" | "missing" | "other" | "regular-file" | "symbolic-link";
export interface ReleaseFileSystemPort {
  chmod(path: string, mode: 0o644 | 0o755): Promise<void>;
  inspectPath(path: string): Promise<ReleasePathKind>;
  lstat(
    path: string,
  ): Promise<{ readonly isRegularFile: () => boolean; readonly isSymbolicLink: () => boolean }>;
  mkdir(path: string, mode: 0o755): Promise<void>;
  mkdtemp(input: ReleaseMkdtempInput): Promise<ReleasePrivateDirectory>;
  readFile(path: string): Promise<Uint8Array>;
  removePrivateDirectory(directory: ReleasePrivateDirectory): Promise<void>;
  removeFile(path: string): Promise<void>;
  writeFile(path: string, bytes: Uint8Array, mode: 0o644 | 0o755): Promise<void>;
}
export interface ReleaseMkdtempInput {
  readonly parentDirectory: string;
  readonly prefix: string;
}
export interface ReleaseDependencies {
  readonly compiler: ReleaseCompilerPort;
  readonly fileSystem: ReleaseFileSystemPort;
  readonly git: ReleaseGitPort;
  readonly process: ReleaseProcessPort;
  readonly repositoryRoot: string;
  readonly temporaryRoot: string;
  readonly toolchain: ReleaseToolchainPort;
}
export interface ReleaseBuildIdentity {
  readonly commit: string;
  readonly lockfileSha256: string;
  readonly sourceDateEpoch: number;
}
export interface ReleasePayloadInput {
  readonly bytes: Uint8Array;
  readonly mode: 0o644 | 0o755;
  readonly path: string;
}
export interface ReleasePrivateCandidate {
  readonly directory: string;
  readonly sidecarPath: string;
  readonly zipPath: string;
}
export interface ReleaseAssemblyResult {
  readonly candidate: ReleasePrivateCandidate;
  readonly manifest: ReleaseManifestV1;
}
export interface ReleaseVerificationInput {
  readonly sidecarBytes: Uint8Array;
  readonly zipBasename: string;
  readonly zipBytes: Uint8Array;
}
export interface ExtractedRelease {
  readonly executablePath: string;
  readonly manifest: ReleaseManifestV1;
  readonly rootDirectory: string;
}
export interface ConfigSearchOutput {
  readonly writeStderr: (text: string) => void;
  readonly writeStdout: (text: string) => void;
}
export interface ReleasePrivateDirectory {
  readonly path: string;
}
export function encodeStoreZip(entries: readonly ReleasePayloadInput[], sourceDateEpoch: number): Uint8Array;
export function verifyReleaseArchive(input: ReleaseVerificationInput): Promise<ReleaseManifestV1>;
export function runConfigSearchCli(argv: readonly string[], output: ConfigSearchOutput): number;
```

### Task 1: Define release contracts, ports, and deterministic binary primitives

**Files:**

- Create: `scripts/release/release-contract.ts`
- Create: `scripts/release/release-ports.ts`
- Create: `scripts/release/zip-store.ts`
- Create: `scripts/release/release-contract.test.ts`
- Create: `scripts/release/zip-store.test.ts`

**Interfaces:**

- Consumes: the Global Constraints and `ReleasePayloadInput` definitions above.
- Produces: `ReleaseApplication`, `ReleaseManifestV1`, `ReleaseProcessPort`, `ReleaseGitPort`, `ReleaseToolchainPort`, `ReleaseCompilerPort`, `encodeStoreZip`, `parseStoreZip`, `sha256Hex`, `canonicalJson`, `parseSha256Sidecar`, and `formatSha256Sidecar`.

- [ ] **Step 1: Write RED contract and ZIP tests.**

```ts
expect(canonicalJson({ b: 2, a: 1 })).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
expect(formatSha256Sidecar("a".repeat(64), "sample.zip")).toBe(`${"a".repeat(64)}  sample.zip\n`);
expect(() => encodeStoreZip([{ path: "../x", mode: 0o644, bytes: new Uint8Array() }], 1_788_199_914)).toThrow(
  "unsafe",
);
const oddEpochZip = encodeStoreZip(
  [{ path: "README.md", mode: 0o644, bytes: new Uint8Array() }],
  1_788_199_915,
);
expect(parseStoreZip(oddEpochZip).localAndCentralDosTimestamps).toEqual({
  local: normalizedDosTimestamp(1_788_199_915),
  central: normalizedDosTimestamp(1_788_199_915),
});
expect(await fileSystem.inspectPath(privateCompilerOutput)).toBe("symbolic-link");
```

- [ ] **Step 2: Run the RED tests.**

Run: `bun test scripts/release/release-contract.test.ts scripts/release/zip-store.test.ts`

Expected: FAIL because the release modules do not exist.

- [ ] **Step 3: Implement the minimal typed contracts and STORE writer.**

```ts
export const releaseApplications = ["bot", "config-search"] as const;
export const releaseTarget = "bun-linux-x64" as const;
export const requiredBunVersion = "1.3.14" as const;
export const requiredNodeMetadataVersion = "24.19.0" as const;

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), undefined, 2)}\n`;
}
```

Implement a recursive `sortJson` that accepts only `null`, booleans, finite
integers, strings, arrays, and plain records; sort record keys by code unit and
throw for every other value. Write ZIP integers with explicit little-endian
byte functions, calculate CRC-32 locally, and reject every entry that is not
one of `README.md`, `manifest.json`, or `bin/mm-crypto-bot-{app}` before ZIP
encoding. Define `mkdtemp({ parentDirectory, prefix })` as secure and
unpredictable. `inspectPath` returns `ReleasePathKind` and is private-only;
`lstat` supplies regular-file/symlink predicates for private files. The port
also exposes `mkdir`, private removal, and file removal/write operations.
`parseStoreZip` returns immutable parsed records and checks only ZIP structure;
it does not call the writer. The superseded whole-directory publication method
is not exported.

- [ ] **Step 4: Run the unit checkpoint.**

Run: `bun test scripts/release/release-contract.test.ts scripts/release/zip-store.test.ts && bunx tsc --project tsconfig.json --noEmit`

Expected: PASS; fixed ZIP fixture bytes, CRC, modes, sorted ordering, duplicate,
traversal, backslash, compression, extra-field, data-descriptor, comment, and
ZIP64 rejections are asserted. Private-path inspection tests distinguish
missing, regular-file, directory, symbolic-link, and other compiler output without invoking
publication; release-set publication tests later prove no final-path inspection
occurs.

### Task 2: Establish compiled application prerequisites

**Files (exclusive ownership):**

- Modify: `apps/config-search/src/index.ts`
- Modify: `apps/config-search/src/index.test.ts`
- Create: `apps/config-search/src/cli-e2e.test.ts`
- Modify: `apps/config-search/package.json`
- Modify: `apps/bot/package.json`

**Interfaces:**

- Consumes: no release module; this is the standalone config-search application
  boundary and the two compiled-app package boundaries.
- Produces: `ConfigSearchUnavailableResult`, `runConfigSearchCli`, the direct
  config-search entrypoint, and fixed package build commands for both apps.

- [ ] **Step 1: Write RED source and compiled-process CLI tests.**

```ts
expect(runConfigSearchCli([], output)).toBe(1);
expect(output.stdout).toBe(
  '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n',
);
expect(runConfigSearchCli(["--help"], output)).toBe(0);
expect(runCompiledConfigSearch(["--help"])).toMatchObject({ exitCode: 0 });
expect(runConfigSearchCli(["--search"], output)).toBe(2);
```

- [ ] **Step 2: Run the RED prerequisite tests.**

Run: `bun test apps/config-search/src/index.test.ts apps/config-search/src/cli-e2e.test.ts`

Expected: FAIL because source behavior, compiled E2E behavior, exit codes, and
package build setup are incomplete.

- [ ] **Step 3: Implement the closed unavailable surface and build commands.**

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

Use the specified insertion order and `JSON.stringify` plus LF for default and
`--status`. Implement exact `--help` text without a clock, color, configuration
read, or runtime-root access. The direct entrypoint sets
`process.exitCode = runConfigSearchCli(process.argv.slice(2), processOutput)`;
do not throw or import search/backtest/exchange/data/config modules. Configure
both application package build commands to compile their fixed entry point to
their fixed `dist/mm-crypto-bot-*` output using `bun-linux-x64`.

- [ ] **Step 4: Run and attest the prerequisite checkpoint.**

Run: `bun run --filter @mm-crypto-bot/config-search test && bun run --filter @mm-crypto-bot/config-search build && bun run --filter @mm-crypto-bot/bot typecheck && bun run --filter @mm-crypto-bot/config-search typecheck`

Expected: PASS; source and compiled config-search `--help` both exit `0`, while
default and `--status` write the exact one-LF unavailable JSON and exit `1`.

- [ ] **Step 5: Create the assembler prerequisite commit.**

After the checkpoint and exact-path review, the coordinator creates one atomic
Conventional Commit containing only this task's five owned paths. Task 3 may
start only from that committed prerequisite; it must not edit or absorb any
Task 2 path.

### Task 3: Assemble clean, self-contained release candidates through injected ports

**Files:**

- Create: `scripts/release/release-assembler.ts`
- Create: `scripts/release/release-assembler.test.ts`

**Interfaces:**

- Consumes: Task 1 contracts, the exact committed Task 2 package prerequisites,
  `encodeStoreZip`, `sha256Hex`, canonical manifest helpers, and the two fixed
  app entry paths.
- Produces: `assertReleasePreconditions`, `assembleRelease`,
  `assembleAllReleases`, and a private `ReleaseAssemblyResult` candidate.

- [ ] **Step 1: Write RED preflight and assembly tests.**

```ts
await expect(assembleRelease(dirtyDependencies, "bot")).rejects.toThrow("clean Git worktree");
await expect(assembleRelease(wrongBunDependencies, "bot")).rejects.toThrow("Bun 1.3.14");
await expect(assembleRelease(wrongNodeDependencies, "bot")).rejects.toThrow("Node metadata 24.19.0");
const result = await assembleRelease(cleanDependencies, "config-search");
expect(result.manifest.payloads.map((payload) => payload.path)).toEqual([
  "README.md",
  "bin/mm-crypto-bot-config-search",
]);
expect(result.candidate.directory).toContain("release-candidate-");
```

- [ ] **Step 2: Run the RED test.**

Run: `bun test scripts/release/release-assembler.test.ts`

Expected: FAIL because no assembly module exists.

- [ ] **Step 3: Implement fixed preflight and private candidate assembly.**

```ts
export async function assertReleasePreconditions(
  dependencies: ReleaseDependencies,
): Promise<ReleaseBuildIdentity>;
export async function assembleRelease(
  dependencies: ReleaseDependencies,
  application: ReleaseApplication,
): Promise<ReleaseAssemblyResult>;
```

Require `porcelainStatus() === ""`, a full lowercase commit, exact versions,
and an integer Git commit epoch whose normalized even value is ZIP-compatible
before `mkdtemp({ parentDirectory: temporaryRoot, prefix: "release-candidate-" })`. Compile with the exact argv
shape `bun build <entry> --compile --target=bun-linux-x64 --outfile <private>`.
Use `inspectPath` only on the compiler output inside the private candidate:
accept exactly `regular-file` and reject missing, directory, symbolic-link, and
other kinds. Then
construct the exact README, manifest, ZIP, and sidecar only in that private
candidate directory. The assembler has no final `releases/` destination input
and has no final destination input. It may write only within the private
candidate. Test `mkdtemp` failure, malformed or partial candidate output, and
every non-regular inspected compiler-output state; each failure must leave no
public release-set output.

- [ ] **Step 4: Run the assembly checkpoint.**

Run: `bun test scripts/release/release-assembler.test.ts && bun run --filter @mm-crypto-bot/bot typecheck && bun run --filter @mm-crypto-bot/config-search typecheck`

Expected: PASS; tests prove no compiler call occurs on every failed preflight,
the assembler cannot publish a final destination, and no repository source or
runtime input is read into the archive.

### Task 4: Build the independent verifier and command entrypoint

**Files:**

- Create: `scripts/release/release-verifier.ts`
- Create: `scripts/release/release-verifier.test.ts`
- Create: `scripts/release/verify.ts`

**Interfaces:**

- Consumes: Task 1 `parseStoreZip`, manifest types, sidecar parser, and Task 3
  private candidate artifact paths.
- Produces: `verifyReleaseArchive`, `verifyAllReleaseArchives`, and the `verify.ts` command entrypoint.

Task 7 atomically migrates the public per-app artifact verifier and `verify.ts`
entrypoint, including their existing tests, to the sole release-set ZIP. This
Task 4 contract remains the private inner verification prerequisite; it must
not be treated as a terminal public per-app layout.

- [ ] **Step 1: Write RED verifier tests from independently mutated bytes.**

```ts
await expect(verifyReleaseArchive(fixtureWithCentralOffsetMismatch)).rejects.toThrow("central directory");
await expect(verifyReleaseArchive(fixtureWithChangedPayload)).rejects.toThrow("SHA-256");
await expect(verifyReleaseArchive(fixtureWithSourceFile)).rejects.toThrow("forbidden entry");
await expect(verifyReleaseArchive(fixtureWithBadSidecar)).rejects.toThrow("sidecar");
```

- [ ] **Step 2: Run the RED verifier test.**

Run: `bun test scripts/release/release-verifier.test.ts`

Expected: FAIL because verifier exports do not exist.

- [ ] **Step 3: Implement independent validation.**

```ts
export interface ReleaseVerificationInput {
  readonly sidecarBytes: Uint8Array;
  readonly zipBytes: Uint8Array;
  readonly zipBasename: string;
}

export async function verifyReleaseArchive(input: ReleaseVerificationInput): Promise<ReleaseManifestV1>;
```

Reparse local headers and central directory directly from `zipBytes`; require
each metadata field to agree, offsets to point to its local header, no overlap,
and the exact three names/modes. Decode UTF-8 strictly, parse the manifest,
require `canonicalJson(parsed) === manifestBytes`, verify schema/value pins,
sorted payloads, all payload SHA-256 values, CRCs, and the external-config
contract. Hash raw ZIP bytes and require the one-line sidecar spelling exactly.

- [ ] **Step 4: Run the verifier checkpoint.**

Run: `bun test scripts/release/release-verifier.test.ts && bun scripts/release/verify.ts`

Expected: Unit PASS; CLI exits nonzero with an explicit missing-artifact error
when no real release has been built, rather than compiling or accepting a
partial destination.
