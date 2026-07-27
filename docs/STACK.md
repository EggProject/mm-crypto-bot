# Stack (version pins)

| Komponens | Verzió | Forrás |
|---|---|---|
| Runtime | Bun `1.3.14` | [registry.npmjs.org/bun](https://registry.npmjs.org/bun) |
| Monorepo / pipeline | Turborepo `2.10.2` | [registry.npmjs.org/turbo](https://registry.npmjs.org/turbo) |
| Nyelv | TypeScript `6.0.3` (ultra-strict) | [registry.npmjs.org/typescript](https://registry.npmjs.org/typescript) |
| Exchange | CCXT `4.5.64` (`bybiteu` ID) | [registry.npmjs.org/ccxt](https://registry.npmjs.org/ccxt) |
| Web SPA | React `>=19.2.0` + Vite `^6.0.0` | [registry.npmjs.org/vite](https://registry.npmjs.org/vite) |
| Charts | `lightweight-charts` `^5.2.0` | [github.com/tradingview/lightweight-charts](https://github.com/tradingview/lightweight-charts) |
| Web client (apps/bot) | Hono (HTTP) + `bun-websocket` (WS relay) | [hono.dev](https://hono.dev) |
| State-feed protocol | TCP loopback, ND-JSON, 4Hz throttle, 10s PING / 30s PONG | `apps/bot/src/state-feed/protocol.ts` |
| Linter | ESLint `10.6.0` + typescript-eslint `8.62.1` strict-type-checked + eslint-plugin-security `4.0.1` | [typescript-eslint.io](https://typescript-eslint.io/users/configs/) |
| Teszt (server) | Vitest `^4.1.9` + `@vitest/coverage-v8` | [vitest.dev](https://vitest.dev) |
| Teszt (web e2e) | Playwright `^1.49.0` + MSW `^2.15.0` | [playwright.dev](https://playwright.dev) |
| Coverage tool | `lcov` (apt/brew) — standard C tool, NEM custom | [github.com/linux-test-project/lcov](https://github.com/linux-test-project/lcov) |

A teljes indoklás: [`docs/research/version-pins.md`](./research/version-pins.md) és
[`docs/research/stack-findings.md`](./research/stack-findings.md).
