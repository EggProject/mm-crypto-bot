import { realpathSync } from "node:fs";
import path from "node:path";

const RUNTIME_ROOT_ENVIRONMENT_KEY = "MM_CRYPTO_BOT_RUNTIME_ROOT";
const DEFAULT_CONFIG_RELATIVE_PATH = "config/default.toml";
const UNAVAILABLE_RUNTIME_ROOT_MESSAGE = "Runtime configuration root is unavailable.";

export type RuntimeRootFailureCode =
  | "runtime-root-missing"
  | "runtime-root-invalid"
  | "runtime-root-repository-boundary"
  | "runtime-config-unavailable"
  | "runtime-config-repository-boundary";

export interface RuntimeRootPathOperations {
  readonly isAbsolute: (path: string) => boolean;
  readonly join: (...paths: readonly string[]) => string;
  readonly relative: (from: string, to: string) => string;
  readonly realpath: (path: string) => string;
  readonly resolve: (path: string) => string;
}

export interface RuntimeRootResolverInput {
  readonly environment: unknown;
  readonly repositoryRoot: string;
  readonly pathOperations?: RuntimeRootPathOperations;
}

export type RuntimeRootResolution =
  | {
      readonly ok: false;
      readonly error: {
        readonly code: RuntimeRootFailureCode;
        readonly message: "Runtime configuration root is unavailable.";
      };
    }
  | { readonly ok: true; readonly runtimeRoot: string; readonly configPath: string };

const nodePathOperations: RuntimeRootPathOperations = {
  isAbsolute: (pathName) => path.isAbsolute(pathName),
  join: (...pathNames) => path.join(...pathNames),
  relative: (from, to) => path.relative(from, to),
  realpath: (pathName) => realpathSync.native(pathName),
  resolve: (pathName) => path.resolve(pathName),
};

function failure(code: RuntimeRootFailureCode): RuntimeRootResolution {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message: UNAVAILABLE_RUNTIME_ROOT_MESSAGE }),
  });
}

function readRuntimeRoot(environment: unknown): string | RuntimeRootResolution {
  if (typeof environment !== "object") return failure("runtime-root-invalid");

  try {
    const descriptor = Object.getOwnPropertyDescriptor(environment, RUNTIME_ROOT_ENVIRONMENT_KEY);
    if (descriptor === undefined) return failure("runtime-root-missing");
    if (!("value" in descriptor) || typeof descriptor.value !== "string") {
      return failure("runtime-root-invalid");
    }
    return descriptor.value;
  } catch {
    return failure("runtime-root-invalid");
  }
}

function isResolution(value: string | RuntimeRootResolution): value is RuntimeRootResolution {
  return typeof value !== "string";
}

function isContained(relativePath: string, paths: RuntimeRootPathOperations): boolean {
  if (relativePath === "") return true;
  if (relativePath === "..") return false;
  if (relativePath.startsWith("../") || relativePath.startsWith("..\\")) return false;
  return !paths.isAbsolute(relativePath);
}

export function resolveRuntimeRootConfig(input: RuntimeRootResolverInput): RuntimeRootResolution {
  const paths = input.pathOperations ?? nodePathOperations;
  const runtimeRoot = readRuntimeRoot(input.environment);
  if (isResolution(runtimeRoot)) return runtimeRoot;
  if (runtimeRoot.length === 0 || runtimeRoot.includes("\0") || !paths.isAbsolute(runtimeRoot)) {
    return failure("runtime-root-invalid");
  }

  try {
    const canonicalRepoRoot = paths.realpath(paths.resolve(input.repositoryRoot));
    const canonicalRuntimeRoot = paths.realpath(paths.resolve(runtimeRoot));
    const runtimeRootRelativePath = paths.relative(canonicalRepoRoot, canonicalRuntimeRoot);
    if (isContained(runtimeRootRelativePath, paths)) {
      return failure("runtime-root-repository-boundary");
    }
    const requestedConfigPath = paths.join(canonicalRuntimeRoot, DEFAULT_CONFIG_RELATIVE_PATH);
    let canonicalConfigPath: string;
    try {
      canonicalConfigPath = paths.realpath(paths.resolve(requestedConfigPath));
    } catch {
      return failure("runtime-config-unavailable");
    }
    const configRootRelativePath = paths.relative(canonicalRuntimeRoot, canonicalConfigPath);
    const configRepoRelativePath = paths.relative(canonicalRepoRoot, canonicalConfigPath);
    if (!isContained(configRootRelativePath, paths) || isContained(configRepoRelativePath, paths)) {
      return failure("runtime-config-repository-boundary");
    }
    return Object.freeze({
      ok: true,
      runtimeRoot: canonicalRuntimeRoot,
      configPath: canonicalConfigPath,
    });
  } catch {
    return failure("runtime-root-invalid");
  }
}
