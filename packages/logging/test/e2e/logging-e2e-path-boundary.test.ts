import { describe, expect, it } from "vitest";

import { createPathBoundaryChecks, type PathBoundaryFileSystem } from "./logging-e2e-path-boundary.ts";

const LABEL = "Path boundary test";
const ROOT = "/approved";
const CANONICAL_ROOT = "/canonical/approved";
const FILE = `${ROOT}/record.json`;
const DIRECTORY = `${ROOT}/directory`;

type PathKind = "directory" | "file" | "symbolic-link";
type LstatOutcome = PathKind | Error;
type RealpathOutcome = string | Error;

class FakeFileSystemError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(`Fake filesystem error: ${code}`);
    this.code = code;
  }
}

class DeterministicPathBoundaryFileSystem implements PathBoundaryFileSystem {
  readonly #lstatOutcomeOffsets = new Map<string, number>();

  public constructor(
    private readonly lstatOutcomes: ReadonlyMap<string, readonly LstatOutcome[]>,
    private readonly realpathOutcomes: ReadonlyMap<string, RealpathOutcome>,
  ) {}

  public lstat(path: string): PathBoundaryPathMetadata {
    const outcomes = this.lstatOutcomes.get(path);
    if (outcomes === undefined) throw new FakeFileSystemError("ENOENT");
    const offset = this.#lstatOutcomeOffsets.get(path) ?? 0;
    const outcome = outcomes[Math.min(offset, outcomes.length - 1)];
    this.#lstatOutcomeOffsets.set(path, offset + 1);
    if (outcome instanceof Error) throw outcome;
    if (outcome === undefined) throw new Error(`No lstat response configured for ${path}.`);
    return createPathMetadata(outcome);
  }

