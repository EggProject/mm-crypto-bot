# Források — Stack kutatás (CCXT Pro, bybit.eu, Bun, Turborepo, TUI, TS, ESLint)

> A `docs/research/stack-findings.md` és a `docs/research/tui-decision.md` minden
> állítása az itt felsorolt URL-ekre hivatkozik. Minden témakörnél ≥2 független
> forrást használunk. A források lekérdezésének dátuma: 2026-07-03.

## 1. CCXT / CCXT Pro — verzió, WebSocket, paper-trading

| # | URL | Megjegyzés |
|---|---|---|
| 1.1 | https://github.com/ccxt/ccxt | A CCXT fő repó. WebSocket (Pro) támogatás, bybit, bybiteu ID-k. |
| 1.2 | https://docs.ccxt.com/ | Hivatalos CCXT dokumentáció, „WebSocket streaming: watch tickers, order books, trades and orders." |
| 1.3 | https://docs.ccxt.com/docs/pro-manual | CCXT Pro Manual — listázott exchange-ek (`bybit`, `bybiteu`). |
| 1.4 | https://docs.ccxt.com/docs/changelog | CCXT v4.5.62 – 2026-06-29; v4.5.61 – 2026-06-27. |
| 1.5 | https://github.com/ccxt/ccxt/wiki/ccxt.pro.manual | `ccxt.pro.manual` wiki — Pro stack, exchange lista, reconnect/backoff. |
| 1.6 | https://github.com/ccxt/ccxt/wiki/manual | CCXT Manual — `rateLimit`, `enableRateLimit`, sandbox/demotrading URL-ek. |
| 1.7 | https://docs.ccxt.com/docs/exchanges/bybit | bybit exchange API referencia — `enableDemoTrading()`, `watchOrderBook`, `watchTicker`, stb. |
| 1.8 | https://github.com/ccxt/ccxt/issues/11237 | „How are paper trading execution prices selected?" — CCXT nem dönt árról, sandbox/testnet. |
| 1.9 | https://github.com/ccxt/ccxt/issues/25523 | Bitget sandbox mode bug — `setSandboxMode` és `enableDemoTrading` viselkedése. |
| 1.10 | https://github.com/ccxt/ccxt/issues/11953 | „How to use testnet?" — bybit `set_sandbox_mode(True)`. |
| 1.11 | https://github.com/ccxt/ccxt/blob/master/php/bybit.php | bybit PHP describe() — `hostname: 'bybit.com'`, `rateLimit: 20`, `urls.api`, `urls.demotrading`, `urls.test`. |
| 1.12 | https://registry.npmjs.org/ccxt | npm registry — `dist-tags.latest: 4.5.64` (lekérve 2026-07-03). |
| 1.13 | https://security.snyk.io/package/pip/ccxt/versions | PyPI ccxt verziók — 4.5.x release-ek 2025 nov – 2026 jan. |
| 1.14 | https://robottraders.io/blog/demo-trading-python-crypto-bot | „Demo trading fills this gap" — sandbox-üzemmód értelmezése Bitget-en. |

## 2. bybit.eu vs bybit.com — spot, tőkeáttétel, díjak, asset lista

| # | URL | Megjegyzés |
|---|---|---|
| 2.1 | https://www.prnewswire.com/news-releases/bybit-eu-empowers-european-traders-with-spot-margin-up-to-10x-leverage-full-transparency-and-built-in-risk-controls-302532221.html | „Bybit EU Empowers European Traders with Spot Margin: Up to 10x Leverage" — 2025-08-18, Vienna. MiCAR CASP. |
| 2.2 | https://finance.yahoo.com/news/crypto-exchange-bybit-introduces-10x-112759362.html | Yahoo Finance — „Crypto Exchange Bybit Introduces 10x Spot Margin Trading in Europe", 2025-08-18. |
| 2.3 | https://www.coindesk.com/business/2025/08/18/crypto-exchange-bybit-introduces-10x-spot-margin-trading-in-europe | CoinDesk — 10× spot margin, MiCA-kompatibilis. |
| 2.4 | https://www.gate.com/news/detail/14613030 | „Bybit EU Review" — 10× spot margin, 5% APY stablecoin, MiCAR, nincs derivatíva retail-nek. |
| 2.5 | https://www.bybit.com/hu-EU/help-center/article/Difference-Between-Spot-and-Spot-Margin | Bybit Help Center — Spot vs Spot Margin: „Spot Market: N/A leverage; Spot Margin: 10×, hourly interest, MMR% 100%". |
| 2.6 | https://www.bybit.com/en/trade/spot/act/leverage-landing-page | Bybit Spot Margin landing page — BTC/USDT 10× példa. |
| 2.7 | https://www.bybit.com/sitemap/spot/en.html | Bybit spot directory — BTC/USDC, BTC/USDT, ETH/USDC, SOL/USDC stb. |
| 2.8 | https://www.bybit.com/en/help-center/article/Assets-List-for-Bybit-Convert | Bybit Convert teljes asset lista (BTC, ETH, SOL rajta). |
| 2.9 | https://www.sysxhz.com/article/1564959.html | „Bybit.eu: MiCAR-kompatibilis platform 2025-07-01", CASP, 29 EEA-ország. |
| 2.10 | https://www.youtube.com/watch?v=8M3uKCFX0Bs | „Bybit Margin & Leverage Trading Tutorial" — 10× magyarázat, multi-collateral, hourly borrow fee. |
| 2.11 | https://www.directionsmag.com/crypto/best-crypto-leverage-trading-platforms | „Bybit 1:200 spot/futures", „OKX 1:10 spot margin" — összehasonlítás. |
| 2.12 | https://docs.ccxt.com/fr/docs/exchange-markets-by-country | CCXT — EU alatti exchange-ek: bybiteu, gateeu, kucoineu stb. |

