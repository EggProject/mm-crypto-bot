import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";

function file(filePath) {
  return {
    arrayBuffer: async () => {
      const contents = await readFile(filePath);
      return contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength);
    },
    exists: async () => {
      try {
        await readFile(filePath);
        return true;
      } catch {
        return false;
      }
    },
    text: () => readFile(filePath, "utf8"),
  };
}

function run(command, options) {
  const child = spawn(command[0], command.slice(1), { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
  return {
    exited: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    }),
    stdout: Readable.toWeb(child.stdout),
    stderr: Readable.toWeb(child.stderr),
  };
}

globalThis.Bun = {
  file,
  spawn: run,
  write: async (filePath, contents) => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  },
};
