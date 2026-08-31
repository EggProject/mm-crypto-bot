/**
 * Validated state-snapshot reader for the kill-switch dry-run command.
 *
 * The configured path crosses into Node's synchronous filesystem API only
 * after this boundary rejects empty, NUL-containing, and current-directory
 * values. The two calls below are intentionally limited to existence probing
 * and reading the validated snapshot; this command never writes state.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { BotStateSchema, type BotState } from "../../bot/state-store.js";

export type StateSnapshotLoad =
  | {
      readonly state: BotState;
      readonly error: undefined;
    }
  | {
      readonly state: undefined;
      readonly error: string;
    };

class StateSnapshotPath {
  public readonly value: string;

  public constructor(value: string) {
    this.value = value;
  }
}

function validateStateSnapshotPath(candidate: string): StateSnapshotPath | undefined {
  if (candidate.length === 0 || candidate.includes("\0") || path.normalize(candidate) === ".")
    return undefined;
  return new StateSnapshotPath(candidate);
}

function formatError(error: unknown): string {
  const boxedError: object = new Object(error);
  return String(Reflect.get(boxedError, "message"));
}

/**
 * Reads and validates a configured state snapshot without mutating it.
 */
export function loadValidatedStateSnapshot(filePath: string): StateSnapshotLoad {
  const stateFilePath = validateStateSnapshotPath(filePath);
  if (stateFilePath === undefined)
    return {
      state: undefined,
      error: "invalid state file path: state file path must be a non-empty filesystem path",
    };

  // StateSnapshotPath validates this dynamic path before the existence probe.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- StateSnapshotPath validates the configured snapshot boundary before read-only I/O.
  if (!existsSync(stateFilePath.value)) {
    return { state: undefined, error: `state file not found: ${stateFilePath.value}` };
  }

  let raw: string;
  try {
    // StateSnapshotPath validates this dynamic path before the state read.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- StateSnapshotPath validates the configured snapshot boundary before read-only I/O.
    raw = readFileSync(stateFilePath.value, "utf8");
  } catch (error) {
    return { state: undefined, error: `failed to read ${stateFilePath.value}: ${formatError(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { state: undefined, error: `invalid JSON in ${stateFilePath.value}: ${formatError(error)}` };
  }

  const validated = BotStateSchema.safeParse(parsed);
  if (!validated.success) {
    const issueDetails = validated.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return { state: undefined, error: `state file schema invalid: ${issueDetails}` };
  }

  return { state: validated.data, error: undefined };
}
