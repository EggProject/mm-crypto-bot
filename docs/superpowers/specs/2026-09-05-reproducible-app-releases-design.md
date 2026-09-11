# Reproducible Application Releases Design

## Status and decision

This design is the approved implementation contract for reproducible application
releases. It supersedes the older Node-runtime-bundle proposal only for this
release slice: Bun `1.3.14` compiles both deployable applications to standalone
`bun-linux-x64` executables. Node `24.19.0` remains an exact, independently
verified toolchain metadata pin; it is not a launcher requirement and this
change does not migrate either application to a Node runtime.

The two deployable applications are `apps/bot` (`bot`) and
`apps/config-search` (`config-search`). A release build never publishes an
artifact and has no exchange, data-provider, credential, configuration, state,
or network authority.

## Inner application archive contract (retained)

For application `A` at version `0.1.0`, target `bun-linux-x64`, the private
candidate contains an inner archive and sidecar whose entry basenames are:

```text
mm-crypto-bot-A-0.1.0-bun-linux-x64.zip
mm-crypto-bot-A-0.1.0-bun-linux-x64.zip.sha256
```

The ZIP contains exactly three regular files at its root:

```text
README.md
manifest.json
bin/mm-crypto-bot-A
```

`bin/mm-crypto-bot-A` has POSIX mode `0755`; `README.md` and `manifest.json`
have mode `0644`. The executable is a standalone output of:

```text
bun build <application entry point> --compile --target=bun-linux-x64 --outfile <private temporary path>
```

Every assembly attempt creates one new, unpredictable, private candidate
directory through the filesystem port's secure temporary-directory primitive.
It owns the complete candidate tree, including the ZIP and sidecar; it never
writes below `releases/`. The later release-set orchestrator consumes the two
private ZIP-and-sidecar pairs; no inner assembler publishes a public path. No
build or test writes an executable, ZIP, extraction, or intermediate file to
the repository.

### Candidate filesystem contract

The filesystem port's `mkdtemp({ parentDirectory, prefix })` creates a fresh,
unpredictable `ReleasePrivateDirectory { path }` beneath a trusted private
temporary root. Predictable names and caller-created temporary directories are
forbidden. The returned directory is the only location to which assembly and
smoke extraction may write.

`inspectPath` returns `ReleasePathKind`; `lstat` returns a stat-like regular-
file/symlink predicate for a compiler output or private candidate file. They
reject malformed private inputs before bytes are accepted. They are not a
final-destination guard and must never precede destination publication.

The obsolete `publishCandidateDirectory` whole-directory move and two-public-
directory layout are superseded as public publication semantics. They do not
alter this private candidate contract, the inner ZIP+sidecar layout, compiler
preflight, independent verifier, guarded smoke, or private two-build gate.

### Release manifest

`manifest.json` is UTF-8, two-space-indented canonical JSON ending in one LF.
It has no generated-now timestamp. Its exact logical shape is:

```ts
export type ReleaseApplication = "bot" | "config-search";

export interface ReleasePayload {
  readonly bytes: number;
  readonly mode: "0644" | "0755";
  readonly path: "README.md" | `bin/mm-crypto-bot-${ReleaseApplication}`;
  readonly sha256: string;
}

export interface ReleaseManifestV1 {
  readonly app: ReleaseApplication;
  readonly commit: string;
  readonly configuration: {
    readonly embedded: false;
    readonly external: true;
    readonly runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT";
  };
  readonly lockfileSha256: string;
  readonly payloads: readonly ReleasePayload[];
  readonly schema: "mm-crypto-bot.release-manifest/v1";
  readonly sourceDateEpoch: number;
  readonly target: {
    readonly arch: "x64";
    readonly bunTarget: "bun-linux-x64";
    readonly os: "linux";
  };
  readonly toolchain: {
    readonly bun: "1.3.14";
    readonly nodeMetadata: "24.19.0";
  };
  readonly version: "0.1.0";
}
```

