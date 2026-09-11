# Reproducible Application Releases Plan — Tasks 5–7

This continuation retains the current private application-release APIs from
Tasks 1–4 and adds one dependency-closed release-set implementation scope.
Implementers do not stage or commit. The coordinator alone stages exact paths,
commits, and obtains independent actual-range `terra_reviewer` and
`luna_process_reviewer` reviews.

### Task 5: Retained private extraction, smoke, and reproducibility

**Current files and APIs:** `scripts/release/release-smoke.ts`,
`release-smoke.test.ts`, `release-smoke.e2e.test.ts`,
`release-private-candidate-reproducibility.ts`,
`release-private-candidate-reproducibility.test.ts`, and
`release-private-candidate-reproducibility.e2e.test.ts` use:

```ts
export async function extractVerifiedRelease(
  dependencies: ReleaseDependencies,
  artifact: ReleasePrivateCandidate,
): Promise<ExtractedRelease>;
export async function readVerifiedPrivateCandidate(
  dependencies: ReleaseDependencies,
  artifact: ReleasePrivateCandidate,
): Promise<VerifiedPrivateCandidateArchive>;
export interface VerifiedPrivateReleaseCandidate {
  readonly manifest: VerifiedPrivateCandidateArchive["manifest"];
  readonly sidecarBytes: Uint8Array;
  readonly zipBytes: Uint8Array;
}
export async function verifyPrivateReleaseCandidate(
  dependencies: ReleaseDependencies,
  artifact: ReleasePrivateCandidate,
): Promise<VerifiedPrivateReleaseCandidate>;
export async function smokeVerifiedRelease(
  dependencies: ReleaseDependencies,
  artifact: ReleasePrivateCandidate,
): Promise<void>;
export async function assertPrivateCandidateReproducibility(
  dependencies: ReleaseDependencies,
  app: unknown,
): Promise<void>;
export async function assertAllPrivateCandidateReproducibility(
  dependencies: ReleaseDependencies,
): Promise<void>;
```

- [ ] **Retained RED evidence:** `bun test scripts/release/release-smoke.test.ts scripts/release/release-private-candidate-reproducibility.test.ts`; negative cases cover unavailable `unshare`, invalid inner candidate, unequal builds, smoke failure, and private cleanup failure.
- [ ] **Retained behavior:** `readVerifiedPrivateCandidate` uses private-file
      `lstat`/read then the independent inner verifier; extraction uses
      `mkdtemp({ parentDirectory, prefix })`, private writes/removal, and guarded
      `unshare --user --map-root-user --net`. Two candidates per application are
      assembled, verified, byte-compared, and smoked, then private-cleaned. This
      task has no public destination, no link, and no publication operation.
- [ ] **Retained checkpoint:** `bun test scripts/release/release-smoke.test.ts scripts/release/release-smoke.e2e.test.ts scripts/release/release-private-candidate-reproducibility.test.ts scripts/release/release-private-candidate-reproducibility.e2e.test.ts`; expect private-only PASS or fail-closed before any public output.

### Task 6: Deferred root, cleaner, CI, and output wiring

This future target requires separate user approval and is not implemented,
staged, committed, or validated by this scope. A future CI upload may name only
this exact single artifact:

```text
releases/0.1.0/bun-linux-x64/mm-crypto-bot-release-set-0.1.0-bun-linux-x64.zip
```

It must not upload any sidecar or per-app archive. Root scripts, cleaner,
network, and actual project `releases/**` creation remain excluded here.

### Task 7: Implement and cover the immutable release set atomically

**Exact owned manifest (22 paths):**

- Create: `scripts/release/release-set-contract.ts`,
  `release-set-contract.test.ts`, `release-set-zip.ts`, `release-set-zip.test.ts`,
  `release-set-assembler.ts`, `release-set-assembler.test.ts`,
  `release-set-verifier.ts`, `release-set-verifier.test.ts`,
  `release-set-publication.ts`, `release-set-publication.test.ts`,
  `release-set-reproducibility.ts`, `release-set-reproducibility.test.ts`,
  `release-set-coverage.test.ts`, and `release-set.e2e.test.ts`.
- Modify: `scripts/release/release-ports.ts`,
  `scripts/release/release-coverage.ts`, `vitest.config.ts`, and
  `vitest.e2e.config.ts`, `scripts/release/release-artifact-verifier.ts`,
  `release-artifact-verifier.test.ts`, `scripts/release/verify.ts`, and
  `verify.test.ts`.

