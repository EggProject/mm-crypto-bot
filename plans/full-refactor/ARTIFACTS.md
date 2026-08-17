# Release Artifact Plan — DRAFT

**Status:** DRAFT. D-02 approves `MM_CRYPTO_BOT_RUNTIME_ROOT`; D-03 approves
Node.js `24.19.0` LTS full bundles, initially `linux-x64`. Phase 1 recorded the
official compatibility selection; build and artifact proof remain **NOT YET
EVIDENCED**.

## Required contract per deployable app

Each application (`apps/bot` and proposed `apps/config-search`) produces one
ZIP for every approved OS/architecture target. A release is target-specific,
self-contained, reproducible, and contains no source code, `node_modules`,
package manager, credentials, secrets, runtime configuration, state, logs, or
mounted data.

Proposed layout:

```text
<app>-<version>-<os>-<arch>.zip
  manifest.json
  checksums.sha256
  sbom.cdx.json
  licenses.json
  NOTICE
  bin/<approved-launcher>
  bundle/<built-runtime-output>
  config/<redacted-schema-or-example-only>
```

The exact launcher, bundler output, and whether a config schema is inside the
ZIP remain implementation choices subject to the approved contract. The
approved initial runtime is exact Node.js `24.19.0` LTS full bundle with `linux-x64` first;
`linux-arm64` requires reproducible target proof. The launcher fails closed when its exact
`24.19.0` Node patch is unavailable or does not match, and the D-03 provisioning
contract specifies how that runtime is supplied outside the ZIP.

## Manifest requirements

`manifest.json` must include app ID/version, source commit, dirty-worktree
status, exact Bun/build-tool versions, selected Node patch and launcher check,
target OS/architecture, deterministic build timestamp strategy and ZIP metadata
normalization, lockfile SHA-256,
every included file's SHA-256, SBOM and license report references, configuration
schema version, external data/runtime mount contract, and offline-smoke command
and result. It includes, or integrity-addressably references, machine-readable
dependency audit evidence containing tool/version, Europe/Budapest timestamp,
lockfile hash, command/result, and report hash. Exact financial/runtime secret
values never appear in it.

## Build and smoke workflow

1. Start two independent clean frozen Bun installations from the same recorded
   commit, exact lockfile, build inputs and approved target.
2. Build each target into an ignored temporary assembly directory.
3. Generate manifest/checksums/SBOM/license/audit evidence from the resolved
   lockfile and assembly contents.
4. Normalize timestamps, ownership/mode ordering and ZIP metadata; prove the two
   ZIP byte streams and SHA-256 hashes are identical. Then extract one into a
   fresh temporary directory with no
   repository source, no `node_modules`, and no network access.
5. Supply an explicitly mounted test-only external config/data root and launch
   the app's health/help/validation command using the approved Node version.
6. Assert absence of forbidden contents, manifest/hash integrity, expected exit
   code, structured stderr/stdout contract, and no outbound network attempt.

The bot smoke must not enable live mode or reach an exchange. The config-search
smoke uses deterministic fixtures and checks provenance rejection paths. Manifest
validation and smoke tests reject absent/invalid dependency-audit evidence,
incorrect lockfile hash, forbidden contents, and launcher Node-patch mismatch.
The artifact contains no provider credentials, provider cache, raw provider
response, or provider preflight result. Any research dataset is an external,
immutable canonical manifest/data mount; an offline release smoke never contacts
a CCXT provider.

## External runtime contract

`APPROVED D-02`: `MM_CRYPTO_BOT_RUNTIME_ROOT` is an operator-supplied absolute
external root for config, secrets, data, state, logs, and release extraction.
Version control
contains redacted examples, schemas, and documentation only. `data/` remains
the repository's source/data workflow root; mounted runtime data is outside the
ZIP. No hard-coded `/opt` path is assumed and this planning update performs no
external write.

## Release gates

The final artifact is eligible only after full `verify`, dependency audit and
license checks, no secret scan findings, manifest/hash validation, SBOM
generation, and one clean offline smoke result for every approved app-target
pair. Release outputs stay ignored until a separately approved external copy or
publication action.
