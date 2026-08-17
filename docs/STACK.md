# Stack (version pins)

| Component | Version | Source |
|---|---|---|
| Runtime | Bun `1.3.14` | [registry.npmjs.org/bun](https://registry.npmjs.org/bun) |
| Monorepo / pipeline | Turborepo `2.10.2` | [registry.npmjs.org/turbo](https://registry.npmjs.org/turbo) |
| Language | TypeScript `6.0.3` (ultra-strict) | [registry.npmjs.org/typescript](https://registry.npmjs.org/typescript) |
| Exchange | CCXT `4.5.64` (`bybiteu` ID) | [registry.npmjs.org/ccxt](https://registry.npmjs.org/ccxt) |
| Linter | ESLint `10.6.0` + typescript-eslint `8.62.1` strict-type-checked + eslint-plugin-security `4.0.1` | [typescript-eslint.io](https://typescript-eslint.io/users/configs/) |
| Test runners | Bun `1.3.14` for workspace and subprocess tests; Vitest `4.1.10` under native Node for the selected bot unit suites | [Bun test](https://bun.sh/docs/cli/test), [Vitest](https://vitest.dev/) |
| Coverage tools | Vitest V8 `4.1.10` for bot unit coverage; repo-owned Istanbul instrumentation (`istanbul-lib-instrument` `6.0.3`, `istanbul-lib-coverage` `3.2.2`) for real Bun subprocess coverage; Bun LCOV for the remaining workspace line gate | [Vitest coverage](https://vitest.dev/guide/coverage.html), [Istanbul](https://istanbul.js.org/) |

For the full rationale, see [`docs/research/version-pins.md`](./research/version-pins.md) and
[`docs/research/stack-findings.md`](./research/stack-findings.md).