## 3. Bun + Turborepo + TypeScript kompatibilitás

| # | URL | Megjegyzés |
|---|---|---|
| 3.1 | https://turborepo.dev/blog/turbo-2-6 | Turborepo 2.6 — „Bun package manager to stable". |
| 3.2 | https://turborepo.dev/docs/support-policy | „bun 1.2+ → Stable"; 2.x EOL a következő major kiadás után 2 év. |
| 3.3 | https://bun.com | Bun hivatalos oldal — `Install Bun v1.3.14`. |
| 3.4 | https://github.com/oven-sh/bun | Bun repó — Linux/macOS/Windows támogatás, kernel 5.6+. |
| 3.5 | https://registry.npmjs.org/bun | npm registry — `dist-tags.latest: 1.3.14`. |
| 3.6 | https://registry.npmjs.org/turbo | npm registry — `dist-tags.latest: 2.10.2`, „Published 3 days ago". |
| 3.7 | https://esearchonline.com/articles/typescript-monorepo-setup-guide | „Turborepo 3 with pnpm 10, pure pnpm, pure Bun 1.4 workspaces" összehasonlítás (2026). |
| 3.8 | https://www.reddit.com/r/nextjs/comments/1pe058b/next_js_bun/ | „Turborepo supports Bun as stable in our latest release" megerősítés. |
| 3.9 | https://www.infoq.cn/article/rQSULhvrw9hks4xBHS5d | Pulumi 3.227.0 — Bun runtime teljes támogatás (`runtime: bun`). |
| 3.10 | https://registry.npmjs.org/typescript | npm registry — `dist-tags.latest: 6.0.3` (stabil); 7.0.1-rc elérhető. |

## 4. TUI: ratatui (Rust) vs ink (React/Node/TS)

| # | URL | Megjegyzés |
|---|---|---|
| 4.1 | https://ratatui.rs/ | Ratatui hivatalos oldal — „A Rust library for cooking up TUIs". |
| 4.2 | https://github.com/ratatui/ratatui | Ratatui GitHub — v0.30.2 Latest, 2026-06-19. |
| 4.3 | https://www.libhunt.com/compare-ink-vs-ratatui | LibHunt — Ink 35.6k⭐ (TS/Node, React) vs Ratatui 19.1k⭐ (Rust). |
| 4.4 | https://github.com/wistrand/melker/blob/main/agent_docs/tui-comparison.md | TUI-összehasonlító táblázat: paradigmák, layout, nyelvek, stars. |
| 4.5 | https://www.reddit.com/r/reactjs/comments/1ru223j/ | „Ratatat — React-based TUI library powered by a Rust diff engine, ~30× faster than Ink". |
| 4.6 | https://www.reddit.com/r/commandline/comments/1pevcq6/ | „Is Rust too low-level for recreating an Ink-style TUI?" — Rust vs Ink trade-off. |
| 4.7 | https://blog.logrocket.com/7-tui-libraries-interactive-terminal-apps/ | „7 TUI libraries for creating interactive terminal apps" — Ratatui „obvious fit for Rust". |
| 4.8 | https://news.ycombinator.com/item?id=35863837 | HN — „Ink: React for interactive command-line apps" — kommentek a trade-off-okról. |
| 4.9 | https://registry.npmjs.org/ink | npm registry — `dist-tags.latest: 7.1.0`. |

## 5. TypeScript legszigorúbb tsconfig

