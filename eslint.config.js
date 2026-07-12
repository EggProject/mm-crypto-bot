// eslint.config.js — flat config, TypeScript ultra-strict + security
// Lásd: docs/research/stack-findings.md §6
//
// A konfiguracio a typescript-eslint v8 `strict-type-checked` es
// `stylistic-type-checked` preset-jeit hasznalja, plusz az
// eslint-plugin-security recommended preset-jet.
//
// Jellemzo:
//   - `parserOptions.projectService: true` — a v8+ ajanlas, nem kell
//     manuálisan karbantartani a tsconfig listát
//   - A tesztekre `disableTypeChecked` preset (fixture-okben az `any` OK)
//   - A `detect-object-injection` default `warn` a sok FP miatt
//   - A `detect-non-literal-fs-filename` `warn` a config-file-ok miatt
//
// Magyar nyelvu kommentek — a projekt karbantartói magyar anyanyelviek.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

export default tseslint.config(
  // 1. Alap JS szabalyok (ESLint recommended)
  js.configs.recommended,

  // 2. TypeScript legszigorubb preset
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // 3. Security preset
  security.configs.recommended,

  // 4. Projekt-szintu beallitasok
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript strict-type-checked kiegeszitesei
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],

      // Phase 3 (strategy + backtest implementacio) relaxation:
      // A `noUncheckedIndexedAccess: true` (a `@tsconfig/bases/strictest`
      // preset-ből jön) miatt minden index-hozzáférés `T | undefined`
      // típusú. A strategy-backtest kódja a ciklus-határokon belül
      // definiált értékeknél `candles[i]!.close` mintát használ — ez a
      // TS strict típusellenőrzéssel már védett, a `!` assertion csak
      // a type narrowing-ot segíti. A 100%-os coverage fenntartásához
      // szükséges (a `noUncheckedIndexedAccess` megtartása mellett).
      "@typescript-eslint/no-non-null-assertion": "off",

      // A strategy-backtest branch-ben használt `@ts-nocheck` direktíva
      // engedélyezése a `mtf-trend-confluence.test.ts`-ben (a teszt a
      // IndicatorState readonly mezőit írja — lásd a fájl kommentjét).
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-nocheck": "allow-with-description" },
      ],

      // Security — egyedi finomhangolas
      "security/detect-object-injection": "warn", // FP-veszelyes
      "security/detect-non-literal-regexp": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-non-literal-fs-filename": "warn",
      "security/detect-child-process": "warn",
      "security/detect-possible-timing-attacks": "warn",
      "security/detect-bidi-characters": "error",
    },
  },

  // 5. Tesztek — type-check kikapcsolasa (a fixture-okben az any OK)
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/*.bench.ts"],
    ...tseslint.configs.disableTypeChecked,
  },

  // 6. Build output-ok kihagyasa
  {
    ignores: ["**/dist/**", "**/.turbo/**", "**/node_modules/**", "**/coverage/**"],
  },
);