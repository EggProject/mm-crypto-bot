import { expect, test } from "vitest";

import { fixture } from "./release-assembler.test-support";
import { releaseSetArchiveBasename } from "./release-set-contract";
import { assertReproducibleReleaseSet } from "./release-set-reproducibility";

const botHelp =
  "mm-crypto-bot command-line interface\n\nUsage: bun run apps/bot/src/index.ts <subcommand> [options]\n\nSubcommands:\n  backtest              Run a quick backtest on a deterministic OHLC fixture\n  config                Validate / show / init the bot config\n  help                  Show this help\n  kill-switch-dry-run   Simulate the kill-switch path without sending any orders\n  kill-switches         Show kill-switch state\n  start                 Start the bot (headless — runs until SIGINT/SIGTERM)\n  status                Show the persisted bot state\n  strategies            List registered strategies + on/off state\n  trades                Show recent closed trades\n\nRun `bun run apps/bot/src/index.ts <subcommand> --help` for subcommand-specific options.\n";
const configHelp = "Usage: mm-crypto-bot-config-search [--status | --help]\n";
const configStatus =
  '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n';

function queueSuccessfulSmoke(current: ReturnType<typeof fixture>): void {
  current.fileSystem.queueProcess(
    { exitCode: 1, stderr: botHelp, stdout: "" },
    { exitCode: 1, stderr: botHelp, stdout: "" },
    { exitCode: 0, stderr: "", stdout: configHelp },
    { exitCode: 1, stderr: "", stdout: configStatus },
    { exitCode: 0, stderr: "", stdout: configHelp },
    { exitCode: 1, stderr: "", stdout: configStatus },
  );
}

test("retains first verified snapshots through two builds and smokes before one outer publication", async () => {
  const current = fixture();
  queueSuccessfulSmoke(current);
  const links: { readonly destination: string; readonly source: string }[] = [];
  const outcome = await assertReproducibleReleaseSet({
    publicationDependencies: {
      privateCandidateFileSystem: current.fileSystem,
      publicationFileSystem: {
        link: (source, destination) => {
          links.push({ destination, source });
          return Promise.resolve();
        },
      },
    },
    publicationRoot: "/trusted-publication",
    releaseDependencies: current.dependencies,
  });
  expect(outcome).toEqual({ kind: "published" });
  expect(current.compilerCalls.map((call) => call.entryPoint)).toEqual([
    "/repo/apps/bot/src/index.ts",
    "/repo/apps/bot/src/index.ts",
    "/repo/apps/config-search/src/index.ts",
    "/repo/apps/config-search/src/index.ts",
  ]);
  expect(links).toHaveLength(1);
  expect(links[0]?.destination).toBe(`/trusted-publication/0.1.0/bun-linux-x64/${releaseSetArchiveBasename}`);
  expect(links[0]?.source.endsWith(`/${releaseSetArchiveBasename}`)).toBe(true);
  expect(current.fileSystem.removedDirectories).toContain(
    links[0]?.source.slice(0, -releaseSetArchiveBasename.length - 1),
  );
});

test("stops before smoke, config-search, and outer publication when two verified bot snapshots differ", async () => {
  const current = fixture();
  let compilerCalls = 0;
  current.dependencies.compiler.compile = (request) => {
    compilerCalls += 1;
    current.fileSystem.addFile(
      request.outputPath,
      new TextEncoder().encode(`compiled-${compilerCalls.toString()}`),
    );
    return Promise.resolve();
  };
  const links: string[] = [];
  await expect(
    assertReproducibleReleaseSet({
      publicationDependencies: {
        privateCandidateFileSystem: current.fileSystem,
        publicationFileSystem: {
          link: (): Promise<void> => {
            links.push("link");
            return Promise.resolve();
          },
        },
      },
      publicationRoot: "/trusted-publication",
      releaseDependencies: current.dependencies,
    }),
  ).rejects.toThrow("release-set reproducibility mismatch");
  expect(compilerCalls).toBe(2);
  expect(current.fileSystem.processOperations).toEqual([]);
  expect(links).toEqual([]);
});

test("removes the first candidate when its independent verification fails before a second build", async () => {
  const current = fixture();
  const read = current.fileSystem.readFile.bind(current.fileSystem);
  let isCorruptFirstZip = true;
  current.fileSystem.readFile = (name) => {
    if (isCorruptFirstZip && name.endsWith(".zip")) {
      isCorruptFirstZip = false;
      return Promise.resolve(new Uint8Array([0]));
    }
    return read(name);
  };
  await expect(
    assertReproducibleReleaseSet({
      publicationDependencies: {
        privateCandidateFileSystem: current.fileSystem,
        publicationFileSystem: { link: (): Promise<void> => Promise.resolve() },
      },
      publicationRoot: "/trusted-publication",
      releaseDependencies: current.dependencies,
    }),
  ).rejects.toThrow("release private candidate reproducibility verification failed");
  expect(current.compilerCalls).toHaveLength(1);
  expect(current.fileSystem.removedDirectories).toHaveLength(1);
});