| # | URL | Megjegyzés |
|---|---|---|
| 5.1 | https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html | TypeScript hivatalos leírás — `noUncheckedIndexedAccess` ad `undefined` típust indexelt elérésnél. |
| 5.2 | https://www.typescriptlang.org/tsconfig/ | TSConfig Reference — minden opció dokumentálva. |
| 5.3 | https://github.com/tsconfig/bases/blob/main/bases/strictest.json | `@tsconfig/strictest` (community karbantartású) — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` stb. |
| 5.4 | https://www.totaltypescript.com/tsconfig-cheat-sheet | „The TSConfig Cheat Sheet" — `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` ajánlott. |
| 5.5 | https://oneuptime.com/blog/post/2026-01-24-typescript-tsconfig-configuration/view | „How to Configure tsconfig.json Properly" — 2026-os checklist. |
| 5.6 | https://www.pkgpulse.com/guides/how-to-set-up-typescript-with-every-framework | „How to Set Up TypeScript with Every Major 2026" — `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. |
| 5.7 | https://registry.npmjs.org/@tsconfig/bases | npm registry — `dist-tags.latest: 1.0.25`. |

## 6. ESLint ultra-strict (typescript-eslint + security)

| # | URL | Megjegyzés |
|---|---|---|
| 6.1 | https://typescript-eslint.io/users/configs/ | Hivatalos shared configs — `recommended`, `recommended-type-checked`, `strict`, `strict-type-checked`. |
| 6.2 | https://typescript-eslint.io/troubleshooting/typed-linting/ | Typed Linting — `parserOptions.projectService` ajánlott a v8+ verziótól. |
| 6.3 | https://github.com/typescript-eslint/typescript-eslint/issues/8195 | „Provide configs that only have type-checked rules" — RFC. |
| 6.4 | https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/src/configs/eslintrc/strict-type-checked.ts | Forrása a `strict-type-checked` preset-nek. |
| 6.5 | https://github.com/eslint-community/eslint-plugin-security | `eslint-plugin-security` — 14 db rule (detect-eval-with-expression, detect-non-literal-regexp stb.). |
| 6.6 | https://registry.npmjs.org/eslint-plugin-security | npm registry — `dist-tags.latest: 4.0.1`. |
| 6.7 | https://registry.npmjs.org/@typescript-eslint/eslint-plugin | npm registry — `dist-tags.latest: 8.62.1`. |
| 6.8 | https://registry.npmjs.org/eslint | npm registry — `dist-tags.latest: 10.6.0`. |
| 6.9 | https://codesignal.com/learn/courses/sast-static-application-security-testing-tools/lessons/eslint-security-scanning-1 | „ESLint Security Scanning" — `detect-object-injection` default `warn` a sok FP miatt. |
| 6.10 | https://krython.com/tutorial/typescript/code-security-review-static-analysis | „Static Analysis for TypeScript" — `eslint-plugin-security` ajánlott rule lista. |

## 7. CCXT Pro rate-limit + sequence drift

| # | URL | Megjegyzés |
|---|---|---|
| 7.1 | https://github.com/ccxt/ccxt/wiki/manual | CCXT Manual — `rateLimit`, `enableRateLimit`, throttle beállítás. |
| 7.2 | https://github.com/ccxt/ccxt/issues/18878 | „Avoiding rate limit issues" — per-API vagy per-IP limit, throttle-ölni kell WS-en is. |
| 7.3 | https://www.freqtrade.io/en/2022.8/exchanges/ | Freqtrade — `ccxt_async_config: { enableRateLimit: true, rateLimit: 3100 }` Kraken-re. |
| 7.4 | https://matrixtrak.com/blog/websocket-disconnects-trading-bots-reconnection | „WebSocket Disconnects in Trading Bots" — sequence tracking, gap detection, REST recovery, Bybit 20s heartbeat, mandatory 24h disconnect. |
| 7.5 | https://github.com/ccxt/ccxt/wiki/ccxt.pro.manual/7ed087b8056393f51bbdd1735e5a9ee5baf29a2e | „Upon a critical exception… next iteration of the tick function will call the watch method that will trigger a reconnection. CCXT Pro applies the necessary rate-limiting and exponential backoff reconnection delays." |
| 7.6 | https://github.com/ccxt/ccxt/issues/4779 | „Question about: enableRateLimit: true" — `rateLimits` exchange-specifikus, `rateLimit` ms. |

## 8. Egyéb kontextus

| # | URL | Megjegyzés |
|---|---|---|
| 8.1 | https://github.com/ccxt/ccxt/blob/master/php/bybit.php | bybit.describe() — `rateLimit: 20` ms, `pro: true`, `certified: true`. |
| 8.2 | https://www.youtube.com/watch?v=qSZwx5_EmSA | „INK: The React Library POWERING AI Terminal Tools" — Claude Code, Gemini CLI, Qwen Code mind Ink-re épül. |
| 8.3 | https://crates.io/crates/ccxt-flux-sidecar/0.1.0-alpha.3 | „CCXT flux sidecar" — exchange WS feed + REST snapshot → deterministic LOB. Alternatíva. |

---

**Összesen**: 57 független URL, 7 témakör, mindegyikben ≥2 forrás.