Object keys follow the declaration order above. `payloads` is ascending by
bytewise POSIX path and covers `README.md` plus the executable; it cannot cover
`manifest.json` without a circular self-hash. `lockfileSha256` is the SHA-256
of the exact repository `bun.lock`. Every SHA-256 is lowercase hexadecimal.
The deterministic README uses only LF line endings and states the application,
version, target, executable path, and that all runtime configuration, secrets,
state, and data are external through `MM_CRYPTO_BOT_RUNTIME_ROOT`.

### Deterministic ZIP encoding

The release writer implements ZIP STORE itself; it never calls a shell `zip`
program and takes no compression-library dependency. It accepts only a
prevalidated list of regular in-memory payloads. Entry paths are normalized
POSIX relative paths and sorted lexicographically before writing. It rejects an
empty path, an absolute path, backslash, NUL, `.` or `..` component, duplicate,
symlink, non-regular source, and a path outside the three exact allowed names.

The writer emits local headers, file data, central-directory entries, and an
end-of-central-directory record. Every entry uses method `0` (STORE), general
purpose flag `0`, a calculated CRC-32, no data descriptor, no extra field, no
archive comment, Unix creator `3`, and fixed external POSIX mode attributes.
`SOURCE_DATE_EPOCH` records the exact committing Git timestamp in UTC in the
manifest. It must be an integer. ZIP local and central headers use the
deterministically normalized timestamp `epoch - (epoch % 2)`, which must be in
the ZIP DOS date range; otherwise the release fails. ZIP64 is not supported:
any size or offset that needs it is a hard error.

The sidecar has exactly one ASCII line:

```text
<64-lowercase-hex-sha256><two spaces><zip basename>\n
```

It hashes the ZIP bytes, not an extracted tree.

## Immutable public release-set contract

The only public regular file for version `0.1.0` and target `bun-linux-x64` is:

```text
releases/0.1.0/bun-linux-x64/
  mm-crypto-bot-release-set-0.1.0-bun-linux-x64.zip
```

There is no outer sidecar: two filesystem entries cannot be the approved atomic
unit. The deterministic outer STORE ZIP contains exactly five `0644` regular
files in UTF-16/code-unit path order:

```text
apps/bot/mm-crypto-bot-bot-0.1.0-bun-linux-x64.zip
apps/bot/mm-crypto-bot-bot-0.1.0-bun-linux-x64.zip.sha256
apps/config-search/mm-crypto-bot-config-search-0.1.0-bun-linux-x64.zip
apps/config-search/mm-crypto-bot-config-search-0.1.0-bun-linux-x64.zip.sha256
release-set-manifest.json
```

`release-set-manifest.json` is canonical two-space JSON plus LF with schema
`mm-crypto-bot.release-set-manifest/v1`. It records common `commit`,
`lockfileSha256`, `sourceDateEpoch`, `target`, `toolchain`, and `version`, plus
exactly two app records in this canonical array order: `["bot",
"config-search"]`. Each app record identifies its exact ZIP path and sidecar
path and records `{bytes, sha256}` for both. It does not self-hash.

The specialized set codec accepts only prevalidated in-memory regular inputs,
uses STORE, and rejects malformed, duplicate, traversal, wrong name/order/mode,
and unsupported ZIP-feature entries. The set verifier independently parses the
outer ZIP; validates exact layout/names/order/modes, manifest canonical
bytes/schema, all four manifest byte lengths/digests, and each inner sidecar
spelling; verifies each existing inner archive via the current independent
verifier; and requires common identity equality across the set and both inner
manifests. No legacy public per-app layout remains as an alternative.

