import path from "node:path";

import {
  releaseApplications as releaseApps,
  releaseTarget,
  releaseVersion,
  type ReleaseApplication as ReleaseApp,
  type ReleaseManifestV1,
} from "./release-contract";
import { verifyReleaseArchive } from "./release-verifier";

export interface ReleaseArtifactReadPort {
  lstat(path: string): Promise<{
    readonly isRegularFile: () => boolean;
    readonly isSymbolicLink: () => boolean;
  }>;
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

type ArtifactKind = "SHA-256 sidecar" | "ZIP archive";
type ArtifactReadFailure = "missing" | "not a regular file" | "unavailable" | "unreadable";
type VerificationFailureMessage =
  | "release application is invalid"
  | `release ${ReleaseApp} ${ArtifactKind} is ${ArtifactReadFailure}`
  | `release ${ReleaseApp} archive is invalid`;

interface ArtifactPaths {
  readonly sidecarPath: string;
  readonly zipPath: string;
}

interface VerificationFailure {
  readonly cause: unknown;
  readonly kind: "failure";
  readonly message: VerificationFailureMessage;
}

interface VerificationSuccess<Value> {
  readonly kind: "success";
  readonly value: Value;
}

type VerificationResult<Value> = VerificationFailure | VerificationSuccess<Value>;

export async function verifyExistingReleaseArchive(
  dependencies: ReleaseArtifactVerificationDependencies,
  app: unknown,
): Promise<ReleaseManifestV1> {
  const result = await verifyExistingReleaseArchiveResult(dependencies, app);
  if (result.kind === "failure") throwVerificationFailure(result);
  return result.value;
}

export async function verifyAllReleaseArchives(
  dependencies: ReleaseArtifactVerificationDependencies,
): Promise<readonly ReleaseManifestV1[]> {
  const result = await verifyAllReleaseArchivesResult(dependencies);
  if (result.kind === "failure") throwVerificationFailure(result);
  return result.value;
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
  const result = await verifyAllReleaseArchivesResult(dependencies);
  if (result.kind === "success") return 0;
  output.writeStderr(`release verification failed: ${result.message}\n`);
  return 1;
}

async function verifyExistingReleaseArchiveResult(
  dependencies: ReleaseArtifactVerificationDependencies,
  app: unknown,
): Promise<VerificationResult<ReleaseManifestV1>> {
  if (!isReleaseApp(app)) return verificationFailure("release application is invalid", undefined);
  const paths = artifactPaths(dependencies.repositoryRoot, app);
  const zipResult = await readArtifact(dependencies.fileSystem, paths.zipPath, app, "ZIP archive");
  if (zipResult.kind === "failure") return zipResult;
  const sidecarResult = await readArtifact(
    dependencies.fileSystem,
    paths.sidecarPath,
    app,
    "SHA-256 sidecar",
  );
  if (sidecarResult.kind === "failure") return sidecarResult;
  try {
    const input = {
      sidecarBytes: new Uint8Array(sidecarResult.value),
      zipBasename: zipBasename(app),
      zipBytes: new Uint8Array(zipResult.value),
    };
    const manifest = await verifyReleaseArchive(input);
    return verificationSuccess(freezeManifest(manifest));
  } catch (error: unknown) {
    return verificationFailure(`release ${app} archive is invalid`, error);
  }
}

async function verifyAllReleaseArchivesResult(
  dependencies: ReleaseArtifactVerificationDependencies,
): Promise<VerificationResult<readonly ReleaseManifestV1[]>> {
  const manifests: ReleaseManifestV1[] = [];
  for (const app of releaseApps) {
    const result = await verifyExistingReleaseArchiveResult(dependencies, app);
    if (result.kind === "failure") return result;
    manifests.push(result.value);
  }
  return verificationSuccess(Object.freeze(manifests));
}

function artifactPaths(repoRoot: string, app: ReleaseApp): ArtifactPaths {
  const directory = path.join(repoRoot, "releases", app, releaseVersion, releaseTarget);
  const basename = zipBasename(app);
  return Object.freeze({
    sidecarPath: path.join(directory, `${basename}.sha256`),
    zipPath: path.join(directory, basename),
  });
}

async function readArtifact(
  fileSystem: ReleaseArtifactReadPort,
  artifactPath: string,
  app: ReleaseApp,
  artifactKind: ArtifactKind,
): Promise<VerificationResult<Uint8Array>> {
  let status: Awaited<ReturnType<ReleaseArtifactReadPort["lstat"]>>;
  try {
    status = await fileSystem.lstat(artifactPath);
  } catch (error: unknown) {
    const reason = isNodeEnoent(error) ? "missing" : "unavailable";
    return verificationFailure(`release ${app} ${artifactKind} is ${reason}`, error);
  }
  try {
    if (status.isSymbolicLink() || !status.isRegularFile()) {
      return verificationFailure(`release ${app} ${artifactKind} is not a regular file`, undefined);
    }
  } catch (error: unknown) {
    return verificationFailure(`release ${app} ${artifactKind} is unavailable`, error);
  }
  try {
    return verificationSuccess(new Uint8Array(await fileSystem.readFile(artifactPath)));
  } catch (error: unknown) {
    return verificationFailure(`release ${app} ${artifactKind} is unreadable`, error);
  }
}

function throwVerificationFailure(failure: VerificationFailure): never {
  throw new Error(failure.message, { cause: failure.cause });
}

function verificationFailure(message: VerificationFailureMessage, cause: unknown): VerificationFailure {
  return Object.freeze({ cause, kind: "failure", message });
}

function verificationSuccess<Value>(value: Value): VerificationSuccess<Value> {
  return Object.freeze({ kind: "success", value });
}

function freezeManifest(manifest: ReleaseManifestV1): ReleaseManifestV1 {
  return Object.freeze({
    ...manifest,
    configuration: Object.freeze({ ...manifest.configuration }),
    payloads: Object.freeze(manifest.payloads.map((payload) => Object.freeze({ ...payload }))),
    target: Object.freeze({ ...manifest.target }),
    toolchain: Object.freeze({ ...manifest.toolchain }),
  });
}

function isNodeEnoent(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined && "value" in descriptor && descriptor.value === "ENOENT";
}

function isReleaseApp(value: unknown): value is ReleaseApp {
  return value === "bot" || value === "config-search";
}

function zipBasename(app: ReleaseApp): string {
  return `mm-crypto-bot-${app}-${releaseVersion}-${releaseTarget}.zip`;
}
