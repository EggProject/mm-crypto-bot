# DRAFT C4a typing source inventory

Recorded from `9add1e445841b67b8f36cf035590026ff2198000` before the atomic
source-tree removal.

- Source root: `temp/ts/typing`
- Regular files: 46; test files: 23; extracted literal suite/test names: 235
- Sorted SHA-256 manifest: `516fdf69ad399cdce4d5f719e3a229a89456f6bc8dfe9b17ec31a3eb3f262af1`
- Export-manifest SHA-256: `511be02aee1251063278746e66d9095e5ed70c2a475b8b554b976f46c6ad07d2`
- Literal test-name manifest SHA-256: `5ba22998fbf3edf63096eb84345283e479f0e832ba3749142609134b39b28ec5`

The durable inventories are [source file hashes](c4a-typing-source-hashes.tsv)
and [literal source test names](c4a-typing-source-test-names.tsv).

The literal test-name manifest was extracted with the TypeScript compiler API
from every `*.spec.ts`; each `describe`, `it`, or `test` call must have a string
literal first argument or extraction fails. The source test runner is not
baseline-runnable because its Vitest config imports unavailable `@nx/vite`.
The source-local ESLint config also imports a missing root config; root flat
ESLint reports 25 errors and zero warnings.

## Export inventory

The source public barrel declares: `Constructor`, `RemoveIndexSignature`,
`DeepPartial`, `FunctionPropertyNames`, `NonEmptyArray`, `NumericString`,
`OptionalToNullable`, `PropertyKeys`, `RequiredProperty`, `MaybeArray`,
`DeepKeys`, `DeepValue`, `getDeepValue`, `resolveNestedPath`, `BooleanResolver`,
`IntResolver`, `FloatResolver`, `NumberResolver`, `StringResolver`, and
`ValueResolver`.

## Keep and drop manifest

| Source item                                                              | Action                       | Rationale                                                                               |
| ------------------------------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------- |
| `Constructor`                                                            | Keep                         | Required by later guard and assertion foundations for class-based ports.                |
| `NonEmptyArray`                                                          | Keep                         | A minimal non-empty tuple contract for assertions and deterministic helpers.            |
| `MaybeArray`                                                             | Keep                         | A cross-domain input-shape type.                                                        |
| `DeepPartial`                                                            | Keep                         | A pure compile-time draft/config shape utility.                                         |
| `RequiredProperty`                                                       | Keep                         | A pure compile-time contract-strengthening utility.                                     |
| `RemoveIndexSignature`                                                   | Keep                         | A pure compile-time declared-field utility.                                             |
| Resolver aliases                                                         | Replace with `ValueResolver` | One generic type avoids duplicated primitive aliases.                                   |
| `NumericString`                                                          | Drop                         | It accepts scientific notation and does not satisfy the exact numeric contract.         |
| `DeepKeys`, `DeepValue`, `getDeepValue`, `resolveNestedPath`             | Drop                         | The runtime form uses dynamic reflective access and does not belong in this foundation. |
| `FunctionPropertyNames`, `PropertyKeys`, `OptionalToNullable`            | Drop                         | No active consumer requires them; they do not support the minimal foundation boundary.  |
| Nx project metadata, source README, source ESLint/Vitest config, `tslib` | Drop                         | They are source-tree tooling or dependency boilerplate, not the package contract.       |

The replacement intentionally has no compatibility export and no source-tree
fallback. Active workspace consumer count is zero; the existing non-workspace
`temp/ts/typeguard` and `temp/ts/assert` references are outside C4a ownership.