```ts
export type ReleaseSetPayload = Readonly<{ bytes: number; sha256: string }>;
export type ReleaseSetArtifactDescriptor = Readonly<ReleaseSetPayload & { path: string }>;
export type ReleaseSetApplicationRecord = Readonly<{
  app: ReleaseApplication;
  sidecar: ReleaseSetArtifactDescriptor;
  zip: ReleaseSetArtifactDescriptor;
}>;
export type ReleaseSetManifestV1 = Readonly<{
  applications: readonly [ReleaseSetApplicationRecord, ReleaseSetApplicationRecord];
  commit: string;
  lockfileSha256: string;
  schema: "mm-crypto-bot.release-set-manifest/v1";
  sourceDateEpoch: number;
  target: ReleaseManifestV1["target"];
  toolchain: ReleaseManifestV1["toolchain"];
  version: "0.1.0";
}>;
export type ReleaseSetInput = Readonly<{
  application: ReleaseApplication;
  innerManifest: ReleaseManifestV1;
  sidecarBytes: Uint8Array;
  zipBytes: Uint8Array;
}>;
export type ReleaseSetArchive = Readonly<{
  manifest: ReleaseSetManifestV1;
  zipBytes: Uint8Array;
}>;
export type ReleaseSetPrivateCandidate = Readonly<{
  archivePath: string;
  basename: "mm-crypto-bot-release-set-0.1.0-bun-linux-x64.zip";
  directory: ReleasePrivateDirectory;
  manifest: ReleaseSetManifestV1;
}>;
export type VerifiedReleaseSetArchive = Readonly<ReleaseSetArchive & { verified: true }>;
export type ReleasePublicationOutcome =
  | { readonly kind: "published" }
  | { readonly kind: "published-cleanup-failed" }
  | { readonly kind: "destination-exists" }
  | { readonly kind: "cross-device" }
  | { readonly kind: "publication-failed" };
export function deriveReleaseSetDestination(publicationRoot: string): string;
export function createReleaseSetManifest(inputs: readonly ReleaseSetInput[]): ReleaseSetManifestV1;
export function encodeReleaseSetZip(
  inputs: readonly ReleaseSetInput[],
  sourceDateEpoch: number,
): ReleaseSetArchive;
export function assembleReleaseSetCandidate(
  dependencies: ReleaseDependencies,
  inputs: readonly ReleaseSetInput[],
): Promise<ReleaseSetPrivateCandidate>;
export function verifyReleaseSetArchive(input: {
  readonly zipBytes: Uint8Array;
}): Promise<VerifiedReleaseSetArchive>;
export interface ReleasePublicationFileSystemPort {
  link(source: string, destination: string): Promise<void>;
}
export interface ReleaseSetPublicationDependencies {
  readonly privateCandidateFileSystem: Pick<
    ReleaseFileSystemPort,
    "lstat" | "readFile" | "removePrivateDirectory"
  >;
  readonly publicationFileSystem: ReleasePublicationFileSystemPort;
}
export function publishReleaseSet(
  input: {
    readonly candidate: ReleaseSetPrivateCandidate;
    readonly privateRoot: string;
    readonly publicationRoot: string;
  },
  dependencies: ReleaseSetPublicationDependencies,
): Promise<ReleasePublicationOutcome>;
export function assertReproducibleReleaseSet(input: {
  readonly releaseDependencies: ReleaseDependencies;
  readonly publicationDependencies: ReleaseSetPublicationDependencies;
  readonly publicationRoot: string;
}): Promise<ReleasePublicationOutcome>;
```

- [ ] **RED before runtime implementation:** write the eight new test files
      first: six unit tests plus `release-set-coverage.test.ts` and
      `release-set.e2e.test.ts`; first extend the two existing legacy-public
      verifier/CLI test files for the release-set-only contract. Run `bun test scripts/release/release-set-contract.test.ts scripts/release/release-set-zip.test.ts scripts/release/release-set-assembler.test.ts scripts/release/release-set-verifier.test.ts scripts/release/release-set-publication.test.ts scripts/release/release-set-reproducibility.test.ts scripts/release/release-set-coverage.test.ts scripts/release/release-set.e2e.test.ts scripts/release/release-artifact-verifier.test.ts scripts/release/verify.test.ts`; expect FAIL because no release-set runtime modules or migrated public verifier/CLI contract exist.