The contract/codec is pure: `createReleaseSetManifest(inputs)` and
`encodeReleaseSetZip(inputs)` each accept either input permutation only when it
contains exactly one `bot` and one `config-search`, then deterministically
reorder it to the canonical order above; equivalent permutations therefore
produce byte-identical manifests and ZIPs. The ZIP codec derives its only
normalized DOS timestamp from the canonical manifest's shared
`sourceDateEpoch`; it accepts no independent timestamp parameter and never
consults a clock. The verifier rejects a reversed or otherwise noncanonical
manifest array and rejects any outer local or central header timestamp that is
not the normalized manifest `sourceDateEpoch`. Codec tests prove that both
input permutations retain that one timestamp source; independently mutated
local and central timestamp mismatches are negative verifier cases. The only
temporary directory prefix is the literal exported
`releaseSetCandidatePrefix = "release-set-candidate-" as const`; the assembler,
publisher-owned validation, and all positive and negative tests import that one
constant. A separate injected private-candidate assembler first invokes the
inner verifier, then uses `mkdtemp` with that prefix to create the archive under
a secure private directory and returns `{ archivePath, basename,
directory: ReleasePrivateDirectory, manifest }`, where `basename` is exactly
`mm-crypto-bot-release-set-0.1.0-bun-linux-x64.zip`. The independent set
verifier returns `VerifiedReleaseSetArchive` from `{ zipBytes }` and never uses
writer logic.

Publication follows only after both apps have been independently assembled
twice, verified, byte-compared, and smoked. `assertReproducibleReleaseSet`
retains the in-memory ZIP, sidecar, and manifest values read from each app's
first independently verified candidate. For each canonical app it assembles
the first candidate, independently reads/verifies it, assembles and
independently reads/verifies the second candidate, byte-compares their ZIP and
sidecar values, then smokes both candidates; only after both applications pass
does it assemble exactly one outer candidate from the retained first-candidate
values. It never creates a third per-app candidate after those gates. The inner
private directories may be cleaned only after their verified byte snapshots
have been retained, and outer-candidate/private cleanup remains the separate
publisher responsibility described below. Orchestration tests prove that every
outer inner ZIP/sidecar byte is exactly the retained, independently verified
first-candidate byte, including when a distinct unverified third-build fixture
is available. It uses only Node/Bun
`fsPromises.link(sourceArchivePath, destinationArchivePath)` as one create-only
operation. A pure `deriveReleaseSetDestination(publicationRoot)` is the only
destination derivation: it appends exactly
`0.1.0/bun-linux-x64/mm-crypto-bot-release-set-0.1.0-bun-linux-x64.zip` to the
caller-supplied trusted process-controlled `publicationRoot`. Publisher and
reproducibility APIs accept that root, never an arbitrary destination pathname.
The required derived-parent tree already exists, is non-symlinked and
process-controlled; publication does no destination precheck or inspection.
Never overwrite, rename, merge, copy-fallback, or create a second public
sidecar. Map `EEXIST`, `EXDEV`, and other failures to stable redacted typed
outcomes; `EXDEV` is a hard failure and proves the candidate was not on the
publication filesystem.

`ReleaseSetPrivateCandidate` contains only the returned
`ReleasePrivateDirectory`, fixed archive basename, archive path, and manifest;
it cannot choose its own trust anchor. `publishReleaseSet` receives a separate,
caller-supplied trusted `privateRoot` input. Before _any_ filesystem or
publication-port call, publisher-owned pure validation requires that valid
private root; a candidate directory that is its direct child; the exact
`releaseSetCandidatePrefix` followed by a nonempty suffix; the fixed basename;
and an archive path exactly equal to that direct child's basename join. An empty
suffix or wrong prefix fails before every filesystem, cleanup, or link-port
call. The publisher then uses its current restricted private-candidate
filesystem capability for `lstat`/read and the independent set verifier
validates the bytes. A malformed root/path relationship or a
non-regular/symlink source is a no-link failure.

