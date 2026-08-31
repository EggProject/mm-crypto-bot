/* eslint-disable security/detect-non-literal-fs-filename -- the shim mirrors Bun.file/Bun.write for explicit test-selected paths */
import { access, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";

import { parse } from "smol-toml";

function bunFile(path: string): {
  readonly exists: () => Promise<boolean>;
  readonly text: () => Promise<string>;
} {
  return {
    exists: async (): Promise<boolean> => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    text: async (): Promise<string> => readFile(path, "utf8"),
  };
}

function bunSpawn(options: {
  readonly cmd: readonly [string, ...string[]];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: "pipe";
  readonly stderr: "pipe";
}): {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals): void;
} {
  const [command, ...arguments_] = options.cmd;
  const process = spawn(command, arguments_, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number>((resolve, reject) => {
    process.once("error", reject);
    process.once("exit", (code) => {
      resolve(code ?? 1);
    });
  });

  return {
    stdout: Readable.toWeb(process.stdout),
    stderr: Readable.toWeb(process.stderr),
    exited,
    get exitCode(): number | null {
      return process.exitCode;
    },
    kill: (signal?: NodeJS.Signals): void => {
      process.kill(signal);
    },
  };
}

const bunCompatibility = {
  TOML: { parse },
  file: bunFile,
  spawn: bunSpawn,
  sleep: async (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  write: async (path: string, contents: string): Promise<number> => {
    await writeFile(path, contents);
    return Buffer.byteLength(contents);
  },
};

Object.defineProperty(globalThis, "Bun", {
  configurable: true,
  value: bunCompatibility,
});
