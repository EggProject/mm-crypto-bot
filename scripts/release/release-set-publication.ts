import path from "node:path";

import {
  deriveReleaseSetDestination,
  releaseSetArchiveBasename,
  releaseSetCandidatePrefix,
  type ReleaseSetPrivateCandidate,
} from "./release-set-contract";
import { verifyReleaseSetArchive } from "./release-set-verifier";
import type { ReleaseFileSystemPort, ReleasePublicationFileSystemPort } from "./release-ports";

export interface ReleaseSetPublicationDependencies {
  readonly privateCandidateFileSystem: Pick<
    ReleaseFileSystemPort,
    "lstat" | "readFile" | "removePrivateDirectory"
  >;
  readonly publicationFileSystem: ReleasePublicationFileSystemPort;
}
export type ReleasePublicationOutcome =
  | { readonly kind: "published" }
  | { readonly kind: "published-cleanup-failed" }
  | { readonly kind: "destination-exists" }
  | { readonly kind: "cross-device" }
  | { readonly kind: "publication-failed" };

export async function publishReleaseSet(
  input: {
    readonly candidate: ReleaseSetPrivateCandidate;
    readonly privateRoot: string;
    readonly publicationRoot: string;
  },
  dependencies: ReleaseSetPublicationDependencies,
): Promise<ReleasePublicationOutcome> {
  if (!isValidCandidate(input.privateRoot, input.candidate)) return outcome("publication-failed");
  try {
    const status = await dependencies.privateCandidateFileSystem.lstat(input.candidate.archivePath);
    if (status.isSymbolicLink() || !status.isRegularFile())
      return await cleanup(input.candidate, dependencies, outcome("publication-failed"));
    const bytes = await dependencies.privateCandidateFileSystem.readFile(input.candidate.archivePath);
    await verifyReleaseSetArchive({ zipBytes: bytes });
    await dependencies.publicationFileSystem.link(
      input.candidate.archivePath,
      deriveReleaseSetDestination(input.publicationRoot),
    );
  } catch (error: unknown) {
    return await cleanup(input.candidate, dependencies, linkFailure(error));
  }
  return await cleanup(input.candidate, dependencies, outcome("published"));
}

function isValidCandidate(privateRoot: string, candidate: ReleaseSetPrivateCandidate): boolean {
  const directory = candidate.directory.path;
  const name = path.basename(directory);
  const fixedBasename = path.basename(path.join(".", releaseSetArchiveBasename));
  return (
    path.dirname(directory) === privateRoot &&
    name.startsWith(releaseSetCandidatePrefix) &&
    name.length > releaseSetCandidatePrefix.length &&
    candidate.basename === fixedBasename &&
    candidate.archivePath === path.join(directory, releaseSetArchiveBasename)
  );
}
async function cleanup(
  candidate: ReleaseSetPrivateCandidate,
  dependencies: ReleaseSetPublicationDependencies,
  result: ReleasePublicationOutcome,
): Promise<ReleasePublicationOutcome> {
  try {
    await dependencies.privateCandidateFileSystem.removePrivateDirectory(candidate.directory);
  } catch {
    return result.kind === "published" ? outcome("published-cleanup-failed") : result;
  }
  return result;
}
function linkFailure(error: unknown): ReleasePublicationOutcome {
  const code = nodeCode(error);
  if (code === "EEXIST") return outcome("destination-exists");
  if (code === "EXDEV") return outcome("cross-device");
  return outcome("publication-failed");
}
function outcome(kind: ReleasePublicationOutcome["kind"]): ReleasePublicationOutcome {
  return Object.freeze({ kind });
}
function nodeCode(error: unknown): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(new Object(error), "code");
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}
