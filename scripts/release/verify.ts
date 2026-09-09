import { fileURLToPath } from "node:url";

import {
  runReleaseVerifyCli,
  type ReleaseArtifactReadPort,
  type ReleaseVerificationOutput,
} from "./release-artifact-verifier";

export interface ReleaseVerifyEntrypointDependencies {
  readonly exitCodeTarget: { exitCode: number | string | null | undefined };
  readonly isMain: boolean;
  readonly runCommand: () => Promise<0 | 1 | 2>;
}

export const nodeReleaseArtifactReadPort: ReleaseArtifactReadPort = Object.freeze({
  lstat: async (artifactPath: string) => {
    const nodeFileSystem = await import("node:fs/promises");
    const metadata = await nodeFileSystem.lstat(artifactPath);
    return Object.freeze({
      isRegularFile: (): boolean => metadata.isFile(),
      isSymbolicLink: (): boolean => metadata.isSymbolicLink(),
    });
  },
  readFile: async (artifactPath: string): Promise<Uint8Array> => {
    const nodeFileSystem = await import("node:fs/promises");
    return new Uint8Array(await nodeFileSystem.readFile(artifactPath));
  },
});

export async function runReleaseVerifyEntrypoint(
  dependencies: ReleaseVerifyEntrypointDependencies,
): Promise<number | string | null | undefined> {
  if (!dependencies.isMain) return dependencies.exitCodeTarget.exitCode;
  dependencies.exitCodeTarget.exitCode = await dependencies.runCommand();
  return dependencies.exitCodeTarget.exitCode;
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const output: ReleaseVerificationOutput = Object.freeze({
  writeStderr: process.stderr.write.bind(process.stderr),
  writeStdout: process.stdout.write.bind(process.stdout),
});

process.exitCode = await runReleaseVerifyEntrypoint({
  exitCodeTarget: process,
  isMain: import.meta.main,
  runCommand: runReleaseVerifyCli.bind(
    undefined,
    process.argv.slice(2),
    { fileSystem: nodeReleaseArtifactReadPort, repositoryRoot: repoRoot },
    output,
  ),
});
