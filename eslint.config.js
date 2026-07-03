// eslint.config.js — `mm-crypto-bot` flat config
// FONTOS: A teljes eslint scope a `packages/*/src/**` és `apps/*/src/**`,
// mert a root szinten nincs TS forráskód — ott csak config fájlok vannak.
//
// A kutatás a docs/research/stack-findings.md §6.2-ben dokumentált:
// - js.configs.recommended (alap JS szabályok)
// - typescript-eslint strictTypeChecked + stylisticTypeChecked (ultra-strict type-aware)
// - eslint-plugin-security recommended (14 security rule)
// - Tesztek feloldása a type-check alól a `disableTypeChecked` preset-tel

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import globals from "globals";

export default tseslint.config(
  {
    // A figyelmen kívül hagyott fájlok mind a turbo / gitignore szinten is kimaradnak,
    // de a flat config-ban is biztosítjuk, hogy az ESLint ne pásztázza őket.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },

  // 1. Alap JS szabályok
  js.configs.recommended,

  // 2. TypeScript type-checked preset (legszigorúbb)
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // 3. Security preset
  security.configs.recommended,

  // 4. Projekt-szintű finomhangolás (minden TS fájlra)
  {
    files: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts", "packages/*/src/**/*.tsx", "apps/*/src/**/*.tsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.bun,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* A typescript-eslint strict-type-checked + stylistic-type-checked preset
         már tartalmazza a legtöbb strict rule-t; itt csak kiegészítünk: */
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",

      /* A `_` prefixszel jelölt paramétereket és lokális változókat szándékosan
         fel nem használtnak tekintjük (a scaffold placeholder-öknél ez gyakori).
         A `caughtErrors` automatikus `unknown` típusú hibakezeléshez kell: */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],

      /* A placeholder async függvények (amelyek csak a későbbi fázisban lesznek
         ténylegesen aszinkron) feloldásához: */
      "@typescript-eslint/require-await": "off",

      /* A console.log használatát a CLI/bináris belépési pontokon engedjük —
         ezek általában kifejezetten a felhasználónak írnak: */
      "no-console": "off",

      /* Security — a plugin recommended preset-je mellé ezeket kiemeljük,
         mert a `detect-object-injection` rengeteg false positive-ot adna a
         CCXT/typed API-k miatt → csak warn szinten: */
      "security/detect-object-injection": "warn",
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

  // 5. Tesztek feloldása a type-check alól (gyorsabb lint, fixture-ökben engedjük az `any`-t)
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/test/**/*.ts", "**/tests/**/*.ts"],
    ...tseslint.configs.disableTypeChecked,
  },

  // 6. A `**/*.config.{js,ts}`, `.eslintrc*` fájlokra ne erőltessük a TS type-aware szabályokat
  {
    files: ["**/*.config.{js,ts,mjs,cjs}", "eslint.config.js", "vitest.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
);
