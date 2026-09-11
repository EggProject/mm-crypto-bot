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

type PublicationSnapshot = Readonly<{
  archivePath: string;
  destination: string;
  directory: ReleaseSetPrivateCandidate["directory"];
}>;

export async function publishReleaseSet(
  input: {
    readonly candidate: ReleaseSetPrivateCandidate;
    readonly privateRoot: string;
    readonly publicationRoot: string;
  },
  dependencies: ReleaseSetPublicationDependencies,
): Promise<ReleasePublicationOutcome> {
  const snapshot = snapshotPublicationInput(input);
  if (snapshot === undefined) return outcome("publication-failed");
  try {
    const status = await dependencies.privateCandidateFileSystem.lstat(snapshot.archivePath);
    if (status.isSymbolicLink() || !status.isRegularFile())
      return await cleanup(snapshot.directory, dependencies, outcome("publication-failed"));
    const bytes = await dependencies.privateCandidateFileSystem.readFile(snapshot.archivePath);
    await verifyReleaseSetArchive({ zipBytes: bytes });
    await dependencies.publicationFileSystem.link(snapshot.archivePath, snapshot.destination);
  } catch (error: unknown) {
    return await cleanup(snapshot.directory, dependencies, linkFailure(error));
  }
  return await cleanup(snapshot.directory, dependencies, outcome("published"));
}

function snapshotPublicationInput(input: unknown): PublicationSnapshot | undefined {
  try {
    const privateRoot = ownString(input, "privateRoot");
    const publicationRoot = ownString(input, "publicationRoot");
    const candidate = ownObject(input, "candidate");
    if (privateRoot === undefined || publicationRoot === undefined || candidate === undefined)
      return undefined;
    const archivePath = ownString(candidate, "archivePath");
    const basename = ownString(candidate, "basename");
    const directory = ownObject(candidate, "directory");
    if (archivePath === undefined || basename === undefined || directory === undefined) return undefined;
    const directoryPath = ownString(directory, "path");
    if (directoryPath === undefined || !isValidCandidate(privateRoot, directoryPath, basename, archivePath))
      return undefined;
    return Object.freeze({
      archivePath,
      destination: deriveReleaseSetDestination(publicationRoot),
      directory: Object.freeze({ path: directoryPath }),
    });
  } catch {
    return undefined;
  }
}
function ownString(value: unknown, key: PropertyKey): string | undefined {
  const property = ownDataValue(value, key);
  return typeof property === "string" ? property : undefined;
}
function ownObject(value: unknown, key: PropertyKey): object | undefined {
  const property = ownDataValue(value, key);
  return isObject(property) ? property : undefined;
}
function ownDataValue(value: unknown, key: PropertyKey): unknown {
  if (!isObject(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}
function isObject(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}
function isValidCandidate(
  privateRoot: string,
  directory: string,
  basename: string,
  archivePath: string,
): boolean {
  const name = path.basename(directory);
  return (
    path.dirname(directory) === privateRoot &&
    name.startsWith(releaseSetCandidatePrefix) &&
    name.length > releaseSetCandidatePrefix.length &&
    basename === releaseSetArchiveBasename &&
    archivePath === path.join(directory, releaseSetArchiveBasename)
  );
}
async function cleanup(
  directory: ReleaseSetPrivateCandidate["directory"],
  dependencies: ReleaseSetPublicationDependencies,
  result: ReleasePublicationOutcome,
): Promise<ReleasePublicationOutcome> {
  try {
    await dependencies.privateCandidateFileSystem.removePrivateDirectory(directory);
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
  try {
    const descriptor = Object.getOwnPropertyDescriptor(new Object(error), "code");
    return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}
