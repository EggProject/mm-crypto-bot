import {
  createNodeArtifactRunFileSystem,
  type ArtifactRunFileSystem,
  type ArtifactRunPathMetadata,
} from "./logging-e2e-artifact-run.ts";

export type ArtifactRunFileSystemOverrides = Readonly<Partial<Omit<ArtifactRunFileSystem, "constants">>> & {
  readonly constants?: Readonly<Partial<ArtifactRunFileSystem["constants"]>>;
};

export type ArtifactPathKind = "directory" | "file" | "symlink" | "other";

export class TestArtifactFileSystemError extends Error {
  public constructor(public readonly code: string) {
    super(`Test artifact filesystem error: ${code}`);
    this.name = "TestArtifactFileSystemError";
  }
}

export function artifactPathMetadata(
  kind: ArtifactPathKind,
  device = 1n,
  inode = 1n,
): ArtifactRunPathMetadata {
  return {
    dev: device,
    ino: inode,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  };
}

export function createArtifactRunFileSystem(
  overrides: ArtifactRunFileSystemOverrides = {},
): ArtifactRunFileSystem {
  const nodeFileSystem = createNodeArtifactRunFileSystem();

  return Object.freeze({
    ...nodeFileSystem,
    ...overrides,
    constants: {
      ...nodeFileSystem.constants,
      ...overrides.constants,
    },
  });
}