- [ ] **GREEN contract through verifier:** implement pure canonical manifest and
      STORE outer ZIP with exactly five `0644` UTF-16/code-unit ordered entries;
      inputs are inner ZIP+sidecar entry bytes in the private outer archive, never
      project release filesystem paths. Independently reject malformed, duplicate, traversal, wrong
      name/order/mode, noncanonical manifest, digest/length/sidecar/mapping/identity
      failures. `assembleReleaseSetCandidate` runs current inner verification then
      only `mkdtemp`/private write; `verifyReleaseSetArchive` never reuses writer
      logic. The caller retains the trusted caller-owned unpredictable private
      root separately from the candidate; candidate directory validation requires
      that root's direct child with the exact release-set temporary prefix and
      nonempty suffix, and its archive path's exact fixed-basename join. Run the
      focused command above after implementation.
- [ ] **GREEN canonical create-only publication:** derive the sole destination
      from trusted `publicationRoot` and the fixed version/target/basename; there is
      no arbitrary pathname parameter. Before the one `link`, publisher-owned
      synchronous pure validation checks caller-supplied `privateRoot`, its
      direct-child candidate directory, exact release-set temporary prefix plus
      nonempty suffix, fixed basename, and exact archive-path join; only then do
      private candidate `lstat`/read and `verifyReleaseSetArchive` run. Never read,
      inspect, or traverse destination. Cleanup is exactly
      `removePrivateDirectory(candidate.directory)` on the same restricted current
      filesystem port and never a public path. Public-input tests use a call ledger
      to prove every invalid path relationship, a forged candidate attempting to
      choose its own root, or a mismatch against caller `privateRoot` makes no
      `lstat`, `readFile`, `removePrivateDirectory`, or `link` call. They also prove
      the sole link destination is exact, no arbitrary pathname input exists,
      `assertReproducibleReleaseSet` explicitly passes
      `releaseDependencies.temporaryRoot`, link is after both apps' two-build
      verification, comparison, and smoke, regular-file, directory, and symlink candidate states yield no link,
      `EEXIST` preserves file/directory/symlink sentinels, `EXDEV` hard-fails,
      unknown failures are redacted, no outer sidecar exists, mismatch/smoke failure
      yields no link, and after-link cleanup failure reports published state without
      destination cleanup.
- [ ] **GREEN legacy public verifier/CLI migration:** modify only
      `release-artifact-verifier.ts` and `verify.ts` with their existing tests so
      the public verification path derives and validates the single outer
      release-set ZIP from an injected trusted publication root. It must never
      enumerate, inspect, or accept public per-app ZIP/sidecar paths; the retained
      inner verifier remains a private-byte dependency of the set verifier. No root
      script or actual project `releases/**` output is added.
- [ ] **GREEN coverage and E2E:** modify the existing coverage runner and both
      Vitest source lists so all ten runtime files have separate unit and E2E
      S/B/F/L 100% coverage: the six new release-set modules, `release-ports.ts`,
      `release-coverage.ts`, `release-artifact-verifier.ts`, and `verify.ts`.
      Require a strictly positive total for every required JSON-summary and LCOV
      source/metric before accepting 100%; change every total parser check to
      reject `total <= 0` and prove both synthetic JSON and LCOV zero-total
      rejection in the new coverage test. Leave the existing 499-line
      `release-coverage.test.ts` unchanged. The real same-temp-filesystem E2E
      proves hard-link identity and survival after private candidate removal. Run
      `bun run coverage:release`.
- [ ] **Final checkpoint:** run `bun test scripts/release/release-set-*.test.ts scripts/release/release-*.test.ts && bun run coverage:release && bunx tsc --project tsconfig.json --noEmit && bun run lint && bun run format:check && git diff --check && wc -l scripts/release/release-set-*.ts && bun run hook:pre-commit`; expect hard-100 per file, positive totals, all focused/release tests, typecheck, lint, Prettier, diff, LOC <=500, prohibited API/scope scan, and hook PASS. CI/root wiring, network, actual release output, OHLC, dependencies/lockfiles, cleaner, `rename`, `openat`, `/proc/self/fd`, native descriptor adapters, symlink publication, and copy fallback remain excluded.
- [ ] **One commit and reviews:** coordinator exact-stages only the 22 manifest
      paths, commits `feat(release): publish immutable release sets`, then obtains
      independent Terra technical and Luna process actual-range reviews. No valid
      finding remains before continuation.
