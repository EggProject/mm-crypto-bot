import { expect, test } from "bun:test";

import {
  createZeroLegacySecureIo,
  type ZeroLegacyReadOnlyFileSystem,
  type ZeroLegacySecureIoFileHandle,
  type ZeroLegacySecureIoStat,
} from "./zero-legacy-secure-io.ts";

const fixtureRoot = "/fixture/repository";
const sourcePath = `${fixtureRoot}/source.ts`;
const expectedIdentity = "1:1:directory/1:2:file";

function pathStat(inode: bigint, size = 1n, kind: "directory" | "file" = "file"): ZeroLegacySecureIoStat {
  return Object.freeze({
    dev: 1n,
    ino: inode,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => false,
    size,
  });
}

function missingPathError(): Error & Readonly<{ code: "ENOENT" }> {
  return Object.assign(new Error("missing"), { code: "ENOENT" as const });
}

function fileHandle(
  stats: readonly ZeroLegacySecureIoStat[],
  readMode: "complete" | "truncated" = "complete",
): ZeroLegacySecureIoFileHandle {
  const remainingStats = [...stats];
  return Object.freeze({
    close: () => Promise.resolve(),
    fd: 42,
    read: (buffer: Uint8Array, offset: number, length: number) => {
      if (readMode === "truncated") {
        return Promise.resolve(Object.freeze({ bytesRead: 0 }));
      }
      buffer.fill(120, offset, offset + 1);
      return Promise.resolve(Object.freeze({ bytesRead: Math.min(1, length) }));
    },
    stat: () => {
      const next = remainingStats.shift();
      return next === undefined ? Promise.reject(new Error("Unexpected stat call")) : Promise.resolve(next);
    },
  });
}

function raceControlledFileSystem(
  lstatResults: readonly (Error | ZeroLegacySecureIoStat)[],
  descriptorPaths: readonly string[],
  handle: ZeroLegacySecureIoFileHandle,
): ZeroLegacyReadOnlyFileSystem {
  const remainingLstats = [...lstatResults];
  const remainingDescriptorPaths = [...descriptorPaths];
  return Object.freeze({
    lstat: () => {
      const next = remainingLstats.shift();
      if (next === undefined) {
        return Promise.reject(new Error("Unexpected lstat call"));
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    open: () => Promise.resolve(handle),
    readDirectory: () => Promise.resolve(Object.freeze([])),
    realpath: () => {
      const next = remainingDescriptorPaths.shift();
      return next === undefined
        ? Promise.reject(new Error("Unexpected realpath call"))
        : Promise.resolve(next);
    },
  });
}

async function expectSecureReadFailure(
  lstatResults: readonly (Error | ZeroLegacySecureIoStat)[],
  descriptorPaths: readonly string[],
  handle: ZeroLegacySecureIoFileHandle,
  expectedMessage: string,
): Promise<void> {
  const secureIo = createZeroLegacySecureIo({
    fileSystem: raceControlledFileSystem(lstatResults, descriptorPaths, handle),
    getOpenConstants: () => Promise.resolve(Object.freeze({ O_DIRECTORY: 4, O_NOFOLLOW: 2, O_RDONLY: 1 })),
  });
  let thrown: unknown;
  try {
    await secureIo.readUtf8(fixtureRoot, sourcePath, expectedIdentity);
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  if (thrown instanceof Error) {
    expect(thrown.message).toBe(expectedMessage);
  }
}

test("secure IO factory deterministically rejects descriptor containment and identity races", async () => {
  const directory = pathStat(1n, 0n, "directory");
  const source = pathStat(2n);
  const replacement = pathStat(3n);

  await expectSecureReadFailure(
    [directory, source],
    ["/outside/source.ts"],
    fileHandle([source]),
    "Opened target escapes repository root",
  );
  await expectSecureReadFailure(
    [directory, source],
    ["/fixture/repository/source.ts"],
    fileHandle([replacement]),
    "Target was replaced before descriptor validation",
  );
  await expectSecureReadFailure(
    [directory, source],
    ["/fixture/repository/source.ts"],
    fileHandle([source, source, source, replacement]),
    "Opened target identity changed during operation",
  );
  await expectSecureReadFailure(
    [directory, source],
    ["/fixture/repository/source.ts", "/outside/source.ts"],
    fileHandle([source, source, source, source]),
    "Opened target escaped repository root during operation",
  );
});

test("secure IO factory deterministically rejects read-size and post-operation snapshot races", async () => {
  const directory = pathStat(1n, 0n, "directory");
  const source = pathStat(2n);
  const replacement = pathStat(3n);

  await expectSecureReadFailure(
    [directory, source],
    ["/fixture/repository/source.ts"],
    fileHandle([source, source], "truncated"),
    "Source was truncated during secure read",
  );
  await expectSecureReadFailure(
    [directory, source],
    ["/fixture/repository/source.ts"],
    fileHandle([source, source, pathStat(2n, 2n)]),
    "Source size changed during secure read",
  );
  await expectSecureReadFailure(
    [directory, source, directory, missingPathError()],
    ["/fixture/repository/source.ts", "/fixture/repository/source.ts"],
    fileHandle([source, source, source, source]),
    "Target identity changed during secure operation",
  );
  await expectSecureReadFailure(
    [directory, source, directory, replacement],
    ["/fixture/repository/source.ts", "/fixture/repository/source.ts"],
    fileHandle([source, source, source, source]),
    "Target identity changed during secure operation",
  );
});
