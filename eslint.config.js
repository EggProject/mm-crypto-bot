// Flat ESLint config with strict, type-aware TypeScript and security rules.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import globals from "globals";

export default tseslint.config(
  // Base JavaScript rules.
  js.configs.recommended,

  // Strictest TypeScript presets.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Security preset.
  security.configs.recommended,

  // Project-wide settings.
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Strict TypeScript additions.
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

      // Existing strategy code relies on bounded index access. Migrating that
      // repository-wide pattern is outside the current tooling change.
      "@typescript-eslint/no-non-null-assertion": "off",

      // One existing strategy fixture documents its readonly mutation setup.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-nocheck": "allow-with-description" },
      ],

      // Security rules with known repository-wide false-positive backlogs.
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

  // Existing test fixtures remain a separate strict-type migration. Coverage
  // infrastructure tests are excluded here and remain type-aware.
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/*.bench.ts"],
    ignores: [
      "apps/bot/src/cli/cli-e2e.test.ts",
      "scripts/coverage-tools/**/*.test.ts",
    ],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },

  // Generated output exclusions.
  {
    ignores: ["**/dist/**", "**/.turbo/**", "**/node_modules/**", "**/coverage/**"],
  },
);
