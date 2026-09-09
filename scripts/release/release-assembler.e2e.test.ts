import { assembleAllReleases, assembleRelease, assertReleasePreconditions } from "./release-assembler";
import { fixture, repoRoot, rootPackageBytes, type Fixture } from "./release-assembler.test-support";

interface Expectation {
  readonly rejects: { toThrow(expected?: string | RegExp): Promise<void> };
  readonly resolves: { toEqual(expected: unknown): Promise<void> };
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
}
interface TestApi {
  expect(actual: unknown): Expectation;
  test(name: string, run: () => void | Promise<void>): void;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isTestApi(value: unknown): value is TestApi {
  return isRecord(value) && typeof value["expect"] === "function" && typeof value["test"] === "function";
}
const runtime: unknown = await import(typeof Bun === "undefined" ? "vitest" : "bun:test");
if (!isTestApi(runtime)) throw new Error("The selected test runtime does not expose the required API.");
const expect = (actual: unknown): Expectation => runtime.expect(actual);
const test = (name: string, run: () => void | Promise<void>): void => {
  runtime.test(name, run);
};

test("assembles a private config-search candidate and removes it after a compiler failure", async () => {
  // Catches public-output assembly and retention of failed private candidates.
  const success = fixture();
  const result = await assembleRelease(success.dependencies, "config-search");
  expect(result.manifest.app).toEqual("config-search");
  expect(success.fileSystem.pathKind(result.candidate.zipPath)).toEqual("regular-file");

  const failed = fixture();
  failed.dependencies.compiler.compile = () => Promise.reject(new Error("compiler failure"));
  await expect(assembleRelease(failed.dependencies, "bot")).rejects.toThrow("compiler failure");
  expect(failed.fileSystem.removedDirectories).toEqual(["/private/mm-crypto-bot-bot-candidate-1"]);
});

test("fails every global and app precondition before compiler activity", async () => {
  // Catches accepting drifted toolchain, Git, lock, package, or entrypoint evidence.
  for (const configure of [
    (current: Fixture): void => {
      current.dependencies.git.porcelainStatus = () => Promise.resolve(" M x\n");
    },
    (current: Fixture): void => {
      current.dependencies.git.headCommit = () => Promise.resolve("A".repeat(40));
    },
    (current: Fixture): void => {
      current.dependencies.git.headCommitEpoch = () => Promise.resolve("1.5");
    },
    (current: Fixture): void => {
      current.dependencies.toolchain.bunVersion = () => Promise.resolve("1.3.13");
    },
    (current: Fixture): void => {
      current.dependencies.toolchain.nodeVersion = () => Promise.resolve("v24.19.1");
    },
    (current: Fixture): void => {
      current.fileSystem.setKind(`${repoRoot}/bun.lock`, "symbolic-link");
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(`${repoRoot}/package.json`, rootPackageBytes("bun@1.3.13"));
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(`${repoRoot}/.bun-version`, new TextEncoder().encode("1.3.13\n"));
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(`${repoRoot}/.nvmrc`, new TextEncoder().encode("24.19.1\n"));
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(`${repoRoot}/apps/bot/package.json`, new TextEncoder().encode("[]"));
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(`${repoRoot}/apps/bot/package.json`, new TextEncoder().encode("{}"));
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(
        `${repoRoot}/apps/bot/package.json`,
        new TextEncoder().encode('{"version":"0.1.1"}'),
      );
    },
    (current: Fixture): void => {
      current.fileSystem.setKind(`${repoRoot}/apps/bot/src/index.ts`, "other");
    },
  ]) {
    const current = fixture();
    configure(current);
    await expect(assembleRelease(current.dependencies, "bot")).rejects.toThrow();
    expect(current.compilerCalls).toEqual([]);
  }
});

test("rejects every post-mkdtemp output failure and deletes only proven owned directories", async () => {
  // Catches unremoved partial candidates and trusting hostile directory return values.
  for (const kind of ["missing", "directory", "symbolic-link"] as const) {
    const current = fixture();
    current.dependencies.compiler.compile = (input) => {
      if (kind !== "missing") current.fileSystem.setKind(input.outputPath, kind);
      return Promise.resolve();
    };
    await expect(assembleRelease(current.dependencies, "bot")).rejects.toThrow();
    expect(current.fileSystem.removedDirectories).toHaveLength(1);
  }
  const write = fixture();
  write.fileSystem.failNextWrite();
  await expect(assembleRelease(write.dependencies, "bot")).rejects.toThrow();
  expect(write.fileSystem.removedDirectories).toHaveLength(1);
  const remove = fixture();
  remove.fileSystem.failNextRemove();
  await expect(assembleRelease(remove.dependencies, "bot")).rejects.toThrow();
  expect(remove.fileSystem.removedDirectories).toHaveLength(1);
  const retained = fixture();
  retained.fileSystem.retainNextRemovedFile();
  await expect(assembleRelease(retained.dependencies, "bot")).rejects.toThrow();
  expect(retained.fileSystem.removedDirectories).toHaveLength(1);
  const malformed = fixture();
  const malformedDirectory = { path: "/private/candidate", extra: true };
  malformed.fileSystem.setNextPrivateDirectoryValue(malformedDirectory);
  await expect(assembleRelease(malformed.dependencies, "bot")).rejects.toThrow();
  expect(malformed.fileSystem.removedDirectories).toEqual([]);
});

test("validates both applications before all-release compilation", async () => {
  // Catches compiling a first application before a later application precondition fails.
  const failed = fixture();
  failed.fileSystem.addFile(
    `${repoRoot}/apps/config-search/package.json`,
    new TextEncoder().encode('{"version":"0.1.1"}'),
  );
  await expect(assembleAllReleases(failed.dependencies)).rejects.toThrow();
  expect(failed.compilerCalls).toEqual([]);
  const valid = fixture();
  await expect(assertReleasePreconditions(valid.dependencies)).resolves.toEqual({
    commit: "a".repeat(40),
    lockfileSha256: "3d0abe3e8f9631c12a42e96531a6a0727a4752fb15508ebf30dca059607f498d",
    sourceDateEpoch: 1_788_199_915,
  });
  const all = fixture();
  const results = await assembleAllReleases(all.dependencies);
  expect(results.map((result) => result.manifest.app)).toEqual(["bot", "config-search"]);
});

test("rejects every malformed metadata representation and unsafe private boundary", async () => {
  // Catches decoder errors, missing object fields, unsafe epochs, and escapes after mkdtemp.
  for (const configure of [
    (current: Fixture): void => {
      current.dependencies.git.headCommitEpoch = () => Promise.resolve("9999999999999999");
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(`${repoRoot}/package.json`, new Uint8Array([0xff]));
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(`${repoRoot}/package.json`, new TextEncoder().encode("[]"));
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(`${repoRoot}/package.json`, new TextEncoder().encode("{}"));
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(
        `${repoRoot}/package.json`,
        new TextEncoder().encode('{"packageManager":"bun@1.3.14","engines":[]}'),
      );
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(
        `${repoRoot}/package.json`,
        new TextEncoder().encode(
          '{"packageManager":"bun@1.3.14","engines":{"bun":"1.3.13","node":"24.19.0"}}',
        ),
      );
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(
        `${repoRoot}/package.json`,
        new TextEncoder().encode('{"packageManager":"bun@1.3.14","engines":{"bun":"1.3.14","node":1}}'),
      );
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(`${repoRoot}/.bun-version`, new Uint8Array([0xff]));
    },
    (current: Fixture): void => {
      current.fileSystem.addFile(`${repoRoot}/apps/bot/package.json`, new Uint8Array([0xff]));
    },
  ]) {
    const current = fixture();
    configure(current);
    await expect(assembleRelease(current.dependencies, "bot")).rejects.toThrow();
  }
  const outside = fixture();
  outside.fileSystem.setNextPrivateDirectory("/outside/candidate");
  await expect(assembleRelease(outside.dependencies, "bot")).rejects.toThrow(
    "release candidate directory escapes its allowed root",
  );
  expect(outside.fileSystem.removedDirectories).toEqual([]);
  const invalidStatus = fixture();
  invalidStatus.fileSystem.failNextLstat();
  await expect(assembleRelease(invalidStatus.dependencies, "bot")).rejects.toThrow();

  const cleanup = fixture();
  cleanup.dependencies.compiler.compile = () => Promise.reject(new Error("compiler failure"));
  cleanup.fileSystem.failNextDirectoryRemoval();
  await expect(assembleRelease(cleanup.dependencies, "bot")).rejects.toThrow(
    "release private candidate cleanup failed",
  );
  const nullPrototype = fixture();
  nullPrototype.fileSystem.setNextPrivateDirectoryValue(
    new Proxy(
      { path: "/private/mm-crypto-bot-bot-candidate-1" },
      { getPrototypeOf: () => Object.freeze({}) },
    ),
  );
  await expect(assembleRelease(nullPrototype.dependencies, "bot")).rejects.toThrow();
  const nonStringPath = fixture();
  nonStringPath.fileSystem.setNextPrivateDirectoryValue(
    new Proxy(
      { path: "/private/mm-crypto-bot-bot-candidate-1" },
      {
        getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: 1, writable: true }),
      },
    ),
  );
  await expect(assembleRelease(nonStringPath.dependencies, "bot")).rejects.toThrow();
});

