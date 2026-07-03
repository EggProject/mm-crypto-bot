# Version Pins — `mm-crypto-bot` stack

> Dátum: 2026-07-03 · Lekérdezés ideje: 2026-07-03 17:31 Europe/Budapest
>
> Minden verzió ellenőrizve a `registry.npmjs.org` (vagy `crates.io`)
> `dist-tags.latest` mezőjében. A források és indoklások a
> [`stack-findings.md`](./stack-findings.md) és a [`sources-stack.md`](./sources-stack.md)
> fájlokban találhatók.

---

## 1. Runtime és csomagkezelő

| Csomag | Verzió | Forrás | Indoklás |
|---|---|---|---|
| **Bun** | `1.3.14` | https://registry.npmjs.org/bun → `dist-tags.latest` | Stabil, 2026-07-03-i lekérés. TS natív futtatás, Bun+Turbo PM stable. `[3.5]` |
| **Turbo (Turborepo CLI)** | `2.10.2` | https://registry.npmjs.org/turbo → `dist-tags.latest` | Bun PM stable támogatás, lockfile-aware cache. `[3.6]` |

A `bun` bináris telepítése:
```bash
curl -fsSL https://bun.sh/install | bash
# vagy macOS-on
brew tap oven-sh/bun && brew install bun
```

A `turbo` a `package.json` `devDependencies`-be kerül, és a Bun-on
keresztül fut (`bunx turbo run build`).

---

## 2. Nyelv és típusrendszer

| Csomag | Verzió | Forrás | Indoklás |
|---|---|---|---|
| **TypeScript** | `6.0.3` | https://registry.npmjs.org/typescript → `dist-tags.latest` | Stabil. A `7.0.1-rc` RC-ben van, de production-höz a 6.0.3 javasolt. `[3.10]` |
| **@tsconfig/bases** | `1.0.25` | https://registry.npmjs.org/@tsconfig/bases → `dist-tags.latest` | A `@tsconfig/strictest` preset innen származik. `[5.7]` |

`tsconfig.base.json` kiterjesztés:
```jsonc
{
  "extends": "@tsconfig/strictest",
  "compilerOptions": {
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "types": ["bun-types"]
  }
}
```

