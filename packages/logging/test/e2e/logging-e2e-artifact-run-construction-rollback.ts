// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact identity contract.
import type { ArtifactRunFileSystem, LoggingE2eArtifactIdentity } from "./logging-e2e-artifact-run.ts";

export interface ArtifactRunConstructionDirectory {
  readonly descriptor: number;
  readonly identity: LoggingE2eArtifactIdentity;
  readonly path: string;
}

export interface ArtifactRunConstructionRollbackOperations {
  readonly descriptorPath: (descriptor: number, child?: string) => string;
  readonly failIdentity: (path: string) => never;
  readonly fromDescriptor: (descriptor: number, type: "directory" | "file") => LoggingE2eArtifactIdentity;
  readonly fromPath: (path: string, type: "directory" | "file") => LoggingE2eArtifactIdentity;
  readonly isSame: (left: LoggingE2eArtifactIdentity, right: LoggingE2eArtifactIdentity) => boolean;
}

export interface ArtifactRunConstructionRollbackInput {
  readonly bundle: ArtifactRunConstructionDirectory | undefined;
  readonly fileSystem: ArtifactRunFileSystem;
  readonly operations: ArtifactRunConstructionRollbackOperations;
  readonly primary: unknown;
  readonly raw: ArtifactRunConstructionDirectory | undefined;
  readonly root: ArtifactRunConstructionDirectory | undefined;
  readonly freshRootName: string | undefined;
  readonly temporary: ArtifactRunConstructionDirectory;
}

interface AttemptResult {
  readonly completed: boolean;
}

function attempt(failures: unknown[], action: () => void): AttemptResult {
  try {
    action();
    return { completed: true };
  } catch (error: unknown) {
    failures.push(error);
    return { completed: false };
  }
}

// prettier-ignore -- Rollback order is a security invariant: bundle, raw, root, then temporary descriptor.
export function rollbackArtifactRunConstruction(input: ArtifactRunConstructionRollbackInput): never {
  const { bundle, fileSystem, freshRootName, operations, primary, raw, root, temporary } = input;
  const failures: unknown[] = [];
  const remove = (
    entry: ArtifactRunConstructionDirectory | undefined,
    parent: ArtifactRunConstructionDirectory,
    name: string,
  ): void => {
    if (entry === undefined) return;
    const verification = attempt(failures, () => {
      const path = operations.descriptorPath(parent.descriptor, name);
      if (
        !operations.isSame(entry.identity, operations.fromDescriptor(entry.descriptor, "directory")) ||
        !operations.isSame(parent.identity, operations.fromDescriptor(parent.descriptor, "directory")) ||
        !operations.isSame(entry.identity, operations.fromPath(path, "directory"))
      )
        operations.failIdentity(entry.path);
    });
    attempt(failures, () => {
      fileSystem.close(entry.descriptor);
    });
    if (verification.completed)
      attempt(failures, () => {
        fileSystem.rmdir(operations.descriptorPath(parent.descriptor, name));
      });
  };
  if (root !== undefined) {
    remove(bundle, root, "bundle");
    remove(raw, root, "raw");
    remove(root, temporary, fileSystem.basename(root.path));
  } else if (freshRootName !== undefined) {
    attempt(failures, () => {
      fileSystem.rmdir(operations.descriptorPath(temporary.descriptor, freshRootName));
    });
  }
  attempt(failures, () => {
    fileSystem.close(temporary.descriptor);
  });
  throw failures.length === 0
    ? primary
    : new AggregateError(
        [primary, ...failures],
        "Cannot safely roll back logging E2E artifact construction.",
      );
}
