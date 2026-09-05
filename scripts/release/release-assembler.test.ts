import { assembleAllReleases, assembleRelease, assertReleasePreconditions } from "./release-assembler";
import {
  fixture,
  repoRoot,
  rootPackageBytes,
  temporaryRoot,
  type Fixture,
  type FixtureOptions,
} from "./release-assembler.test-support";
import { parseStoreZip } from "./zip-store";

interface AsyncTestExpectation {
  toThrow(expected?: string | RegExp): Promise<void>;
}

interface TestExpectation {
  readonly rejects: AsyncTestExpectation;
  readonly resolves: { toEqual(expected: unknown): Promise<void> };
  toContain(expected: unknown): void;
  toEqual(expected: unknown): void;
  toThrow(expected?: string | RegExp): void;
}

interface TestRuntimeApi {
  describe(name: string, run: () => void): void;
  expect(actual: unknown): TestExpectation;
  test(name: string, run: () => void | Promise<void>): void;
}

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null;

const isTestRuntimeApi = (candidate: unknown): candidate is TestRuntimeApi => {
  if (!isRecord(candidate)) {
    return false;
  }
  const { describe, expect, test } = candidate;
  return typeof describe === "function" && typeof expect === "function" && typeof test === "function";
};

const testRuntime: unknown = await import(typeof Bun === "undefined" ? "vitest" : "bun:test");
if (!isTestRuntimeApi(testRuntime)) {
  throw new Error("The selected test runtime does not expose the required API.");
}

const describe = (name: string, run: () => void): void => {
  testRuntime.describe(name, run);
};
const expect = (actual: unknown): TestExpectation => testRuntime.expect(actual);
const test = (name: string, run: () => void | Promise<void>): void => {
  testRuntime.test(name, run);
};

const text = new TextEncoder();
const decoded = new TextDecoder("utf-8", { fatal: true });