> Megjegyzés: A `@tsconfig/strictest` community preset a TypeScript
> `strict: true` összes opcióját + `noUncheckedIndexedAccess`,
> `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
> `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters` stb.
> opciókat tartalmazza `[5.3]`. A fenti kiegészítések a Bun/CCXT
> kompatibilitást biztosítják.

---

## 3. Exchange integráció

| Csomag | Verzió | Forrás | Indoklás |
|---|---|---|---|
| **ccxt** | `4.5.64` | https://registry.npmjs.org/ccxt → `dist-tags.latest` | `bybiteu` első osztályú exchange ID; CCXT Pro WS streaming ugyanebben a csomagban. `[1.12]` |

A CCXT telepítése:
```bash
bun add ccxt
```

A `bybiteu` exchange ID-t használjuk (nem `bybit`-et, mert a kettő
különböző host-ot és eltérő asset listát takar). A `setSandboxMode(true)`
a bybit.eu-nál egyelőre nincs publikus sandbox-ra irányítva `[1.11]`,
így production-only entity-ként kezeljük, és a saját paper-trading
emulátorunkat használjuk (lásd `stack-findings.md` §1.4).

---

## 4. TUI

| Csomag | Verzió | Forrás | Indoklás |
|---|---|---|---|
| **ink** | `7.1.0` | https://registry.npmjs.org/ink → `dist-tags.latest` | React for CLI, TS/Bun koherens, deklaratív komponens modell. `[4.9]` |

```bash
bun add ink react
```

> Megjegyzés: A `ratatat` (React API + Rust diff engine) egy ígéretes
> alternatíva, de kísérleti projekt, nem alkalmas production
> stack-be. A Ratatui (Rust) integrálásához külön `Cargo.toml`,
> platform-specifikus bináris build és sidecar kommunikáció kellene —
> a stack-koherencia és a magyar karbantarthatóság miatt az
> **Ink** a választott. Teljes indoklás: [`tui-decision.md`](./tui-decision.md).

A `ratatui` verziója referenciaként (nem használjuk):
- `ratatui@0.30.2` — https://github.com/ratatui/ratatui/releases (Latest, 2026-06-19) `[4.2]`

---

## 5. Linting és típus-ellenőrzés

| Csomag | Verzió | Forrás | Indoklás |
|---|---|---|---|
| **eslint** | `10.6.0` | https://registry.npmjs.org/eslint → `dist-tags.latest` | Flat config stabil. `[6.8]` |
| **@typescript-eslint/eslint-plugin** | `8.62.1` | https://registry.npmjs.org/@typescript-eslint/eslint-plugin → `dist-tags.latest` | `strict-type-checked` preset támogatás. `[6.7]` |
| **@typescript-eslint/parser** | `8.62.1` | https://registry.npmjs.org/@typescript-eslint/parser → `dist-tags.latest` | Ugyanaz a verzió, mint a plugin. `[6.7]` |
| **eslint-plugin-security** | `4.0.1` | https://registry.npmjs.org/eslint-plugin-security → `dist-tags.latest` | 14 security rule (detect-eval-with-expression, detect-non-literal-regexp stb.). `[6.6]` |

Telepítés:
```bash
bun add -d eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-security
```

Az ESLint flat config formátumban (`eslint.config.js`), `strict-type-checked`
+ `stylistic-type-checked` preset + security plugin kombinációval —
teljes kód a `stack-findings.md` §6.2-ben.

---

## 6. Összesített `package.json` snippet

```jsonc
{
  "name": "mm-crypto-bot",
  "private": true,
  "type": "module",
  "engines": {
    "bun": ">=1.3.14",
    "node": ">=22"
  },
  "packageManager": "bun@1.3.14",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "2.10.2",
    "typescript": "6.0.3",
    "@tsconfig/bases": "1.0.25",
    "eslint": "10.6.0",
    "@typescript-eslint/eslint-plugin": "8.62.1",
    "@typescript-eslint/parser": "8.62.1",
    "eslint-plugin-security": "4.0.1"
  },
  "dependencies": {
    "ccxt": "4.5.64"
  }
}
```

Az `apps/tui/package.json`-ben:
```jsonc
{
  "dependencies": {
    "ink": "7.1.0",
    "react": "^18.0.0"
  }
}
```

---

## 7. Verzió-frissítési stratégia

- **Bun**: minor bump havonta, patch azonnal. Az Anthropic aktívan
  fejleszti, így a kompatibilitási törések ritkák, de a Bun release
  notes-t mindig át kell nézni.
- **Turborepo**: minor/patch automatikus (a `~` semver operátorral).
  A 3.x major upgrade-et manuálisan ellenőrizzük.
- **TypeScript**: stabil major (`6.x`) hosszan karbantartott. A `7.0.1-rc`
  RC-t akkor vesszük át, ha a Bun és a typescript-eslint is
  támogatja.
- **CCXT**: minor (4.5.x → 4.6.x) manuálisan, mert a bybit V5 API
  változásai breaking change-eket okozhatnak. A `bybiteu` ID-t
  külön ellenőrizzük minden release notes-ban.
- **Ink**: minor kompatibilis (7.x). A 8.x major upgrade-nél a React
  19-re való átállást is tervezni kell.
- **ESLint / typescript-eslint**: minor automatikus. A flat config
  változásait figyeljük.

A frissítési ciklus célja: **patch azonnal** (biztonsági fix),
**minor havonta**, **major negyedévente** manuális review-val.

---

## 8. Verzió-mátrix kompatibilitási ellenőrzés

| Verzió A | Verzió B | Kompatibilis? | Forrás |
|---|---|---|---|
| Bun 1.3.14 ≥ | Turborepo `bun 1.2+` | ✅ | `[3.2]` |
| TypeScript 6.0.3 | Bun 1.3.14 | ✅ | `[3.9]` |
| ESLint 10.6.0 | @typescript-eslint 8.62.1 | ✅ | `[6.1]` `[6.2]` |
| CCXT 4.5.64 | Bun 1.3.14 (Node kompat.) | ✅ | `[1.12]` |
| Ink 7.1.0 | React 18+ | ✅ | `[4.9]` |
| @tsconfig/bases 1.0.25 | TypeScript 6.0.3 | ✅ | `[5.7]` |

Minden verzió-kombináció ellenőrizve a kutatás során. A fenti
verzió-pin-ek a `package.json` `engines` és `packageManager` mezőivel
együtt biztosítják a determinisztikus telepítést.

---

## 9. Hivatkozások

- [1.12] https://registry.npmjs.org/ccxt
- [1.11] https://github.com/ccxt/ccxt/blob/master/php/bybit.php
- [3.5] https://registry.npmjs.org/bun
- [3.6] https://registry.npmjs.org/turbo
- [3.9] https://www.infoq.cn/article/rQSULhvrw9hks4xBHS5d
- [3.10] https://registry.npmjs.org/typescript
- [4.2] https://github.com/ratatui/ratatui
- [4.9] https://registry.npmjs.org/ink
- [5.3] https://github.com/tsconfig/bases/blob/main/bases/strictest.json
- [5.7] https://registry.npmjs.org/@tsconfig/bases
- [6.1] https://typescript-eslint.io/users/configs/
- [6.2] https://typescript-eslint.io/troubleshooting/typed-linting/
- [6.6] https://registry.npmjs.org/eslint-plugin-security
- [6.7] https://registry.npmjs.org/@typescript-eslint/eslint-plugin
- [6.8] https://registry.npmjs.org/eslint