`ReleaseSetPublicationDependencies` has exactly two capabilities:
`privateCandidateFileSystem: Pick<ReleaseFileSystemPort, "lstat" | "readFile" |
"removePrivateDirectory">` and a separate publication port that owns only
`link(source, destination)` and its Node/Bun adapter. The publisher uses the
independent set verifier immediately before link; it still never reads,
inspects, or traverses the destination. Private cleanup is exactly
`removePrivateDirectory(candidate.directory)` on that current restricted port;
it is distinct from the project cleaner and has no public-root or destination
operation.

Without descriptor APIs, pathname `link()` cannot prevent hostile replacement
of an ancestor component. The publication-parent tree must already exist, be
non-symlinked and process-controlled, and have no hostile concurrent writer;
this is explicit, not a stronger guarantee. Candidate content must be verified
regular non-symlink content in a caller-owned unpredictable private root and
immutable-by-protocol after verification. Before-link failure may remove only
proven private candidates and never destination. After a successful link,
publication is visible and never rolled back or destination-cleaned; the exact
private-directory cleanup is attempted separately and its failure retains
published state. Invalid pure candidate-path input makes no `lstat`, `readFile`,
`removePrivateDirectory`, or `link` call. A failed post-validation pre-link
operation may remove only `candidate.directory`, never a destination or another
path.

`assertReproducibleReleaseSet` supplies its own
`releaseDependencies.temporaryRoot` explicitly as `publishReleaseSet`'s trusted
`privateRoot`; a forged candidate cannot replace that value. It must pass the
outer assembler only the first-candidate snapshots that survived the complete
two-build verify/compare/smoke gate; neither a later assembly nor raw,
unverified candidate bytes may enter the outer ZIP.

## Build preconditions and ports

The real CLI checks before creating its temporary build directory:

1. `git rev-parse --verify HEAD^{commit}` returns one full lowercase 40-hex
   commit ID.
2. `git status --porcelain=v1 --untracked-files=all` has empty stdout.
3. `git show -s --format=%ct HEAD` returns an integer; its normalized value
   `epoch - (epoch % 2)` is ZIP-compatible.
4. `bun --version` is exactly `1.3.14`, `node --version` is exactly `v24.19.0`,
   root `package.json` engines/package-manager and `.bun-version`/`.nvmrc`
   express those same pins, and `bun.lock` exists as a regular file.
5. The selected app package version is exactly `0.1.0` and its known entry point
   is regular and non-symlinked.

The existing root `release:verify`, `coverage:release`,
`coverage:release:unit`, and `coverage:release:e2e` scripts remain unchanged by
this scope. The following are the only future, separately approved root-wiring
examples; their referenced `build.ts`, `smoke.ts`, and `reproducibility.ts`
entrypoints are excluded from this 22-path release-set scope and are not current
repository files:

```json
{
  "release:build": "bun scripts/release/build.ts",
  "release:smoke": "bun scripts/release/smoke.ts",
  "release:reproducibility": "bun scripts/release/reproducibility.ts"
}
```

The retained private reproducibility gate assembles two fresh candidates per
application, independently verifies each pair, compares ZIP and sidecar bytes,
and smokes both. The release-set orchestrator then performs this across both
applications, independently verifies the set, and calls `fsPromises.link`
exactly once for the first complete set archive. In the same atomic migration,
the legacy public per-app artifact verifier and its `verify.ts` CLI are
release-set-only: they derive the fixed outer archive from an injected trusted
publication root and validate that one ZIP, never probe, enumerate, or accept a
legacy public per-app ZIP/sidecar layout. `release:smoke` remains private-only
until separately approved root wiring. Any failed preflight, assembly,
verification, comparison, smoke, or publication leaves no public release-set
file; an already-present destination is never overwritten.

All modules receive filesystem, Git, toolchain, compiler, and subprocess ports;
tests use injected fakes. A dirty integration worktree therefore tests all
negative and positive contracts without invoking the real clean-release gate.
The production adapters use fixed argv arrays, never shell strings.

## Verification and offline smoke

