import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import security from "eslint-plugin-security";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

const typescriptFiles = ["**/*.{ts,tsx,mts,cts}"];
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
);
