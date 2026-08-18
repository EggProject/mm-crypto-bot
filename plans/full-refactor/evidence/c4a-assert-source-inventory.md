# DRAFT C4a assert source inventory

Recorded from `9add1e445841b67b8f36cf035590026ff2198000` before atomic
source-tree removal.

- Source root: `temp/ts/assert`
- Regular files: 32; `*.spec.ts` files: 7
- Sorted SHA-256 manifest aggregate:
  `e221e129159b3531de07387666d06891fbe2cfd17500f0acb4512f7bf046c9f8`
- Durable file inventory: [source file hashes](c4a-assert-source-hashes.tsv)

## Export inventory

The retired source barrel declares per-predicate assertion functions and
exception classes for nil, function, non-nil, integer, array, non-empty array,
and string checks, plus a base exception.

## Keep and drop manifest

| Source item                                                      | Action | Rationale                                                                                                              |
| ---------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| One coded `AssertionError` class                                 | Keep   | A single typed error shape provides stable failure classification without duplicated exception boilerplate.            |
| Defined, integer, non-empty-array, record, and string assertions | Keep   | These are minimal assertion boundaries supported by the new public typeguard API.                                      |
| Per-predicate exception subclasses                               | Drop   | Error code plus message preserves actionable classification with less duplicated runtime surface.                      |
| Function and generic-array assertion helpers                     | Drop   | No active consumer needs them; callers can use the corresponding public guard when that narrower relation is required. |
| Source metadata/configuration, README, and `tslib`               | Drop   | They are source-tree tooling or dependency boilerplate, not the new internal package contract.                         |

The replacement has no compatibility export or alternate source path. At the
recording point, no first-party active workspace source/configuration/manifest
consumer imports this source tree. The separate `temp/ts/rxjs` tree is outside
this slice and is not a consumer claim.