The verifier is independent of the writer. It reparses bytes of the ZIP local
headers and central directory without `unzip` or a ZIP package. It rejects an
invalid signature, mismatched local/central metadata or offsets, compression,
data descriptors, flags, extra fields, comments, ZIP64, duplicate or unsafe
names, unknown entries, noncanonical modes, CRC mismatch, size mismatch,
manifest noncanonical bytes, schema/type failure, mismatched payload digest,
mismatched target/toolchain/configuration fields, or a malformed/mismatched
sidecar. It also rejects `node_modules`, source extensions, package-manager
files, configuration, data, secrets, state, logs, and every entry outside the
three-name allowlist.

Smoke extraction uses a fresh private candidate directory, creates only
`README.md`, `manifest.json`, and the executable from already-verified in-memory
bytes, and applies the manifest modes. It invokes no shell. On Linux it launches
each executable through a required `unshare --user
--map-root-user --net` network namespace. An unavailable or unsuccessful
network namespace is a smoke failure; there is no unguarded fallback. The child
environment is an explicit allowlist containing `PATH`, `HOME` set to a private
temporary directory, `LANG=C`, `LC_ALL=C`, `TZ=UTC`, and no proxy, credential,
runtime-root, config, data, or state variables. Bot smoke runs `--help` and
expects exit `1`; config-search runs `--help` (exit `0`) and `--status` (exit
`1` plus its canonical unavailable JSON). No smoke operation may call an
exchange or provider.

## Config-search CLI contract

`apps/config-search` is an explicit unavailable application, not a dormant
search implementation. Its compiled and source CLI has only `--help` and
`--status` forms. `--help` writes deterministic plain-text usage and exits `0`.
No argument and `--status` write exactly this one-LF JSON document and exit `1`:

```text
{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}
```

Any other argument writes deterministic usage to stderr and exits `2`. The
module has no imports from search, backtest execution, exchange, data, network,
or configuration loaders; it cannot initiate a search.

## Integration and non-goals

The standalone config-search CLI and both application package build tasks are
completed and atomically committed before the release assembler is introduced;
the assembler task depends on that exact prerequisite commit. Root scripts,
`.gitignore`/cleaner integration, CI, upload, and real project `releases/**`
creation remain future wiring targets that require separate approval. Their
future publication/upload contract must name only the release-set ZIP, not
legacy public per-app ZIP/sidecar entries; this docs-only slice does not
implement them.

This slice does not publish a release, change live-trading behavior, add an
external dependency or change a lockfile, add SBOM/license generation, use Node as a runtime,
include source/config/data/secrets, use `openat`, `openat2`, `/proc` file
descriptors, a native descriptor adapter, a shell ZIP utility, or relax any
coverage/format/lint/type gate. Every new source and test file stays at most
500 lines. The ten Task 7 owned changed/new runtime files have separate 100%
unit and E2E coverage: the six release-set modules, `release-ports.ts`,
`release-coverage.ts`, `release-artifact-verifier.ts`, and `verify.ts`. This
does not narrow the retained source unions: unit remains exactly 17 sources
(the current ten plus those six modules and `release-ports.ts`), and E2E remains
exactly 13 sources (the current three plus those six modules,
`release-ports.ts`, `release-coverage.ts`, `release-artifact-verifier.ts`, and
`verify.ts`). The new coverage test locks both exact lists as a regression
contract. Both the JSON summary and LCOV parser require strictly positive totals
for every required source and metric before accepting 100% coverage.
Tests include malformed/duplicate/traversal/wrong outer-entry cases;
equivalent input permutations producing identical outer bytes; reversed
manifest-array rejection; noncanonical manifest, digest, length, sidecar,
mapping, and identity cases; wrong-prefix and empty-suffix candidates rejected
before every port call;
link ordering and no-destination-inspection; public-input call ledgers proving
invalid candidate paths make no filesystem/cleanup/link call; `EEXIST`
sentinels, `EXDEV`, and redacted unknown failure; same-filesystem hard-link
survival; no-link mismatch or smoke failure; and post-link cleanup-failure
published state.
