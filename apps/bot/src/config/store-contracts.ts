import type { BotConfig } from "./schema.js";

/**
 * The closed TOML representation of a validated configuration.
 *
 * Domain values stay typed in memory; only their canonical external form
 * crosses the persistence boundary.
 */
export type TomlSerializableBotConfig = Omit<BotConfig, "bot"> & {
  readonly bot: Omit<BotConfig["bot"], "selected_leverage"> & {
    readonly selected_leverage: string;
  };
};

/**
 * Error raised when a configuration file cannot be read or parsed.
 */
export class ConfigReadError extends Error {
  public override readonly name = "ConfigReadError";

  public readonly path: string;
  public readonly originalCause: unknown;

  public constructor(message: string, path: string, cause: unknown) {
    super(message, { cause });
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
 * Audit record written before a live config write begins.
 */
export interface PendingLiveModeAuditEntry {
  readonly ts: string;
  readonly event: "live-mode-confirm";
  readonly transactionId: string;
  readonly status: "pending";
  readonly success: false;
  readonly previousMode: "paper" | "live";
  readonly newMode: "live";
}

/**
 * Audit record written only after an atomic live config write succeeds.
 */
export interface CommittedLiveModeAuditEntry {
  readonly ts: string;
  readonly event: "live-mode-confirm";
  readonly transactionId: string;
  readonly status: "committed";
  readonly success: true;
  readonly previousMode: "paper" | "live";
  readonly newMode: "live";
}

export type LiveModeAuditEntry = PendingLiveModeAuditEntry | CommittedLiveModeAuditEntry;

/**
 * Synchronous filesystem and codec port consumed by ConfigStore.
 */
export interface ConfigStoreDependencies {
  readonly readText: (path: string) => string;
  readonly parse: (text: string) => unknown;
  readonly stringify: (config: TomlSerializableBotConfig) => string;
  readonly exists: (path: string) => boolean;
  readonly ensureDirectory: (path: string) => void;
  readonly copy: (source: string, target: string) => void;
  readonly atomicWrite: (path: string, contents: string) => void;
  readonly appendText: (path: string, contents: string) => void;
}
