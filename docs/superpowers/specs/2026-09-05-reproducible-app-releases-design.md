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

## Release contract

For application `A` at version `0.1.0`, target `bun-linux-x64`, release output
is exactly:

```text
releases/A/0.1.0/bun-linux-x64/
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

Compilation and assembly use a new private `mkdtemp` directory per attempt.
No build or test writes an executable, ZIP, extraction, or intermediate file to
the repository except the final ignored `releases/` destination produced by an
actual clean release build.

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

The root scripts are:

```json
{
  "release:build": "bun scripts/release/build.ts",
  "release:verify": "bun scripts/release/verify.ts",
  "release:smoke": "bun scripts/release/smoke.ts",
  "release:reproducibility": "bun scripts/release/reproducibility.ts"
}
```

`release:build` creates both application artifacts only after all preconditions.
`release:verify` verifies existing artifacts without compiling. `release:smoke`
verifies and smokes existing artifacts. `release:reproducibility` performs two
fresh private assemblies, verifies both ZIPs, asserts byte-for-byte equality and
sidecar equality, then runs the offline smoke for each application. It may write
only private temporary directories and its final ignored release destinations.

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

Smoke extraction creates a new private temporary directory, validates every
directory/file component with `lstat`, creates only `README.md`, `manifest.json`,
and the executable, and applies the manifest modes. It invokes no shell. On
Linux it launches each executable through a required `unshare --user
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

`apps/bot/package.json` changes its build task to make the target executable;
`apps/config-search/package.json` gains the matching build task. The root
`.gitignore` already ignores `/releases/`; `clean:artifacts` adds only the exact
`releases` directory to its existing safe allowlist and tests prove it neither
follows a symlink nor removes unknown files. CI adds a Linux release job using
the existing frozen install and exact Bun/Node setup, runs
`bun run release:reproducibility`, and uploads only `releases/**/*.zip` and
`releases/**/*.zip.sha256`.

This slice does not publish a release, change live-trading behavior, add an
external dependency, add SBOM/license generation, use Node as a runtime,
include source/config/data/secrets, use `openat`, `openat2`, `/proc` file
descriptors, a native descriptor adapter, a shell ZIP utility, or relax any
coverage/format/lint/type gate. Every new source and test file stays at most
500 lines and the owned release runtime has separate 100% unit and E2E coverage.
