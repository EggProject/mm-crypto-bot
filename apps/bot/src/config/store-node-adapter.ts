import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { parse as parseToml, stringify as stringifyToml, TomlError } from "smol-toml";
import writeFileAtomic from "write-file-atomic";

import type { ConfigStoreDependencies } from "./store-contracts.js";

export const DEFAULT_CONFIG_STORE_DEPENDENCIES: ConfigStoreDependencies = {
  // ConfigStore normalizes the user-selected path before this boundary.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  readText: (path) => readFileSync(path, "utf8"),
  parse: (text) => parseToml(text),
  stringify: (config) => stringifyToml(config),
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- normalized ConfigStore path
  exists: (path) => existsSync(path),
  ensureDirectory: (path) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- dirname of normalized ConfigStore path
    mkdirSync(path, { recursive: true });
  },
  copy: (source, target) => {
    copyFileSync(source, target);
  },
  atomicWrite: (path, contents) => {
    writeFileAtomic.sync(path, contents, "utf8");
  },
  appendText: (path, contents) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed audit suffix of normalized ConfigStore path
    writeFileSync(path, contents, { flag: "a" });
  },
};

export function getTomlParseErrorMessage(error: unknown): string {
  return error instanceof TomlError ? error.message : String(error);
}
