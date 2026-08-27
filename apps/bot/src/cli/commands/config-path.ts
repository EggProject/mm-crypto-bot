import { fileURLToPath } from "node:url";

import { resolveRuntimeRootConfig, type RuntimeRootResolution } from "../../config/runtime-root.js";

export type ConfigPathResolution = RuntimeRootResolution | { readonly ok: true; readonly configPath: string };
export type ResolveConfigPath = (explicitConfigPath: string | undefined) => ConfigPathResolution;

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

export function resolveConfigPath(
  explicitConfigPath: string | undefined,
  resolveRuntimeRoot: () => RuntimeRootResolution,
): ConfigPathResolution {
  if (explicitConfigPath !== undefined) return { ok: true, configPath: explicitConfigPath };
  return resolveRuntimeRoot();
}

export function resolveDefaultConfigPath(explicitConfigPath: string | undefined): ConfigPathResolution {
  return resolveConfigPath(explicitConfigPath, resolveDefaultRuntimeRoot);
}

export function resolveDefaultRuntimeRoot(): RuntimeRootResolution {
  return resolveRuntimeRootConfig({ environment: process.env, repositoryRoot: REPOSITORY_ROOT });
}

export function reportConfigPathFailure(
  resolution: Extract<ConfigPathResolution, { readonly ok: false }>,
): void {
  console.error(`${resolution.error.message} (${resolution.error.code})`);
}