test("accepts only an immediate candidate directory with the requested application prefix", async () => {
  // Catches nested or cross-prefix temporary directories being treated as owned candidates.
  for (const directory of [
    "/private/mm-crypto-bot-bot-candidate-1/nested",
    "/private/mm-crypto-bot-config-search-candidate-1",
    "/private/mm-crypto-bot-bot-candidate-",
  ]) {
    const current = fixture();
    current.fileSystem.setNextPrivateDirectory(directory);
    await expect(assembleRelease(current.dependencies, "bot")).rejects.toThrow(
      "release candidate directory escapes its allowed root",
    );
    expect(current.fileSystem.removedDirectories).toEqual([]);
  }
  const trapped = fixture();
  trapped.fileSystem.setNextPrivateDirectoryValue(
    new Proxy(
      { path: "/private/mm-crypto-bot-bot-candidate-1" },
      {
        getOwnPropertyDescriptor: (): never => {
          throw new Error("directory descriptor trap");
        },
      },
    ),
  );
  await expect(assembleRelease(trapped.dependencies, "bot")).rejects.toThrow(
    "release candidate directory escapes its allowed root",
  );
  expect(trapped.fileSystem.removedDirectories).toEqual([]);
});

test("cleans prior all-release candidates after the second assembly fails", async () => {
  // Catches leaving the completed first application candidate unreturned and undeleted.
  const current = fixture();
  current.dependencies.compiler.compile = (input) => {
    if (input.entryPoint.endsWith("config-search/src/index.ts")) {
      return Promise.reject(new Error("second compiler failure"));
    }
    current.fileSystem.addFile(input.outputPath, new TextEncoder().encode("bot payload\n"));
    return Promise.resolve();
  };
  await expect(assembleAllReleases(current.dependencies)).rejects.toThrow("second compiler failure");
  expect(current.fileSystem.removedDirectories).toEqual([
    "/private/mm-crypto-bot-config-search-candidate-2",
    "/private/mm-crypto-bot-bot-candidate-1",
  ]);
});

test("returns the stable cleanup failure after attempting both failed-all-release cleanups", async () => {
  // Catches an all-release cleanup failure leaking its cause or skipping the completed first candidate.
  const current = fixture();
  current.dependencies.compiler.compile = (input) => {
    if (input.entryPoint.endsWith("config-search/src/index.ts")) {
      return Promise.reject(new Error("second compiler failure"));
    }
    current.fileSystem.addFile(input.outputPath, new TextEncoder().encode("bot payload\n"));
    return Promise.resolve();
  };
  const remove = current.dependencies.fileSystem.removePrivateDirectory.bind(current.dependencies.fileSystem);
  let removalCount = 0;
  current.dependencies.fileSystem.removePrivateDirectory = (directory) => {
    removalCount += 1;
    if (removalCount === 2) return Promise.reject(new Error("first candidate cleanup failure"));
    return remove(directory);
  };
  await expect(assembleAllReleases(current.dependencies)).rejects.toThrow(
    "release private candidate cleanup failed",
  );
  expect(removalCount).toEqual(2);
  expect(current.fileSystem.removedDirectories).toEqual(["/private/mm-crypto-bot-config-search-candidate-2"]);
});