  public realpath(path: string): string {
    const outcome = this.realpathOutcomes.get(path);
    if (outcome === undefined) throw new FakeFileSystemError("ENOENT");
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

interface PathBoundaryPathMetadata {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

function createPathMetadata(kind: PathKind): PathBoundaryPathMetadata {
  return {
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symbolic-link",
  };
}

function createFileSystem(
  lstatOutcomes: ReadonlyMap<string, readonly LstatOutcome[]> = new Map([
    ["/", ["directory"]],
    [ROOT, ["directory"]],
    [FILE, ["file"]],
    [DIRECTORY, ["directory"]],
  ]),
  realpathOutcomes: ReadonlyMap<string, RealpathOutcome> = new Map([
    [ROOT, CANONICAL_ROOT],
    [FILE, `${CANONICAL_ROOT}/record.json`],
    [DIRECTORY, `${CANONICAL_ROOT}/directory`],
  ]),
): DeterministicPathBoundaryFileSystem {
  return new DeterministicPathBoundaryFileSystem(lstatOutcomes, realpathOutcomes);
}

function createChecks(
  lstatOutcomes?: ReadonlyMap<string, readonly LstatOutcome[]>,
  realpathOutcomes?: ReadonlyMap<string, RealpathOutcome>,
) {
  return createPathBoundaryChecks(createFileSystem(lstatOutcomes, realpathOutcomes));
}

describe("logging E2E path boundary", () => {
  it("accepts normal files, directories, and absent directories", () => {
    const checks = createChecks();

    expect(checks.assertSafeExistingFileWithinRoot(FILE, ROOT, LABEL)).toBe(FILE);
    expect(checks.assertSafeDirectoryPathWithinRoot(DIRECTORY, ROOT, LABEL)).toBe(DIRECTORY);
    expect(checks.assertSafeDirectoryPathWithinRoot(`${ROOT}/missing-directory`, ROOT, LABEL)).toBe(
      `${ROOT}/missing-directory`,
    );

    const rootChecks = createChecks(new Map([["/", ["directory"]]]), new Map([["/", "/"]]));
    expect(rootChecks.assertSafeDirectoryPathWithinRoot("/", "/", LABEL)).toBe("/");
  });

  it("rejects a final symbolic link and symbolic-link ancestor", () => {
    const finalLink = `${ROOT}/record-link.json`;
    const ancestorLink = `${ROOT}/linked-directory`;
    const checks = createChecks(
      new Map([
        ["/", ["directory"]],
        [ROOT, ["directory"]],
        [finalLink, ["symbolic-link"]],
        [ancestorLink, ["symbolic-link"]],
      ]),
    );

    expect(() => checks.assertSafeDirectoryPathWithinRoot(finalLink, ROOT, LABEL)).toThrow(
      "must not contain a symbolic-link ancestor",
    );
    expect(() => checks.assertSafeDirectoryPathWithinRoot(`${ancestorLink}/directory`, ROOT, LABEL)).toThrow(
      "must not contain a symbolic-link ancestor",
    );
  });

  it("rejects final lstat symbolic-link replacement after ancestor validation", () => {
    const checks = createChecks(
      new Map([
        ["/", ["directory"]],
        [ROOT, ["directory"]],
        [FILE, ["file", "file", "symbolic-link"]],
      ]),
    );

    expect(() => checks.assertSafeExistingFileWithinRoot(FILE, ROOT, LABEL)).toThrow(
      "must not be a symbolic link",
    );
  });

  it("rejects paths outside the approved root", () => {
    const checks = createChecks();

    expect(() => checks.assertSafeDirectoryPathWithinRoot("/outside-directory", ROOT, LABEL)).toThrow(
      "is outside its approved root",
    );
    expect(() =>
      checks.assertSafeDirectoryPathWithinRoot(`${ROOT}/../outside-directory`, ROOT, LABEL),
    ).toThrow("is outside its approved root");
    expect(() => checks.assertSafeDirectoryPathWithinRoot("/approval", ROOT, LABEL)).toThrow(
      "is outside its approved root",
    );
  });

  it("rejects non-directory ancestors and incompatible path kinds", () => {
    const nonDirectoryAncestor = `${ROOT}/not-a-directory`;
    const checks = createChecks(
      new Map([
        ["/", ["directory"]],
        [ROOT, ["directory"]],
        [FILE, ["file"]],
        [DIRECTORY, ["directory"]],
        [nonDirectoryAncestor, ["file"]],
      ]),
    );

    expect(() =>
      checks.assertSafeDirectoryPathWithinRoot(`${nonDirectoryAncestor}/child`, ROOT, LABEL),
    ).toThrow("has a non-directory ancestor");
    expect(() => checks.assertSafeDirectoryPathWithinRoot(FILE, ROOT, LABEL)).toThrow("must be a directory");
    expect(() => checks.assertSafeExistingFileWithinRoot(DIRECTORY, ROOT, LABEL)).toThrow("must be a file");
  });

  it("rejects missing and non-directory approved roots", () => {
    const missingRoot = "/missing-root";
    const fileRoot = "/file-root";
    const missingChecks = createChecks(new Map([["/", ["directory"]]]));
    const fileRootChecks = createChecks(
      new Map([
        ["/", ["directory"]],
        [fileRoot, ["file"]],
      ]),
    );

    expect(() =>
      missingChecks.assertSafeDirectoryPathWithinRoot(`${missingRoot}/directory`, missingRoot, LABEL),
    ).toThrow("Cannot inspect Path boundary test root");
    expect(() =>
      fileRootChecks.assertSafeDirectoryPathWithinRoot(`${fileRoot}/directory`, fileRoot, LABEL),
    ).toThrow("root must be an existing directory");
  });

  it("rejects non-ENOENT final and ancestor lstat errors", () => {
    const checksWithFinalError = createChecks(
      new Map([
        ["/", ["directory"]],
        [ROOT, ["directory"]],
        [FILE, ["file", "file", new FakeFileSystemError("EACCES")]],
      ]),
    );
    const checksWithAncestorError = createChecks(
      new Map([
        ["/", ["directory"]],
        [ROOT, ["directory"]],
        [`${ROOT}/blocked`, [new FakeFileSystemError("EACCES")]],
      ]),
    );
    const checksWithFinalDirectoryError = createChecks(
      new Map([
        ["/", ["directory"]],
        [ROOT, ["directory"]],
        [DIRECTORY, ["directory", "directory", new FakeFileSystemError("EACCES")]],
      ]),
    );
    const checksWithNearestAncestorError = createChecks(
      new Map([
        ["/", ["directory"]],
        [ROOT, ["directory"]],
        [`${ROOT}/missing/blocked`, [new FakeFileSystemError("EACCES")]],
      ]),
    );

    expect(() => checksWithFinalError.assertSafeExistingFileWithinRoot(FILE, ROOT, LABEL)).toThrow(
      "Cannot inspect Path boundary test",
    );
    expect(() =>
      checksWithAncestorError.assertSafeDirectoryPathWithinRoot(`${ROOT}/blocked/directory`, ROOT, LABEL),
    ).toThrow("Cannot inspect Path boundary test ancestor");
    expect(() =>
      checksWithFinalDirectoryError.assertSafeDirectoryPathWithinRoot(DIRECTORY, ROOT, LABEL),
    ).toThrow("Cannot inspect Path boundary test");
    expect(() =>
      checksWithNearestAncestorError.assertSafeDirectoryPathWithinRoot(
        `${ROOT}/missing/blocked/directory`,
        ROOT,
        LABEL,
      ),
    ).toThrow("Cannot inspect Path boundary test ancestor");
  });

  it("rejects realpath failures and canonical targets outside the root", () => {
    const finalRealpathErrorChecks = createChecks(
      undefined,
      new Map<string, RealpathOutcome>([
        [ROOT, CANONICAL_ROOT],
        [FILE, new FakeFileSystemError("EIO")],
        [DIRECTORY, `${CANONICAL_ROOT}/directory`],
      ]),
    );
    const nearestParentRealpathErrorChecks = createChecks(
      undefined,
      new Map<string, RealpathOutcome>([
        [ROOT, new FakeFileSystemError("EIO")],
        [FILE, `${CANONICAL_ROOT}/record.json`],
        [DIRECTORY, `${CANONICAL_ROOT}/directory`],
      ]),
    );
    const outsideCanonicalChecks = createChecks(
      undefined,
      new Map([
        [ROOT, CANONICAL_ROOT],
        [FILE, "/canonical/outside/record.json"],
        [DIRECTORY, `${CANONICAL_ROOT}/directory`],
      ]),
    );

    expect(() => finalRealpathErrorChecks.assertSafeExistingFileWithinRoot(FILE, ROOT, LABEL)).toThrow(
      "Cannot canonicalize Path boundary test",
    );
    expect(() =>
      nearestParentRealpathErrorChecks.assertSafeDirectoryPathWithinRoot(
        `${ROOT}/missing/directory`,
        ROOT,
        LABEL,
      ),
    ).toThrow("Cannot canonicalize Path boundary test root");
    expect(() => outsideCanonicalChecks.assertSafeExistingFileWithinRoot(FILE, ROOT, LABEL)).toThrow(
      "is outside its approved root",
    );
  });
});
