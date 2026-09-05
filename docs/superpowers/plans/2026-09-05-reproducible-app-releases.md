# Reproducible Application Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce verified, byte-reproducible, target-specific Bun executable ZIP releases for `bot` and `config-search` without embedding configuration, data, source, or secrets.

**Architecture:** Typed release modules assemble only prevalidated in-memory payloads in private temporary directories and write a deterministic ZIP STORE archive. An independent parser validates the archive and a Linux network-namespace smoke harness executes only safe CLI forms. Release entrypoints depend on injected Git, toolchain, filesystem, compiler, and process ports so unit tests exercise contracts while the dirty integration worktree remains ineligible for real release creation.

**Tech Stack:** Bun `1.3.14`, Node `24.19.0` metadata pin, TypeScript, Node built-in `crypto`, `fs/promises`, `os`, `path`, Bun compile, Bun test, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-reproducible-app-releases-design.md`

Tasks 4–6 continue in [`2026-09-05-reproducible-app-releases-tasks-4-6.md`](2026-09-05-reproducible-app-releases-tasks-4-6.md).

## Global Constraints

- Build and runtime basis is Bun `1.3.14`; Node `24.19.0` is verified metadata only and never a release runtime requirement.
- Release targets are only `bot` and `config-search`, version `0.1.0`, target `bun-linux-x64`, and the exact release paths named in the Spec.
- Build uses a standalone `bun build --compile --target=bun-linux-x64` executable in a private `mkdtemp` directory; no source, `node_modules`, package manager, config, data, state, logs, credentials, or secrets enter the ZIP.
- ZIP is an in-process deterministic STORE writer: sorted POSIX paths, fixed compatible Git timestamp, no compression/extra fields/comments, fixed modes, exact bytes; shell `zip` and new dependencies are forbidden.
- Real release creation requires a clean exact Git commit and exact Bun/Node/toolchain metadata; any discrepancy fails closed. Tests use injected ports and may run in this dirty worktree.
- Config-search only implements `--help`, unavailable default, and unavailable `--status`; it never searches or imports a search/exchange/data/config execution path.
- Verification independently parses central and local ZIP headers and validates paths, modes, hashes, manifest, forbidden contents, and sidecar.
- Smoke extraction is private, safe, outbound-network guarded with required Linux `unshare --user --map-root-user --net`, and runs only bot `--help` plus config-search `--help`/`--status`.
- `clean:artifacts` may delete only its exact `releases` allowlist entry; CI runs reproducibility then uploads ZIPs and sidecars. No publishing occurs.
- No `openat`, `openat2`, `/proc` file descriptors, native descriptor adapters, unsafe assertions, `any`, suppressions, weakened gates, shell interpolation, or files over 500 lines.
- Every owned release runtime source has 100% statements, branches, functions, and lines in separate unit and E2E coverage reports.
- The coordinator may land each completed task scope as a separate exact-path Conventional Commit after that scope's gates; incomplete or finding-blocked files remain uncommitted. Clean-worktree real release compilation, reproducibility, and smoke still wait for the relevant exact release implementation commits and all final integration gates. Individual tasks end in verification checkpoints and must not stage or touch unrelated dirty-union paths.

---

## File Map

| Path                                                                              | Responsibility                                                                           |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `scripts/release/release-contract.ts`                                             | App/target constants, manifest and result types, canonical JSON/sidecar helpers.         |
| `scripts/release/release-ports.ts`                                                | Injected filesystem, Git, toolchain, compiler, and process interfaces plus Bun adapters. |
| `scripts/release/zip-store.ts`                                                    | Strict payload validation and deterministic ZIP STORE encode/decode primitives.          |
| `scripts/release/release-assembler.ts`                                            | Clean preflight, private compilation, manifest/README assembly, and final output write.  |
| `scripts/release/release-verifier.ts`                                             | Independent ZIP/sidecar/manifest/payload validation.                                     |
| `scripts/release/release-smoke.ts`                                                | Safe extraction and Linux network-namespace subprocess smoke.                            |
| `scripts/release/release-reproducibility.ts`                                      | Two fresh assemblies plus byte and SHA equality assertion.                               |
| `scripts/release/build.ts`, `verify.ts`, `smoke.ts`, `reproducibility.ts`         | Thin fixed-argument command entrypoints.                                                 |
| `scripts/release/release-coverage.ts`, `.test.ts`                                 | Separate unit/E2E coverage execution and fail-closed LCOV 100% gate.                     |
| `scripts/release/*.test.ts`                                                       | Unit contracts for every release module, with injected ports and byte fixtures.          |
| `scripts/release/release-e2e.test.ts`                                             | Private fixture-repository compilation, verification, smoke, and two-build contract.     |
| `apps/config-search/src/index.ts`, `.test.ts`                                     | Typed unavailable CLI and public process behavior.                                       |
| `apps/config-search/package.json`, `apps/bot/package.json`, `package.json`        | Matching compiled app build tasks and root release scripts.                              |
| `scripts/tooling/clean-artifacts.ts`, `.test.ts`                                  | Exact `releases` cleanup allowlist and symlink/idempotency test.                         |
| `.github/workflows/ci.yml`, `scripts/tooling/ci-format-workflow-contract.test.ts` | Frozen-install release-reproducibility CI job and artifact-upload contract.              |

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

export interface ReleaseFileSystemPort {
  chmod(path: string, mode: 0o644 | 0o755): Promise<void>;
  lstat(
    path: string,
  ): Promise<{ readonly isRegularFile: () => boolean; readonly isSymbolicLink: () => boolean }>;
  mkdtemp(prefix: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array, mode: 0o644 | 0o755): Promise<void>;
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

export interface ReleaseArtifactPaths {
  readonly sidecarPath: string;
  readonly zipPath: string;
}

export interface ReleaseAssemblyResult {
  readonly artifact: ReleaseArtifactPaths;
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
encoding. `parseStoreZip` returns immutable parsed records and checks only ZIP
structure; it does not call the writer.

- [ ] **Step 4: Run the unit checkpoint.**

Run: `bun test scripts/release/release-contract.test.ts scripts/release/zip-store.test.ts && bunx tsc --project tsconfig.json --noEmit`

Expected: PASS; fixed ZIP fixture bytes, CRC, modes, sorted ordering, duplicate,
traversal, backslash, compression, extra-field, data-descriptor, comment, and
ZIP64 rejections are asserted.

### Task 2: Assemble clean, self-contained releases through injected ports

**Files:**

- Create: `scripts/release/release-assembler.ts`
- Create: `scripts/release/release-assembler.test.ts`
- Modify: `apps/bot/package.json`
- Modify: `apps/config-search/package.json`

**Interfaces:**

- Consumes: Task 1 contracts, `encodeStoreZip`, `sha256Hex`, canonical manifest helpers, and the two fixed app entry paths.
- Produces: `assertReleasePreconditions`, `assembleRelease`, `assembleAllReleases`, and `ReleaseAssemblyResult`.

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
```

- [ ] **Step 2: Run the RED test.**

Run: `bun test scripts/release/release-assembler.test.ts`

Expected: FAIL because no assembly module exists.

- [ ] **Step 3: Implement fixed preflight and private assembly.**

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
before `mkdtemp`. Compile with the exact argv
shape `bun build <entry> --compile --target=bun-linux-x64 --outfile <private>`.
Read the output using `lstat`; reject symlink/non-regular input, change its
mode to `0755` only in the private directory, then construct the exact README,
manifest, ZIP, and sidecar. Write final files atomically only below the exact
application/version/target destination after `resolveSafeReleaseDestination`
has rejected a symlinked component or non-directory ancestor. Package `build`
scripts compile their own fixed entry point to `dist/mm-crypto-bot-bot` and
`dist/mm-crypto-bot-config-search` with the same Bun target.

- [ ] **Step 4: Run the assembly checkpoint.**

Run: `bun test scripts/release/release-assembler.test.ts && bun run --filter @mm-crypto-bot/bot typecheck && bun run --filter @mm-crypto-bot/config-search typecheck`

Expected: PASS; tests prove no compiler call occurs on every failed preflight,
the destination is exact, and no repository source or runtime input is read
into the archive.

### Task 3: Build the independent verifier and command entrypoint

**Files:**

- Create: `scripts/release/release-verifier.ts`
- Create: `scripts/release/release-verifier.test.ts`
- Create: `scripts/release/verify.ts`

**Interfaces:**

- Consumes: Task 1 `parseStoreZip`, manifest types, sidecar parser, and Task 2 output paths.
- Produces: `verifyReleaseArchive`, `verifyAllReleaseArchives`, and the `verify.ts` command entrypoint.

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
