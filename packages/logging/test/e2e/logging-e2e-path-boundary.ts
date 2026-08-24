import { lstatSync, realpathSync } from "node:fs";
import nodePath from "node:path";

type ExistingPathKind = "directory" | "file";

interface PathBoundaryPathMetadata {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface PathBoundaryFileSystem {
  readonly lstat: (path: string) => PathBoundaryPathMetadata;
  readonly realpath: (path: string) => string;
}

const nodePathBoundaryFileSystem: PathBoundaryFileSystem = {
  lstat: lstatSync,
  realpath: realpathSync,
};

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function assertPathIsContained(path: string, root: string, label: string): void {
  const pathFromRoot = nodePath.relative(root, path);
  if (
    pathFromRoot === ".." ||
    nodePath.isAbsolute(pathFromRoot) ||
    pathFromRoot.startsWith(`..${nodePath.sep}`)
  ) {
    throw new Error(`${label} is outside its approved root: ${path}.`);
  }
}

function assertPresentPathKind(
  metadata: PathBoundaryPathMetadata,
  path: string,
  expectedKind: ExistingPathKind,
  label: string,
): void {
  if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}.`);
  if (expectedKind === "directory" && !metadata.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}.`);
  }
  if (expectedKind === "file" && !metadata.isFile()) {
    throw new Error(`${label} must be a file: ${path}.`);
  }
}

export function createPathBoundaryChecks(fileSystem: PathBoundaryFileSystem): {
  readonly assertSafeDirectoryPathWithinRoot: (path: string, root: string, label: string) => string;
  readonly assertSafeExistingFileWithinRoot: (path: string, root: string, label: string) => string;
} {
  function lstatExistingPath(path: string, label: string): PathBoundaryPathMetadata {
    try {
      return fileSystem.lstat(path);
    } catch (error: unknown) {
      throw new Error(`Cannot inspect ${label}: ${path}.`, { cause: error });
    }
  }

  function lstatPathIfPresent(path: string, label: string): PathBoundaryPathMetadata | undefined {
    try {
      return fileSystem.lstat(path);
    } catch (error: unknown) {
      if (isMissingPathError(error)) return undefined;
      throw new Error(`Cannot inspect ${label}: ${path}.`, { cause: error });
    }
  }

  function assertExistingAncestorsAreSafe(path: string, label: string): void {
    const root = nodePath.parse(path).root;
    const ancestors = [root];
    for (let ancestor = nodePath.dirname(path); ancestor !== root; ancestor = nodePath.dirname(ancestor)) {
      ancestors.unshift(ancestor);
    }
    if (path !== root) ancestors.push(path);

    for (const ancestor of ancestors) {
      let metadata: PathBoundaryPathMetadata;
      try {
        metadata = fileSystem.lstat(ancestor);
      } catch (error: unknown) {
        if (isMissingPathError(error)) return;
        throw new Error(`Cannot inspect ${label} ancestor: ${ancestor}.`, { cause: error });
      }
      if (metadata.isSymbolicLink()) {
        throw new Error(`${label} must not contain a symbolic-link ancestor: ${ancestor}.`);
      }
      if (ancestor !== path && !metadata.isDirectory()) {
        throw new Error(`${label} has a non-directory ancestor: ${ancestor}.`);
      }
    }
  }

  function nearestExistingAncestor(path: string, label: string): string {
    for (let candidate = path; ; candidate = nodePath.dirname(candidate)) {
      try {
        fileSystem.lstat(candidate);
        return candidate;
      } catch (error: unknown) {
        if (!isMissingPathError(error)) {
          throw new Error(`Cannot inspect ${label} ancestor: ${candidate}.`, { cause: error });
        }
      }
    }
  }

  function canonicalPath(path: string, label: string): string {
    try {
      return fileSystem.realpath(path);
    } catch (error: unknown) {
      throw new Error(`Cannot canonicalize ${label}: ${path}.`, { cause: error });
    }
  }

  function assertApprovedRoot(
    root: string,
    label: string,
  ): { readonly canonicalRoot: string; readonly resolvedRoot: string } {
    const resolvedRoot = nodePath.resolve(root);
    assertExistingAncestorsAreSafe(resolvedRoot, `${label} root`);
    const metadata = lstatExistingPath(resolvedRoot, `${label} root`);
    if (!metadata.isDirectory()) {
      throw new Error(`${label} root must be an existing directory: ${resolvedRoot}.`);
    }
    return { canonicalRoot: canonicalPath(resolvedRoot, `${label} root`), resolvedRoot };
  }

  function assertSafePathWithinApprovedRoot(path: string, root: string, label: string): string {
    const { canonicalRoot, resolvedRoot } = assertApprovedRoot(root, label);
    const resolvedPath = nodePath.resolve(path);
    assertPathIsContained(resolvedPath, resolvedRoot, label);
    assertExistingAncestorsAreSafe(resolvedPath, label);
    const canonicalExistingAncestor = canonicalPath(nearestExistingAncestor(resolvedPath, label), label);
    assertPathIsContained(canonicalExistingAncestor, canonicalRoot, label);
    return resolvedPath;
  }

  function assertSafeDirectoryPathWithinRoot(path: string, root: string, label: string): string {
    const resolvedPath = assertSafePathWithinApprovedRoot(path, root, label);
    const metadata = lstatPathIfPresent(resolvedPath, label);
    if (metadata !== undefined) assertPresentPathKind(metadata, resolvedPath, "directory", label);
    return resolvedPath;
  }

  function assertSafeExistingFileWithinRoot(path: string, root: string, label: string): string {
    const resolvedPath = assertSafePathWithinApprovedRoot(path, root, label);
    assertPresentPathKind(lstatExistingPath(resolvedPath, label), resolvedPath, "file", label);
    const canonicalFile = canonicalPath(resolvedPath, label);
    const canonicalRoot = canonicalPath(nodePath.resolve(root), `${label} root`);
    assertPathIsContained(canonicalFile, canonicalRoot, label);
    return resolvedPath;
  }

  return {
    assertSafeDirectoryPathWithinRoot,
    assertSafeExistingFileWithinRoot,
  };
}

const nodePathBoundaryChecks = createPathBoundaryChecks(nodePathBoundaryFileSystem);

export const assertSafeDirectoryPathWithinRoot = nodePathBoundaryChecks.assertSafeDirectoryPathWithinRoot;
export const assertSafeExistingFileWithinRoot = nodePathBoundaryChecks.assertSafeExistingFileWithinRoot;
