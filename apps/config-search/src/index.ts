export interface ConfigSearchCliOutput {
  readonly writeStderr: (value: string) => void;
  readonly writeStdout: (value: string) => void;
}

const unavailableResult = Object.freeze({
  available: false,
  code: "CONFIG_SEARCH_UNAVAILABLE",
  operation: "config-search",
  reason: "exact-strategy-run-corridor-unavailable",
  schema: "mm-crypto-bot.config-search.result/v1",
});

const unavailableResultJson = `${JSON.stringify(unavailableResult)}\n`;
const helpText = "Usage: mm-crypto-bot-config-search [--status | --help]\n";
const unsupportedArgumentText = "config-search: unsupported argument\n";

const processOutput: ConfigSearchCliOutput = Object.freeze({
  writeStderr: process.stderr.write.bind(process.stderr),
  writeStdout: process.stdout.write.bind(process.stdout),
});

export function runConfigSearchCli(
  arguments_: readonly string[],
  output: ConfigSearchCliOutput = processOutput,
): number {
  const command = arguments_.join("\u{0}");

  switch (command) {
    case "": {
      output.writeStdout(unavailableResultJson);
      return 1;
    }
    case "--status": {
      output.writeStdout(unavailableResultJson);
      return 1;
    }
    case "--help": {
      output.writeStdout(helpText);
      return 0;
    }
    default: {
      output.writeStderr(unsupportedArgumentText);
      return 2;
    }
  }
}

export function runConfigSearchCliEntrypoint(
  isExecutableEntrypoint: boolean,
  arguments_: readonly string[],
  output: ConfigSearchCliOutput = processOutput,
): number | string | null | undefined {
  if (!isExecutableEntrypoint) return process.exitCode;
  return runConfigSearchCli(arguments_, output);
}

process.exitCode = runConfigSearchCliEntrypoint(import.meta.main, process.argv.slice(2));
