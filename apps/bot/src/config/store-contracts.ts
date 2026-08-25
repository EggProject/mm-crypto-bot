import type { BotConfig } from "./schema.js";

/**
 * Error raised when a configuration file cannot be read or parsed.
 */
export class ConfigReadError extends Error {
  public override readonly name = "ConfigReadError";

  public readonly path: string;
  public readonly originalCause: unknown;

  public constructor(message: string, path: string, cause: unknown) {
    super(message);
    this.path = path;
    this.originalCause = cause;
  }
}

/**
 * Error raised when a configuration candidate is rejected by the schema.
 */
export class ConfigValidationError extends Error {
  public override readonly name = "ConfigValidationError";

  public constructor(
    message: string,
    public readonly fieldErrors: Readonly<Record<string, readonly string[]>>,
    public readonly issues: readonly {
      readonly path: string;
      readonly message: string;
    }[],
  ) {
    super(message);
  }
}

/**
 * Error raised when the live-mode confirmation text is not exactly `LIVE`.
 */
export class ConfigLiveConfirmError extends Error {
  public override readonly name = "ConfigLiveConfirmError";

  public constructor(
    message: string,
    public readonly typedValue: string,
  ) {
    super(message);
  }
}

/**
 * Append-only audit entry created for an accepted live-mode confirmation.
 */
export interface LiveModeAuditEntry {
  readonly ts: string;
  readonly event: "live-mode-confirm";
  readonly value: true;
  readonly prevMode: "paper" | "live";
  readonly newMode: "paper" | "live";
}

/**
 * Synchronous filesystem and codec port consumed by ConfigStore.
 */
export interface ConfigStoreDependencies {
  readonly readText: (path: string) => string;
  readonly parse: (text: string) => unknown;
  readonly stringify: (config: BotConfig) => string;
  readonly exists: (path: string) => boolean;
  readonly ensureDirectory: (path: string) => void;
  readonly copy: (source: string, target: string) => void;
  readonly atomicWrite: (path: string, contents: string) => void;
  readonly appendText: (path: string, contents: string) => void;
}
