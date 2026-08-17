/* eslint-disable security/detect-non-literal-fs-filename -- the shim mirrors Bun.file/Bun.write for explicit test-selected paths */
import { access, readFile, writeFile } from "node:fs/promises";

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

const bunCompatibility = {
  TOML: { parse },
  file: bunFile,
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