describe("release assembly", () => {
  test("rejects each failed global precondition before temporary compilation", async () => {
    const scenarios: readonly [FixtureOptions, string][] = [
      [{ status: " M apps/bot/src/index.ts\n" }, "clean Git worktree"],
      [{ commit: "A".repeat(40) }, "full lowercase Git commit"],
      [{ epoch: "1788199915.5" }, "Git commit epoch"],
      [{ bunVersion: "1.3.13" }, "Bun 1.3.14"],
      [{ nodeVersion: "v24.19.1" }, "raw Node CLI v24.19.0"],
    ];

    for (const [options, message] of scenarios) {
      const current = fixture(options);
      await expect(assembleRelease(current.dependencies, "bot")).rejects.toThrow(message);
      expect(current.compilerCalls).toEqual([]);
      expect(current.fileSystem.writeOperations).toEqual([]);
    }
  });

  test("requires the exact raw Node CLI version spelling", async () => {
    const accepted = fixture({ nodeVersion: "v24.19.0" });
    await expect(assertReleasePreconditions(accepted.dependencies)).resolves.toEqual({
      commit: "a".repeat(40),
      lockfileSha256: "3d0abe3e8f9631c12a42e96531a6a0727a4752fb15508ebf30dca059607f498d",
      sourceDateEpoch: 1_788_199_915,
    });

    for (const nodeVersion of ["24.19.0", "v24.19.1", "v24.19.0-extra"]) {
      const rejected = fixture({ nodeVersion });
      await expect(assembleRelease(rejected.dependencies, "bot")).rejects.toThrow("raw Node CLI v24.19.0");
      expect(rejected.compilerCalls).toEqual([]);
    }
  });

  test("rejects root toolchain metadata discrepancies before any temporary directory or compiler call", async () => {
    const scenarios: readonly [(current: Fixture) => void, string][] = [
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/package.json`, rootPackageBytes("bun@1.3.13"));
        },
        "root package.json packageManager",
      ],
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/package.json`, rootPackageBytes(undefined, "1.3.13"));
        },
        "root package.json engines.bun",
      ],
      [
        (current) => {
          current.fileSystem.addFile(
            `${repoRoot}/package.json`,
            rootPackageBytes(undefined, undefined, "24.19.1"),
          );
        },
        "root package.json engines.node",
      ],
      [
        (current) => {
          current.fileSystem.addFile(
            `${repoRoot}/package.json`,
            text.encode('{"engines":{"bun":1,"node":"24.19.0"},"packageManager":"bun@1.3.14"}'),
          );
        },
        "root package.json engines.bun",
      ],
      [
        (current) => {
          current.fileSystem.setKind(`${repoRoot}/package.json`, "missing");
        },
        "root package.json",
      ],
      [
        (current) => {
          current.fileSystem.setKind(`${repoRoot}/package.json`, "symbolic-link");
        },
        "root package.json",
      ],
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/package.json`, new Uint8Array([0xff]));
        },
        "valid JSON",
      ],
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/package.json`, text.encode("[]"));
        },
        "must be an object",
      ],
      [
        (current) => {
          current.fileSystem.addFile(
            `${repoRoot}/package.json`,
            text.encode('{"packageManager":"bun@1.3.14"}'),
          );
        },
        "engines must be an object",
      ],
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/.bun-version`, text.encode("1.3.13\n"));
        },
        ".bun-version",
      ],
      [
        (current) => {
          current.fileSystem.setKind(`${repoRoot}/.bun-version`, "missing");
        },
        ".bun-version",
      ],
      [
        (current) => {
          current.fileSystem.setKind(`${repoRoot}/.bun-version`, "symbolic-link");
        },
        ".bun-version",
      ],
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/.bun-version`, new Uint8Array([0xff]));
        },
        ".bun-version",
      ],
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/.nvmrc`, text.encode("24.19.1\n"));
        },
        ".nvmrc",
      ],
      [
        (current) => {
          current.fileSystem.setKind(`${repoRoot}/.nvmrc`, "missing");
        },
        ".nvmrc",
      ],
      [
        (current) => {
          current.fileSystem.setKind(`${repoRoot}/.nvmrc`, "symbolic-link");
        },
        ".nvmrc",
      ],
    ];

    for (const [configure, message] of scenarios) {
      const current = fixture();
      configure(current);
      await expect(assembleRelease(current.dependencies, "bot")).rejects.toThrow(message);
      expect(current.compilerCalls).toEqual([]);
      expect(current.fileSystem.temporaryDirectoryOperations).toEqual([]);
      expect(current.fileSystem.writeOperations).toEqual([]);
    }
  });

  test("hashes the exact regular bun lock before creating a private directory", async () => {
    const current = fixture();
    const identity = await assertReleasePreconditions(current.dependencies);

    expect(identity).toEqual({
      commit: "a".repeat(40),
      lockfileSha256: "3d0abe3e8f9631c12a42e96531a6a0727a4752fb15508ebf30dca059607f498d",
      sourceDateEpoch: 1_788_199_915,
    });
    expect(current.fileSystem.writeOperations).toEqual([]);
  });

  test("creates the fixed config-search payloads in an unpredictable private candidate only", async () => {
    const current = fixture();
    const result = await assembleRelease(current.dependencies, "config-search");
    const candidateDirectory = "/private/mm-crypto-bot-config-search-candidate-1";
    const zipName = "mm-crypto-bot-config-search-0.1.0-bun-linux-x64.zip";

    expect(current.compilerCalls).toEqual([
      {
        entryPoint: "/repo/apps/config-search/src/index.ts",
        outputPath: "/private/mm-crypto-bot-config-search-candidate-1/mm-crypto-bot-config-search",
        target: "bun-linux-x64",
      },
    ]);
    expect(result.candidate).toEqual({
      directory: candidateDirectory,
      sidecarPath: `${candidateDirectory}/${zipName}.sha256`,
      zipPath: `${candidateDirectory}/${zipName}`,
    });
    expect(result.manifest.payloads.map((payload) => payload.path)).toEqual([
      "README.md",
      "bin/mm-crypto-bot-config-search",
    ]);
    const zipWrite = current.fileSystem.writeOperations.find(
      (operation) => operation.path === `${candidateDirectory}/${zipName}`,
    );
    if (zipWrite === undefined) throw new Error("test fixture did not receive ZIP output");
    expect(parseStoreZip(zipWrite.bytes).entries.map((entry) => entry.path)).toEqual([
      "README.md",
      "bin/mm-crypto-bot-config-search",
      "manifest.json",
    ]);
    expect(decoded.decode(parseStoreZip(zipWrite.bytes).entries[0]?.bytes)).toContain(
      "MM_CRYPTO_BOT_RUNTIME_ROOT",
    );
  });

  test("compiles inside one private candidate and returns no compiler executable", async () => {
    const current = fixture();
    const result = await assembleRelease(current.dependencies, "bot");

    expect(current.fileSystem.temporaryDirectoryOperations).toEqual([
      { parentDirectory: temporaryRoot, prefix: "mm-crypto-bot-bot-candidate-" },
    ]);
    expect(current.fileSystem.pathKind(`${result.candidate.directory}/mm-crypto-bot-bot`)).toEqual("missing");
  });

  test("rejects missing, directory, and symlink compiler outputs before candidate writes", async () => {
    const scenarios: readonly ["directory" | "missing" | "symbolic-link", string][] = [
      ["missing", "received missing"],
      ["directory", "received directory"],
      ["symbolic-link", "received symbolic-link"],
    ];
    for (const [kind, message] of scenarios) {
      const current = fixture();
      current.dependencies.compiler.compile = (input) => {
        if (kind !== "missing") current.fileSystem.setKind(input.outputPath, kind);
        return Promise.resolve();
      };
      await expect(assembleRelease(current.dependencies, "bot")).rejects.toThrow(message);
      expect(current.fileSystem.chmodOperations).toEqual([]);
      expect(current.fileSystem.writeOperations).toEqual([]);
    }
  });

  test("fails closed when compiler or private executable removal fails", async () => {
    const compilerFailure = fixture();
    compilerFailure.dependencies.compiler.compile = () =>
      Promise.reject(new Error("injected compiler failure"));
    await expect(assembleRelease(compilerFailure.dependencies, "bot")).rejects.toThrow(
      "injected compiler failure",
    );
    expect(compilerFailure.fileSystem.pathKind("/repo/releases/bot/0.1.0/bun-linux-x64")).toEqual("missing");

    const removalFailure = fixture();
    removalFailure.fileSystem.failNextRemove();
    await expect(assembleRelease(removalFailure.dependencies, "bot")).rejects.toThrow(
      "injected remove failure",
    );
    expect(removalFailure.fileSystem.pathKind("/repo/releases/bot/0.1.0/bun-linux-x64")).toEqual("missing");

    const retainedExecutable = fixture();
    retainedExecutable.fileSystem.retainNextRemovedFile();
    await expect(assembleRelease(retainedExecutable.dependencies, "bot")).rejects.toThrow(
      "compiled executable remains in the private candidate",
    );
  });

  test("rejects invalid lock, application metadata, and entry files before compiling", async () => {
    const scenarios: readonly [(current: Fixture) => void, string][] = [
      [
        (current) => {
          current.fileSystem.setKind(`${repoRoot}/bun.lock`, "symbolic-link");
        },
        "bun.lock",
      ],
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/apps/bot/package.json`, new Uint8Array([0xff]));
        },
        "valid JSON",
      ],
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/apps/bot/package.json`, text.encode("[]"));
        },
        "must be an object",
      ],
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/apps/bot/package.json`, text.encode("{}"));
        },
        "string version",
      ],
      [
        (current) => {
          current.fileSystem.addFile(`${repoRoot}/apps/bot/package.json`, text.encode('{"version":"0.1.1"}'));
        },
        "version must be 0.1.0",
      ],
      [
        (current) => {
          current.fileSystem.setKind(`${repoRoot}/apps/bot/src/index.ts`, "other");
        },
        "entry point",
      ],
    ];

    for (const [configure, message] of scenarios) {
      const current = fixture();
      configure(current);
      await expect(assembleRelease(current.dependencies, "bot")).rejects.toThrow(message);
      expect(current.compilerCalls).toEqual([]);
    }
  });

  test("rejects unsafe epochs and private candidate path escapes before compiling", async () => {
    const unsafeEpoch = fixture({ epoch: "9999999999999999" });
    await expect(assembleRelease(unsafeEpoch.dependencies, "bot")).rejects.toThrow("Git commit epoch");
    expect(unsafeEpoch.compilerCalls).toEqual([]);

    const outsideTemporaryRoot = fixture();
    outsideTemporaryRoot.dependencies.fileSystem.mkdtemp = () =>
      Promise.resolve(Object.freeze({ path: "/outside/release" }));
    await expect(assembleRelease(outsideTemporaryRoot.dependencies, "bot")).rejects.toThrow(
      "release candidate directory escapes",
    );
    expect(outsideTemporaryRoot.compilerCalls).toEqual([]);
  });

  test("keeps failed candidate writes private and never creates a releases target", async () => {
    const current = fixture();
    current.fileSystem.failNextWrite();
    await expect(assembleRelease(current.dependencies, "bot")).rejects.toThrow("injected write failure");
    expect(current.fileSystem.pathKind("/repo/releases/bot/0.1.0/bun-linux-x64")).toEqual("missing");
  });

  test("assembles both fixed application releases only after validating both applications", async () => {
    const current = fixture();
    const results = await assembleAllReleases(current.dependencies);

    expect(results.map((result) => result.manifest.app)).toEqual(["bot", "config-search"]);
    expect(current.compilerCalls.map((call) => call.entryPoint)).toEqual([
      "/repo/apps/bot/src/index.ts",
      "/repo/apps/config-search/src/index.ts",
    ]);
  });

  test("does not compile either app when one all-release precondition fails", async () => {
    const current = fixture();
    current.fileSystem.addFile(
      `${repoRoot}/apps/config-search/package.json`,
      text.encode('{"version":"0.1.1"}'),
    );

    await expect(assembleAllReleases(current.dependencies)).rejects.toThrow(
      "config-search package version must be 0.1.0",
    );
    expect(current.compilerCalls).toEqual([]);
  });
});
