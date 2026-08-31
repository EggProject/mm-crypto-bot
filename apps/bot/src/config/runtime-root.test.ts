import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgv } from "../cli/argv.js";
import type { CliContext } from "../cli/router.js";
import { createConfigCommand } from "../cli/commands/config.js";
import { DEFAULT_BOT_CONFIG } from "./defaults.js";
import {
  resolveRuntimeRootConfig,
  type RuntimeRootFailureCode,
  type RuntimeRootPathOperations,
} from "./runtime-root.js";

const REPOSITORY_ROOT = "/workspace/mm-crypto-bot";
const RUNTIME_ROOT = "/var/lib/mm-crypto-bot";
const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };
const lexicalPathOperations: RuntimeRootPathOperations = {
  isAbsolute: (pathName) => path.isAbsolute(pathName),
  join: (...pathNames) => path.join(...pathNames),
  relative: (from, to) => path.relative(from, to),
  realpath: (pathName) => pathName,
  resolve: (pathName) => path.resolve(pathName),
};

describe("resolveRuntimeRootConfig", () => {
  it("rejects a runtime-root symlink whose canonical target is the repository", () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "mm-runtime-root-symlink-"));
    const repoRoot = path.join(fixtureRoot, "repository");
    const runtimeRoot = path.join(fixtureRoot, "runtime");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This directory is a child of this test's fresh mkdtemp root.
    mkdirSync(repoRoot);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test-owned symlink targets a child of its fresh mkdtemp root.
    symlinkSync(repoRoot, runtimeRoot);

    try {
      const result = resolveRuntimeRootConfig({
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: runtimeRoot },
        repositoryRoot: repoRoot,
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "runtime-root-repository-boundary",
          message: "Runtime configuration root is unavailable.",
        },
      });
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects a default config symlink whose canonical target is outside the runtime root", () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "mm-runtime-config-symlink-"));
    const repoRoot = path.join(fixtureRoot, "repository");
    const runtimeRoot = path.join(fixtureRoot, "runtime");
    const configDirectory = path.join(runtimeRoot, "config");
    const externalConfig = path.join(fixtureRoot, "external.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This directory is a child of this test's fresh mkdtemp root.
    mkdirSync(repoRoot);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This directory is a child of this test's fresh mkdtemp root.
    mkdirSync(configDirectory, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This file is a child of this test's fresh mkdtemp root.
    writeFileSync(externalConfig, '[bot]\nmode = "paper"\n', "utf8");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test-owned symlink targets a child of its fresh mkdtemp root.
    symlinkSync(externalConfig, path.join(configDirectory, "default.toml"));

    try {
      const result = resolveRuntimeRootConfig({
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: runtimeRoot },
        repositoryRoot: repoRoot,
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "runtime-config-repository-boundary",
          message: "Runtime configuration root is unavailable.",
        },
      });
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects a default config symlink whose canonical target is inside the repository", () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "mm-runtime-config-repository-"));
    const repoRoot = path.join(fixtureRoot, "repository");
    const runtimeRoot = path.join(fixtureRoot, "runtime");
    const configDirectory = path.join(runtimeRoot, "config");
    const repoConfig = path.join(repoRoot, "default.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This directory is a child of this test's fresh mkdtemp root.
    mkdirSync(repoRoot);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This directory is a child of this test's fresh mkdtemp root.
    mkdirSync(configDirectory, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This file is a child of this test's fresh mkdtemp root.
    writeFileSync(repoConfig, '[bot]\nmode = "paper"\n', "utf8");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This test-owned symlink targets a child of its fresh mkdtemp root.
    symlinkSync(repoConfig, path.join(configDirectory, "default.toml"));

    try {
      const result = resolveRuntimeRootConfig({
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: runtimeRoot },
        repositoryRoot: repoRoot,
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "runtime-config-repository-boundary",
          message: "Runtime configuration root is unavailable.",
        },
      });
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("derives the canonical external template path from an own environment value", () => {
    const result = resolveRuntimeRootConfig({
      environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: `${RUNTIME_ROOT}/` },
      repositoryRoot: REPOSITORY_ROOT,
      pathOperations: lexicalPathOperations,
    });

    expect(result).toEqual({
      ok: true,
      runtimeRoot: RUNTIME_ROOT,
      configPath: `${RUNTIME_ROOT}/config/default.toml`,
    });
  });

  const rejectedRuntimeRoots = [
    ["missing", {}, "runtime-root-missing"],
    ["empty", { MM_CRYPTO_BOT_RUNTIME_ROOT: "" }, "runtime-root-invalid"],
    ["relative", { MM_CRYPTO_BOT_RUNTIME_ROOT: "runtime" }, "runtime-root-invalid"],
    ["repository root", { MM_CRYPTO_BOT_RUNTIME_ROOT: REPOSITORY_ROOT }, "runtime-root-repository-boundary"],
    [
      "repository child",
      { MM_CRYPTO_BOT_RUNTIME_ROOT: `${REPOSITORY_ROOT}/runtime` },
      "runtime-root-repository-boundary",
    ],
  ] satisfies readonly (readonly [string, Readonly<Record<string, string>>, RuntimeRootFailureCode])[];

  it.each(rejectedRuntimeRoots)(
    "rejects a %s runtime root with a stable sanitized failure",
    (_name, environment, code) => {
      const result = resolveRuntimeRootConfig({
        environment,
        repositoryRoot: REPOSITORY_ROOT,
        pathOperations: lexicalPathOperations,
      });

      expect(result).toEqual({
        ok: false,
        error: { code, message: "Runtime configuration root is unavailable." },
      });
    },
  );

  it("rejects an accessor environment value without evaluating it", () => {
    const environment: Record<string, unknown> = {};
    Object.defineProperty(environment, "MM_CRYPTO_BOT_RUNTIME_ROOT", {
      enumerable: true,
      get: () => {
        throw new Error("must not read hostile accessor");
      },
    });

    const result = resolveRuntimeRootConfig({ environment, repositoryRoot: REPOSITORY_ROOT });

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime-root-invalid", message: "Runtime configuration root is unavailable." },
    });
  });

  it("rejects non-object and non-string own environment inputs", () => {
    const scalarResult = resolveRuntimeRootConfig({
      environment: "runtime",
      repositoryRoot: REPOSITORY_ROOT,
    });
    const nonStringResult = resolveRuntimeRootConfig({
      environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: 10 },
      repositoryRoot: REPOSITORY_ROOT,
    });

    expect(scalarResult).toEqual({
      ok: false,
      error: { code: "runtime-root-invalid", message: "Runtime configuration root is unavailable." },
    });
    expect(nonStringResult).toEqual({
      ok: false,
      error: { code: "runtime-root-invalid", message: "Runtime configuration root is unavailable." },
    });
  });

  it("rejects a proxy environment that refuses own-property inspection", () => {
    const environment = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("must not traverse hostile proxy");
        },
      },
    );

    const result = resolveRuntimeRootConfig({ environment, repositoryRoot: REPOSITORY_ROOT });

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime-root-invalid", message: "Runtime configuration root is unavailable." },
    });
  });

  it("allows a lexical parent of the repository as an external runtime root", () => {
    const result = resolveRuntimeRootConfig({
      environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: "/workspace" },
      repositoryRoot: REPOSITORY_ROOT,
      pathOperations: lexicalPathOperations,
    });

    expect(result).toEqual({
      ok: true,
      runtimeRoot: "/workspace",
      configPath: "/workspace/config/default.toml",
    });
  });

  it("treats an injected Windows-parent relative path as external", () => {
    const paths: RuntimeRootPathOperations = {
      isAbsolute: (pathName) => pathName.startsWith("/"),
      join: (root, relativePath) => `${root}/${relativePath}`,
      relative: (from) => (from === REPOSITORY_ROOT ? String.raw`..\external` : "config/default.toml"),
      realpath: (pathName) => pathName,
      resolve: (pathName) => pathName,
    };

    const result = resolveRuntimeRootConfig({
      environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: RUNTIME_ROOT },
      repositoryRoot: REPOSITORY_ROOT,
      pathOperations: paths,
    });

    expect(result).toEqual({
      ok: true,
      runtimeRoot: RUNTIME_ROOT,
      configPath: `${RUNTIME_ROOT}/config/default.toml`,
    });
  });

  it("returns a sanitized invalid failure when injected path canonicalization throws", () => {
    const paths: RuntimeRootPathOperations = {
      isAbsolute: () => true,
      join: () => "unused",
      relative: () => "unused",
      realpath: (pathName) => pathName,
      resolve: () => {
        throw new Error("path adapter failed");
      },
    };

    const result = resolveRuntimeRootConfig({
      environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: RUNTIME_ROOT },
      repositoryRoot: REPOSITORY_ROOT,
      pathOperations: paths,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime-root-invalid", message: "Runtime configuration root is unavailable." },
    });
  });

  it("returns a sanitized unavailable failure when canonicalizing the default config fails", () => {
    let realpathCalls = 0;
    const paths: RuntimeRootPathOperations = {
      ...lexicalPathOperations,
      realpath: (pathName) => {
        realpathCalls += 1;
        if (realpathCalls === 3) throw new Error("missing template");
        return pathName;
      },
    };

    const result = resolveRuntimeRootConfig({
      environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: RUNTIME_ROOT },
      repositoryRoot: REPOSITORY_ROOT,
      pathOperations: paths,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "runtime-config-unavailable", message: "Runtime configuration root is unavailable." },
    });
  });
});

