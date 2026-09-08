const NETWORK_ATTEMPT_EXIT_CODE = 86;
const RAW_COVERAGE_DIRECTORY = "apps/bot/coverage/e2e/raw";
const CASE_ID_PART_PATTERN = /^[a-z0-9]+$/u;

interface InstalledNetworkGuard {
  readonly attempts: readonly string[];
}

interface PreloadConfig {
  readonly caseId: string;
  readonly entryKind: "canonical-cli" | "runtime-driver";
  readonly rawDirectory: string;
}

export interface BotE2EPreloadRuntimeState {
  isFlushed: boolean;
  isInstalled: boolean;
  isNetworkDiagnosticsWritten: boolean;
}

export interface BotE2EPreloadRuntimePorts {
  readonly dropCredentials: (environment: NodeJS.ProcessEnv) => void;
  readonly environment: NodeJS.ProcessEnv;
  readonly exitCodeTarget: { exitCode: number | string | null | undefined };
  readonly getCoverage: () => unknown;
  readonly installNetworkGuard: () => InstalledNetworkGuard;
  readonly mkdir: (directory: string, options: { readonly recursive: true }) => void;
  readonly processId: number;
  readonly registerBeforeExit: (listener: () => void) => void;
  readonly registerExit: (listener: () => void) => void;
  readonly repositoryRoot: string;
  readonly resolvePath: (...segments: readonly string[]) => string;
  readonly writeFile: (
    filePath: string,
    contents: string,
    options: { readonly encoding: "utf8"; readonly flag: "wx"; readonly mode: 0o600 },
  ) => void;
  readonly writeStandardError: (message: string) => void;
}

export function createBotE2EPreloadRuntimeState(): BotE2EPreloadRuntimeState {
  return { isFlushed: false, isInstalled: false, isNetworkDiagnosticsWritten: false };
}

function isCaseId(value: string): boolean {
  return value.length > 0 && value.split("-").every((part) => CASE_ID_PART_PATTERN.test(part));
}

function validateConfig(ports: BotE2EPreloadRuntimePorts): PreloadConfig {
  const rawDirectory = ports.environment["MM_BOT_E2E_COVERAGE_RAW_DIR"];
  const expectedRawDirectory = ports.resolvePath(ports.repositoryRoot, RAW_COVERAGE_DIRECTORY);
  if (rawDirectory === undefined || ports.resolvePath(rawDirectory) !== expectedRawDirectory) {
    throw new Error("MM_BOT_E2E_COVERAGE_RAW_DIR must be the repository-owned E2E raw directory");
  }

  const entryKind = ports.environment["MM_BOT_E2E_ENTRY_KIND"];
  if (entryKind !== "canonical-cli" && entryKind !== "runtime-driver") {
    throw new Error("MM_BOT_E2E_ENTRY_KIND is invalid");
  }

  const caseId = ports.environment["MM_BOT_E2E_CASE_ID"];
  if (caseId === undefined || !isCaseId(caseId)) {
    throw new Error("MM_BOT_E2E_CASE_ID is invalid");
  }
  return { rawDirectory: expectedRawDirectory, entryKind, caseId };
}

function enforceNetworkGuard(
  ports: BotE2EPreloadRuntimePorts,
  networkGuard: InstalledNetworkGuard,
  state: BotE2EPreloadRuntimeState,
): void {
  if (state.isNetworkDiagnosticsWritten || networkGuard.attempts.length === 0) return;
  state.isNetworkDiagnosticsWritten = true;
  if (ports.exitCodeTarget.exitCode === undefined || ports.exitCodeTarget.exitCode === 0) {
    ports.exitCodeTarget.exitCode = NETWORK_ATTEMPT_EXIT_CODE;
  }
  ports.writeStandardError(
    `[bot-e2e-network-guard] blocked attempt ledger: ${networkGuard.attempts.join(", ")}\n`,
  );
}

function flushCoverage(
  ports: BotE2EPreloadRuntimePorts,
  config: PreloadConfig,
  state: BotE2EPreloadRuntimeState,
): void {
  if (state.isFlushed) return;
  state.isFlushed = true;
  const coverage = ports.getCoverage();
  if (coverage === undefined || coverage === null || typeof coverage !== "object") return;

  ports.mkdir(config.rawDirectory, { recursive: true });
  const output = ports.resolvePath(config.rawDirectory, `${String(ports.processId)}.json`);
  ports.writeFile(
    output,
    `${JSON.stringify({
      schemaVersion: 1,
      pid: ports.processId,
      entryKind: config.entryKind,
      caseId: config.caseId,
      coverage,
    })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

export function installBotE2EPreloadRuntime(
  ports: BotE2EPreloadRuntimePorts,
  state: BotE2EPreloadRuntimeState,
): void {
  if (state.isInstalled) return;
  ports.dropCredentials(ports.environment);
  const networkGuard = ports.installNetworkGuard();
  const config = validateConfig(ports);
  state.isInstalled = true;
  const flush = (): void => {
    enforceNetworkGuard(ports, networkGuard, state);
    flushCoverage(ports, config, state);
  };
  ports.registerBeforeExit(flush);
  ports.registerExit(flush);
}
