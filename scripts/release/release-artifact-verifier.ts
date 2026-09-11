import { deriveReleaseSetDestination, type ReleaseSetManifestV1 } from "./release-set-contract";
import { verifyReleaseSetArchive } from "./release-set-verifier";

export interface ReleaseArtifactReadPort {
  lstat(
    path: string,
  ): Promise<{ readonly isRegularFile: () => boolean; readonly isSymbolicLink: () => boolean }>;
  readFile(path: string): Promise<Uint8Array>;
}
export interface ReleaseArtifactVerificationDependencies {
  readonly fileSystem: ReleaseArtifactReadPort;
  readonly repositoryRoot: string;
}
export interface ReleaseVerificationOutput {
  readonly writeStderr: (text: string) => void;
  readonly writeStdout: (text: string) => void;
}

export async function verifyPublishedReleaseSet(
  dependencies: ReleaseArtifactVerificationDependencies,
): Promise<ReleaseSetManifestV1> {
  const archive = deriveReleaseSetDestination(dependencies.repositoryRoot);
  try {
    const status = await dependencies.fileSystem.lstat(archive);
    if (status.isSymbolicLink() || !status.isRegularFile()) throw new Error("not regular");
    const bytes = await dependencies.fileSystem.readFile(archive);
    const verified = await verifyReleaseSetArchive({ zipBytes: bytes });
    return verified.manifest;
  } catch {
    throw new Error("release set archive is invalid");
  }
}

export async function runReleaseVerifyCli(
  argv: readonly string[],
  dependencies: ReleaseArtifactVerificationDependencies,
  output: ReleaseVerificationOutput,
): Promise<0 | 1 | 2> {
  if (argv.length > 0) {
    output.writeStderr("release verification accepts no arguments\n");
    return 2;
  }
  try {
    await verifyPublishedReleaseSet(dependencies);
    return 0;
  } catch {
    output.writeStderr("release verification failed: release set archive is invalid\n");
    return 1;
  }
}
