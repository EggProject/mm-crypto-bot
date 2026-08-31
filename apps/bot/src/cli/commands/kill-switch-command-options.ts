/**
 * Shared parsed-argument helpers for read-only kill-switch CLI commands.
 */

/**
 * Returns the explicit `--config` value when one was supplied.
 */
export function getConfigPath(flags: ReadonlyMap<string, string | boolean>): string | undefined {
  const value = flags.get("config");
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Returns whether the dry-run command must emit its JSON-only envelope.
 */
export function isJsonOutputRequested(flags: ReadonlyMap<string, string | boolean>): boolean {
  const value = flags.get("json");
  if (typeof value === "boolean") return value;
  return typeof value === "string" && value.length > 0 && value !== "false" && value !== "0";
}
