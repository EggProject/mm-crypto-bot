# Runtime Toolchain

## Current Runtime

Since 2026-09-13, new local development and release creation require Bun `1.4.2`
and Node `24.21.0`; this supersedes the prior runtime pins for new output. The repository pins Bun in `.bun-version`, the root
`packageManager`, and `engines`; it pins Node in `.nvmrc` and root `engines`.

Locally, start Node only through nvm:

```sh
: "${NVM_DIR:?NVM_DIR must name the nvm installation}"
source "$NVM_DIR/nvm.sh"
nvm exec 24.21.0 node --version
```

Do not install Node system-wide. GitHub Actions is the limited CI provisioning
exception: it currently uses the mutable `actions/setup-node@v4` major tag and
reads `.nvmrc`. Pinning that action immutably requires a separately owned CI
change.

## Release Manifest Compatibility

Release-manifest V1 is immutable historical input: verification accepts only
Bun `1.3.14` with Node metadata `24.19.0`. New release creation is V2 only and
uses Bun `1.4.2` with Node metadata `24.21.0`. Verification accepts either
homogeneous V1 or homogeneous V2 artifacts; creation must never emit V1 or mix
the two contracts.

## Dependency and History Rules

`bun.lock` is generated only by the pinned Bun runtime. Do not edit it by hand.
The historical planning, research, report, and evidence documents remain
immutable; this file records the current migration without rewriting them.

## Rollback

Revert the reviewed runtime-pin commit as one atomic change, restoring the
matching lockfile. Do not change a historical manifest contract, CI action pin,
or dependency version as part of rollback.
