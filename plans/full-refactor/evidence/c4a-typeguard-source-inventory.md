# DRAFT C4a typeguard source inventory

Recorded from `9add1e445841b67b8f36cf035590026ff2198000` before atomic
source-tree removal.

- Source root: `temp/ts/typeguard`
- Regular files: 40; `*.spec.ts` files: 15
- Sorted SHA-256 manifest aggregate:
  `0bcf9c2a759311ab1346dd430397ecace649ec30d520d2f7a43d85595f060ce7`
- Durable file inventory: [source file hashes](c4a-typeguard-source-hashes.tsv)

## Export inventory

The retired source barrel declares: `isString`, `isFunction`,
`isFunctionReturnAny`, `isInstanceof`, `isBoolean`, `isNil`, `isNumeric`,
`isFloat`, `isInt`, `isObject`, `isNumber`, `isDateArray`, `isValidDate`,
`isConstructor`, and `isStringResolver`.

## Keep and drop manifest

| Source item                                                                                                                  | Action                       | Rationale                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| String, boolean, finite-number, safe-integer, nil, record, function, constructor, instance, date, and non-empty-array guards | Keep as focused replacements | They establish reusable unknown-boundary predicates without numeric string conversion.            |
| `isFunctionReturnAny`                                                                                                        | Drop                         | It expresses an unsafe return relation.                                                           |
| `isNumeric`, `isFloat`, and `isStringResolver`                                                                               | Drop                         | They encourage lossy or ambiguous numeric/string resolution outside the exact-value boundary.     |
| `isDateArray`                                                                                                                | Drop                         | The foundation keeps one composable array predicate instead of collection-specialized validation. |
| `isObject`                                                                                                                   | Replace with `isRecord`      | The new predicate excludes arrays and nil explicitly.                                             |
| `isInt`                                                                                                                      | Replace with `isInteger`     | The new predicate requires a finite safe integer.                                                 |
| Nx metadata, source README/configuration, and `tslib`                                                                        | Drop                         | They are source-tree tooling or dependency boilerplate, not the new internal package contract.    |

The replacement has no compatibility export or alternate source path. At the
recording point, no first-party active workspace source/configuration/manifest
consumer imports this source tree. The separate `temp/ts/rxjs` tree is outside
this slice and is not a consumer claim.
