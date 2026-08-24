import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import security from "eslint-plugin-security";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

const typescriptFiles = ["**/*.{ts,tsx,mts,cts}"];
const loggingTestSupportBoundaryFiles = [
  "**/*.{test,test-support}.{ts,tsx,mts,cts}",
  "{apps,packages}/**/{test,tests,test-support}/**/*.{ts,tsx,mts,cts}",
];
const ignoredPaths = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.turbo/**",
  "data/**",
];

const typedConfigurations = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
].map((flatConfig) => ({
  ...flatConfig,
  files: typescriptFiles,
}));

export default tseslint.config(
  { ignores: ignoredPaths },
  js.configs.recommended,
  ...typedConfigurations,
  security.configs.recommended,
  unicorn.configs.recommended,
  prettier,
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: typescriptFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@logging-testing",
              message: "@logging-testing is test-only and must not be imported by production source files.",
            },
          ],
          patterns: [
            {
              group: ["@logging-testing/*"],
              message: "@logging-testing is test-only and must not be imported by production source files.",
            },
          ],
        },
      ],
    },
  },
  {
    files: loggingTestSupportBoundaryFiles,
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["packages/logging/test/e2e/**/*.ts", "packages/logging/vitest.e2e-path-boundary.config.ts"],
    languageOptions: {
      parserOptions: {
        project: "./packages/logging/tsconfig.e2e.json",
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      "packages/logging/test/e2e/logging-e2e-preload.ts",
      "packages/logging/test/e2e/run-logging-e2e-coverage-cli.ts",
    ],
    rules: {
      "unicorn/no-top-level-side-effects": "off",
    },
  },
);
