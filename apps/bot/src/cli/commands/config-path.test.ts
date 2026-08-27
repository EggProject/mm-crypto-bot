import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  reportConfigPathFailure,
  resolveConfigPath,
  resolveDefaultConfigPath,
  resolveDefaultRuntimeRoot,
} from "./config-path.js";

describe("resolveConfigPath", () => {
  it("returns an explicit nonempty config path without invoking the runtime-root resolver", () => {
    let resolverCalls = 0;

    const result = resolveConfigPath("/etc/mm-bot.toml", () => {
      resolverCalls += 1;
      return {
        ok: false,
        error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
      };
    });

    expect(result).toEqual({ ok: true, configPath: "/etc/mm-bot.toml" });
    expect(resolverCalls).toBe(0);
  });

  it("returns the runtime-root failure when no explicit config path exists", () => {
    const result = resolveConfigPath(undefined, () => ({
      ok: false,
      error: { code: "runtime-config-unavailable", message: "Runtime configuration root is unavailable." },
    }));

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime-config-unavailable", message: "Runtime configuration root is unavailable." },
    });
  });

  it("keeps explicit paths on the default resolver path without reading environment", () => {
    expect(resolveDefaultConfigPath("/etc/mm-bot.toml")).toEqual({
      ok: true,
      configPath: "/etc/mm-bot.toml",
    });
  });

  it("reports the sanitized runtime-root error", () => {
    const error = spyOn(console, "error").mockImplementation(() => {
      void 0;
    });
    try {
      reportConfigPathFailure({
        ok: false,
        error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
      });
      expect(error).toHaveBeenCalledWith("Runtime configuration root is unavailable. (runtime-root-missing)");
    } finally {
      error.mockRestore();
    }
  });

  it("resolves the configured external runtime root through the default environment boundary", () => {
    const runtimeRoot = mkdtempSync(path.join(tmpdir(), "mm-runtime-root-"));
    const previous = process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"];
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is a child of this test's fresh mkdtemp root.
      mkdirSync(path.join(runtimeRoot, "config"));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is a child of this test's fresh mkdtemp root.
      writeFileSync(path.join(runtimeRoot, "config", "default.toml"), "[bot]\nmode = 'paper'\n", "utf8");
      process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"] = runtimeRoot;
      expect(resolveDefaultRuntimeRoot()).toMatchObject({
        ok: true,
        configPath: path.join(runtimeRoot, "config", "default.toml"),
      });
    } finally {
      if (previous === undefined) delete process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"];
      else process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"] = previous;
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
