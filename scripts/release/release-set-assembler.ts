import path from "node:path";

import {
  releaseSetArchiveBasename,
  releaseSetCandidatePrefix,
  type ReleaseSetInput,
  type ReleaseSetPrivateCandidate,
} from "./release-set-contract";
import type { ReleaseDependencies } from "./release-ports";
import { verifyReleaseArchive } from "./release-verifier";
import { encodeReleaseSetZip } from "./release-set-zip";

export async function assembleReleaseSetCandidate(
  dependencies: ReleaseDependencies,
  inputs: readonly ReleaseSetInput[],
): Promise<ReleaseSetPrivateCandidate> {
  for (const input of inputs) {
    await verifyReleaseArchive({
      sidecarBytes: input.sidecarBytes,
      zipBasename: `mm-crypto-bot-${input.application}-0.1.0-bun-linux-x64.zip`,
      zipBytes: input.zipBytes,
    });
  }
  const directory = await dependencies.fileSystem.mkdtemp({
    parentDirectory: dependencies.temporaryRoot,
    prefix: releaseSetCandidatePrefix,
  });
  if (!isExpectedDirectory(dependencies.temporaryRoot, directory.path))
    throw new Error("release-set candidate directory escapes private root");
  const archive = encodeReleaseSetZip(inputs);
  const archivePath = path.join(directory.path, releaseSetArchiveBasename);
  try {
    await dependencies.fileSystem.writeFile(archivePath, archive.zipBytes, 0o644);
    return Object.freeze({
      archivePath,
      basename: releaseSetArchiveBasename,
      directory,
      manifest: archive.manifest,
    });
  } catch (error: unknown) {
    try {
      await dependencies.fileSystem.removePrivateDirectory(directory);
    } catch {
      throw new Error("release-set private candidate cleanup failed");
    }
    throw error;
  }
}

function isExpectedDirectory(root: string, directory: string): boolean {
  const base = path.basename(directory);
  return (
    path.dirname(directory) === root &&
    base.startsWith(releaseSetCandidatePrefix) &&
    base.length > releaseSetCandidatePrefix.length
  );
}