describe("config runtime-root admission", () => {
  it("keeps an explicit config path and never resolves the runtime root", async () => {
    let rootResolutions = 0;
    let loadedPath = "";
    const command = createConfigCommand({
      loadConfig: (path) => {
        loadedPath = path ?? "";
        return DEFAULT_BOT_CONFIG;
      },
      resolveRuntimeRoot: () => {
        rootResolutions += 1;
        return {
          ok: false,
          error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
        };
      },
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {
      void 0;
    });

    try {
      const code = await command(parseArgv(["config", "validate", "--config=/etc/mm-bot.toml"]), CLI_CONTEXT);

      expect(code).toBe(0);
      expect(rootResolutions).toBe(0);
      expect(loadedPath).toBe("/etc/mm-bot.toml");
    } finally {
      logSpy.mockRestore();
    }
  });

  it.each(["validate", "show", "init"])(
    "fails %s before loader or write side effects when runtime root is invalid",
    async (subcommand) => {
      let loadCalls = 0;
      let initCalls = 0;
      const command = createConfigCommand({
        loadConfig: () => {
          loadCalls += 1;
          return DEFAULT_BOT_CONFIG;
        },
        initConfig: () => {
          initCalls += 1;
          return 0;
        },
        resolveRuntimeRoot: () => ({
          ok: false,
          error: { code: "runtime-root-invalid", message: "Runtime configuration root is unavailable." },
        }),
      });
      const errorSpy = spyOn(console, "error").mockImplementation(() => {
        void 0;
      });

      try {
        const code = await command(parseArgv(["config", subcommand]), CLI_CONTEXT);

        expect(code).toBe(2);
        expect(loadCalls).toBe(0);
        expect(initCalls).toBe(0);
        expect(errorSpy).toHaveBeenCalledWith(
          "Runtime configuration root is unavailable. (runtime-root-invalid)",
        );
      } finally {
        errorSpy.mockRestore();
      }
    },
  );

  it("passes the runtime template path to init only after resolution", async () => {
    let sourcePath = "";
    const command = createConfigCommand({
      initConfig: (_outPath, resolvedSourcePath) => {
        sourcePath = resolvedSourcePath;
        return 0;
      },
      resolveRuntimeRoot: () => ({
        ok: true,
        runtimeRoot: RUNTIME_ROOT,
        configPath: `${RUNTIME_ROOT}/config/default.toml`,
      }),
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {
      void 0;
    });

    try {
      const code = await command(parseArgv(["config", "init"]), CLI_CONTEXT);

      expect(code).toBe(0);
      expect(sourcePath).toBe(`${RUNTIME_ROOT}/config/default.toml`);
    } finally {
      logSpy.mockRestore();
    }
  });
});
