import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgv } from "../argv.js";
import type { CliContext } from "../router.js";
import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";

import { createConfigCommand, runConfigInit, type ConfigFileBoundary } from "./config.js";

const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };
const join = (...pathNames: readonly string[]): string => path.join(...pathNames);

function createRuntimeTemplate(): { readonly root: string; readonly source: string } {
  const root = mkdtempSync(join(tmpdir(), "mm-runtime-root-"));
  const directory = join(root, "config");
  const source = join(directory, "default.toml");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact directory is a child of this test's fresh mkdtemp root.
  mkdirSync(directory);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact template file is a child of this test's fresh mkdtemp root.
  writeFileSync(source, '[bot]\nmode = "paper"\n', "utf8");
  return { root, source };
}

describe("config init", () => {
  let errorSpy: { mockRestore: () => void };
  let logSpy: { mockRestore: () => void };

  beforeEach(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {
      void 0;
    });
    logSpy = spyOn(console, "log").mockImplementation(() => {
      void 0;
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("copies the resolved external runtime template to --out", async () => {
    const runtime = createRuntimeTemplate();
    const output = join(runtime.root, "output.toml");
    const command = createConfigCommand({
      resolveRuntimeRoot: () => ({ ok: true, runtimeRoot: runtime.root, configPath: runtime.source }),
    });
    try {
      expect(await command(parseArgv(["config", "init", `--out=${output}`]), CLI_CONTEXT)).toBe(0);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact output path is a child of this test's fresh mkdtemp root.
      expect(readFileSync(output, "utf8")).toBe('[bot]\nmode = "paper"\n');
    } finally {
      rmSync(runtime.root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing output after template resolution", async () => {
    const runtime = createRuntimeTemplate();
    const output = join(runtime.root, "existing.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact output path is a child of this test's fresh mkdtemp root.
    writeFileSync(output, "existing", "utf8");
    const command = createConfigCommand({
      resolveRuntimeRoot: () => ({ ok: true, runtimeRoot: runtime.root, configPath: runtime.source }),
    });
    try {
      expect(await command(parseArgv(["config", "init", `--out=${output}`]), CLI_CONTEXT)).toBe(1);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact output path is a child of this test's fresh mkdtemp root.
      expect(readFileSync(output, "utf8")).toBe("existing");
    } finally {
      rmSync(runtime.root, { recursive: true, force: true });
    }
  });

  it("creates missing output directories", async () => {
    const runtime = createRuntimeTemplate();
    const output = join(runtime.root, "nested", "output.toml");
    const command = createConfigCommand({
      resolveRuntimeRoot: () => ({ ok: true, runtimeRoot: runtime.root, configPath: runtime.source }),
    });
    try {
      expect(await command(parseArgv(["config", "init", `--out=${output}`]), CLI_CONTEXT)).toBe(0);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact output path is a child of this test's fresh mkdtemp root.
      expect(readFileSync(output, "utf8")).toBe('[bot]\nmode = "paper"\n');
    } finally {
      rmSync(runtime.root, { recursive: true, force: true });
    }
  });

  it("uses the current directory only for its default output", async () => {
    const runtime = createRuntimeTemplate();
    const workingDirectory = mkdtempSync(join(tmpdir(), "mm-runtime-root-cwd-"));
    const originalWorkingDirectory = process.cwd();
    const command = createConfigCommand({
      resolveRuntimeRoot: () => ({ ok: true, runtimeRoot: runtime.root, configPath: runtime.source }),
    });
    try {
      process.chdir(workingDirectory);
      expect(await command(parseArgv(["config", "init"]), CLI_CONTEXT)).toBe(0);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact output path is a child of this test's fresh mkdtemp root.
      expect(readFileSync(join(workingDirectory, "mm-bot.toml"), "utf8")).toBe('[bot]\nmode = "paper"\n');
    } finally {
      process.chdir(originalWorkingDirectory);
      rmSync(workingDirectory, { recursive: true, force: true });
      rmSync(runtime.root, { recursive: true, force: true });
    }
  });

  it("reports the sanitized missing-template contract without writing", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-runtime-root-"));
    const output = join(directory, "output.toml");
    try {
      expect(runConfigInit(output, join(directory, "missing.toml"))).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith("Could not locate the runtime config template.");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not write when the source path fails the file boundary", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-runtime-root-"));
    const output = join(directory, "output.toml");
    try {
      expect(() => runConfigInit(output, "\0")).toThrow("normalized absolute path");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renders non-Error file-boundary write failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-runtime-root-"));
    const output = join(directory, "output.toml");
    const source = join(directory, "template.toml");
    const boundary: ConfigFileBoundary = {
      exists: (path) => path === directory || path === source,
      read: () => '[bot]\nmode = "paper"\n',
      ensureDirectory: () => {
        void 0;
      },
      write: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- This test-owned boundary must preserve a non-Error hostile throw.
        throw "write failure";
      },
    };
    try {
      expect(runConfigInit(output, source, boundary)).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("write failure"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renders Error file-boundary write failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-runtime-root-"));
    const output = join(directory, "output.toml");
    const source = join(directory, "template.toml");
    const boundary: ConfigFileBoundary = {
      exists: (path) => path === directory || path === source,
      read: () => '[bot]\nmode = "paper"\n',
      ensureDirectory: () => {
        void 0;
      },
      write: () => {
        throw new Error("write error");
      },
    };
    try {
      expect(runConfigInit(output, source, boundary)).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("write error"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
