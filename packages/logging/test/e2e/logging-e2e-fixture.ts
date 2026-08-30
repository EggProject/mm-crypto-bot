import { tmpdir } from "node:os";
import path from "node:path";

type FixtureDirectory = "bundle" | "raw";

export interface LoggingEndToEndFixture {
  readonly paths: Readonly<{ readonly root: string; readonly bundle: string; readonly raw: string }>;
  readonly listFiles: (directory: FixtureDirectory) => readonly string[];
  readonly readFile: (directory: FixtureDirectory, name: string) => Uint8Array;
  readonly writeFile: (directory: FixtureDirectory, name: string, contents: Uint8Array) => void;
  readonly cleanup: () => void;
}

function runFixtureCommand(command: readonly string[], standardInput?: Uint8Array): Uint8Array {
  const result = Bun.spawnSync({ cmd: [...command], stdin: standardInput, stderr: "pipe", stdout: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `Logging E2E fixture command failed: ${command.join(" ")}: ${new TextDecoder().decode(result.stderr)}.`,
    );
  }
  return new Uint8Array(result.stdout);
}

function directoryPath(paths: LoggingEndToEndFixture["paths"], directory: FixtureDirectory): string {
  return directory === "bundle" ? paths.bundle : paths.raw;
}

function fixtureFilePath(
  paths: LoggingEndToEndFixture["paths"],
  directory: FixtureDirectory,
  name: string,
): string {
  return path.join(directoryPath(paths, directory), name);
}

function sortedNames(names: readonly string[]): readonly string[] {
  const sorted: string[] = [];
  for (const name of names) {
    const position = sorted.findIndex((current) => current.localeCompare(name) > 0);
    sorted.splice(position === -1 ? sorted.length : position, 0, name);
  }
  return Object.freeze(sorted);
}

export function createLoggingEndToEndFixture(): LoggingEndToEndFixture {
  const template = path.join(tmpdir(), "mm-logging-e2e-XXXXXX");
  const rootOutput = runFixtureCommand(["mktemp", "-d", template]);
  const root = new TextDecoder().decode(rootOutput).trim();
  const paths = Object.freeze({ root, bundle: path.join(root, "bundle"), raw: path.join(root, "raw") });
  runFixtureCommand(["mkdir", paths.bundle, paths.raw]);
  return Object.freeze({
    paths,
    listFiles: (directory: FixtureDirectory): readonly string[] => {
      const names = new TextDecoder()
        .decode(
          runFixtureCommand([
            "find",
            directoryPath(paths, directory),
            "-maxdepth",
            "1",
            "-mindepth",
            "1",
            "-type",
            "f",
            "-printf",
            String.raw`%f\n`,
          ]),
        )
        .trim();
      return names.length === 0 ? Object.freeze([]) : sortedNames(names.split("\n"));
    },
    readFile: (directory: FixtureDirectory, name: string): Uint8Array =>
      runFixtureCommand(["cat", fixtureFilePath(paths, directory, name)]),
    writeFile: (directory: FixtureDirectory, name: string, contents: Uint8Array): void => {
      runFixtureCommand(["tee", fixtureFilePath(paths, directory, name)], contents);
    },
    cleanup: (): void => {
      runFixtureCommand(["rm", "-rf", root]);
    },
  });
}
