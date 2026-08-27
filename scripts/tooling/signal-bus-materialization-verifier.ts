import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type CanonicalDigest,
  type CanonicalMaterializationRecord,
  type MaterializationRole,
  type SignalBusMaterializationEntry,
  type SignalBusMaterializationManifestV1,
  type VerificationDiagnostic,
  VerificationFailure,
  createCanonicalDigest,
  isWithinMaterializationLineLimit,
  parseMaterializationManifest,
} from "./signal-bus-materialization-contract";
import {
  type SignalBusMaterializationGitPort,
  collectCandidateMaterialization,
  collectCommitMaterializationDetail,
  hasPorcelainStatusChanges,
  nodeSignalBusMaterializationPort,
  readCommitTreeText,
  validateStrictGovernedText,
} from "./signal-bus-materialization-git";

export interface SignalBusMaterializationVerificationRequest {
  readonly mode: "baseline" | "candidate" | "history";
  readonly toolchainRoot: string;
  readonly candidateRoot: string;
  readonly manifestPath: string;
  readonly role: MaterializationRole;
  readonly brief?: string;
  readonly base?: string;
  readonly approval?: string;
}

export interface SignalBusMaterializationVerificationResult {
  readonly status: "pass" | "fail";
  readonly mode: SignalBusMaterializationVerificationRequest["mode"];
  readonly digest?: CanonicalDigest;
  readonly diagnostics: readonly VerificationDiagnostic[];
}

const commitPattern = /^[a-f0-9]{40}$/u;
const trailerKeys = [
  ["brief", "Signal-Bus-Materialization-Brief"],
  ["owner", "Signal-Bus-Materialization-Owner"],
  ["digest", "Signal-Bus-Materialization-Digest"],
] as const;
interface Trailers {
  readonly brief: string;
  readonly owner: string;
  readonly digest: string;
}

interface ParsedTrailers {
  readonly trailer?: Trailers;
  readonly hasReservedTrailer: boolean;
}

type SingleTrailerValues = readonly [readonly [string], readonly [string], readonly [string]];

function fail(code: string): never {
  throw new VerificationFailure(code, `signal-bus-materialization:${code}`);
}

function isBelow(root: string, candidatePath: string): boolean {
  const result = path.relative(root, candidatePath);
  return result !== "" && !result.startsWith("../") && result !== "..";
}

async function runText(
  port: SignalBusMaterializationGitPort,
  root: string,
  arguments_: readonly string[],
  input?: Uint8Array,
): Promise<string> {
  const result = await port.run(root, arguments_, input);
  if (result.exitCode !== 0) fail("git-command");
  return new TextDecoder("utf-8", { fatal: true }).decode(result.stdout).trim();
}

async function verifyRepoRoots(
  port: SignalBusMaterializationGitPort,
  request: SignalBusMaterializationVerificationRequest,
): Promise<{
  readonly toolchainRoot: string;
  readonly candidateRoot: string;
  readonly manifestPath: string;
}> {
  const [toolchainRoot, candidateRoot, manifestPath] = await Promise.all([
    port.canonicalize(request.toolchainRoot),
    port.canonicalize(request.candidateRoot),
    port.canonicalize(request.manifestPath),
  ]);
  if (
    toolchainRoot === candidateRoot ||
    isBelow(toolchainRoot, manifestPath) ||
    isBelow(candidateRoot, manifestPath)
  )
    fail("manifest-location");
  if (
    (await runText(port, toolchainRoot, ["rev-parse", "--show-toplevel"])) !== toolchainRoot ||
    (await runText(port, candidateRoot, ["rev-parse", "--show-toplevel"])) !== candidateRoot
  )
    fail("git-root");
  const runtimeSource = await port.canonicalize(fileURLToPath(import.meta.url));
  if (!isBelow(toolchainRoot, runtimeSource)) fail("toolchain-source");
  const source = await port.snapshot(runtimeSource);
  if (!source.isStable || !source.exists || !source.isRegularFile) fail("toolchain-source");
  return { toolchainRoot, candidateRoot, manifestPath };
}

async function immutableManifest(
  port: SignalBusMaterializationGitPort,
  path: string,
  role: MaterializationRole,
): Promise<SignalBusMaterializationManifestV1> {
  const manifest = await port.snapshot(path);
  if (!manifest.isStable || !manifest.exists || !manifest.isRegularFile) fail("manifest-file");
  if (manifest.governedText === undefined) fail("governed-text");
  return parseMaterializationManifest(manifest.governedText, role);
}

function selectedEntries(
  manifest: SignalBusMaterializationManifestV1,
  requestedBrief: string | undefined,
): readonly SignalBusMaterializationEntry[] {
  const briefs = new Set(manifest.materializations.map((entry) => entry.brief));
  const onlyEntry = manifest.materializations[0];
  if (requestedBrief === undefined && (onlyEntry === undefined || briefs.size !== 1)) fail("brief-required");
  const selected =
    requestedBrief === undefined
      ? manifest.materializations
      : manifest.materializations.filter((entry) => entry.brief === requestedBrief);
  if (selected.length === 0) fail("brief-unknown");
  return selected;
}

async function verifyBase(
  port: SignalBusMaterializationGitPort,
  root: string,
  base: string,
  requiresHeadEqual: boolean,
): Promise<void> {
  if (!commitPattern.test(base)) fail("base-format");
  await runText(port, root, ["cat-file", "-e", base + "^{commit}"]);
  const head = await runText(port, root, ["rev-parse", "HEAD"]);
  const ancestry = await port.run(root, ["merge-base", "--is-ancestor", base, "HEAD"]);
  if (requiresHeadEqual ? head !== base : ancestry.exitCode !== 0) fail("base-ancestry");
}

function operationFor(entry: SignalBusMaterializationEntry): CanonicalMaterializationRecord["operation"] {
  return entry.allowedOperation === "create" ? "A" : entry.allowedOperation === "modify" ? "M" : "D";
}

function physicalLineCount(text: string): number {
  return text.length === 0 ? 0 : text.split(/\r\n|\n|\r/u).length - (/(\r\n|\n|\r)$/u.test(text) ? 1 : 0);
}

async function ensureLineLimit(
  port: SignalBusMaterializationGitPort,
  root: string,
  entries: readonly SignalBusMaterializationEntry[],
): Promise<void> {
  for (const entry of entries) {
    const info = await port.snapshot(`${root}/${entry.path}`);
    if (!info.exists) continue;
    if (!info.isStable || !info.isRegularFile) fail("governed-non-regular");
    if (info.governedText === undefined || info.lineCount === undefined) fail("governed-text");
    if (!isWithinMaterializationLineLimit(info.lineCount)) fail("line-limit");
  }
}

async function ensureTreeText(
  port: SignalBusMaterializationGitPort,
  root: string,
  commit: string,
  entries: readonly SignalBusMaterializationEntry[],
): Promise<void> {
  for (const entry of entries) {
    const bytes = await readCommitTreeText(port, root, commit, entry.path);
    if (bytes === undefined) continue;
    const text = validateStrictGovernedText(bytes);
    if (!isWithinMaterializationLineLimit(physicalLineCount(text))) fail("line-limit");
  }
}

async function verifyBaseline(
  port: SignalBusMaterializationGitPort,
  root: string,
  base: string,
  entries: readonly SignalBusMaterializationEntry[],
): Promise<void> {
  await verifyBase(port, root, base, true);
  const status = await port.run(root, ["status", "--porcelain=v1", "-z"]);
  if (status.exitCode !== 0) fail("git-command");
  if (hasPorcelainStatusChanges(status.stdout)) fail("baseline-not-clean");
  for (const entry of entries) {
    const info = await port.inspect(`${root}/${entry.path}`);
    if (entry.allowedOperation === "create" ? info.exists : !info.exists || !info.isRegularFile)
      fail("baseline-state");
  }
  await ensureLineLimit(port, root, entries);
}

async function verifyCandidate(
  port: SignalBusMaterializationGitPort,
  root: string,
  base: string,
  entries: readonly SignalBusMaterializationEntry[],
): Promise<CanonicalDigest> {
  await verifyBase(port, root, base, false);
  const records = await collectCandidateMaterialization(port, root, base);
  const expected = new Map(entries.map((entry) => [entry.path, entry]));
  const hasUnexpectedRecord = records.some((record) => {
    const entry = expected.get(record.path);
    return entry === undefined || operationFor(entry) !== record.operation;
  });
  if (records.length === 0 || records.length !== expected.size) fail("candidate-bijection");
  if (hasUnexpectedRecord) fail("candidate-bijection");
  return createCanonicalDigest(records).value;
}

function trailers(values: SingleTrailerValues): Trailers {
  return Object.freeze({
    brief: values[0][0].slice(trailerKeys[0][1].length + 2),
    owner: values[1][0].slice(trailerKeys[1][1].length + 2),
    digest: values[2][0].slice(trailerKeys[2][1].length + 2),
  });
}

function areSingleTrailerValues(values: readonly (readonly string[])[]): values is SingleTrailerValues {
  return values.length === trailerKeys.length && values.every((items) => items.length === 1);
}

function parsedTrailers(block: string): ParsedTrailers {
  const values = trailerKeys.map(([, name]) =>
    block.split("\n").filter((line) => line.startsWith(`${name}: `)),
  );
  const hasReservedTrailer = values.some((items) => items.length > 0);
  if (!hasReservedTrailer) return { hasReservedTrailer };
  if (!areSingleTrailerValues(values)) return { hasReservedTrailer };
  return { trailer: trailers(values), hasReservedTrailer };
}

async function terminalTrailers(
  port: SignalBusMaterializationGitPort,
  root: string,
  commit: string,
): Promise<ParsedTrailers> {
  const message = await port.run(root, ["show", "--no-patch", "--format=%B", commit]);
  if (message.exitCode !== 0) fail("git-command");
  return parsedTrailers(await runText(port, root, ["interpret-trailers", "--parse"], message.stdout));
}

async function parentsForCommit(
  port: SignalBusMaterializationGitPort,
  root: string,
  commit: string,
): Promise<readonly string[]> {
  const parentOutput = await runText(port, root, ["rev-list", "--parents", "-n", "1", commit]);
  const tokens = parentOutput.split(" ");
  if (
    tokens.shift() !== commit ||
    tokens.length === 0 ||
    tokens.some((parent) => !commitPattern.test(parent))
  )
    fail("git-parents");
  return tokens;
}

async function verifyHistory(
  port: SignalBusMaterializationGitPort,
  root: string,
  base: string,
  approval: string,
  entries: readonly SignalBusMaterializationEntry[],
  requestedBrief: string,
): Promise<CanonicalDigest> {
  await verifyBase(port, root, base, false);
  await ensureTreeText(port, root, base, entries);
  const approvalAncestry = await port.run(root, ["merge-base", "--is-ancestor", approval, "HEAD"]);
  if (!commitPattern.test(approval) || approvalAncestry.exitCode !== 0) fail("approval-ancestry");
  const revisions = await runText(port, root, ["rev-list", "--topo-order", "--reverse", `${approval}..HEAD`]);
  const commits = revisions.split("\n").filter(Boolean);
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const previous = new Map<
    string,
    { readonly brief: string; readonly owner: string; readonly deleted: boolean }
  >();
  const firstBriefs = new Set<string>();
  let governed = 0;
  let requestedDigest: CanonicalDigest | undefined;
  for (const commit of commits) {
    const materialization = await collectCommitMaterializationDetail(
      port,
      root,
      await parentsForCommit(port, root, commit),
      commit,
    );
    const records = materialization.records;
    const governedTouched = materialization.touchedPaths.filter((path) => entriesByPath.has(path));
    if (governedTouched.length === 0) continue;
    const governedRecords = records.flatMap((record) => {
      const entry = entriesByPath.get(record.path);
      return entry === undefined ? [] : [{ record, entry }];
    });
    const parsed = await terminalTrailers(port, root, commit);
    if (governedRecords.length === 0) {
      if (parsed.hasReservedTrailer) fail("history-nonmaterialized-trailer");
      continue;
    }
    if (governedRecords.length !== records.length) fail("history-owner");
    const trailer = parsed.trailer ?? fail("history-trailer");
    governed += 1;
    await ensureTreeText(port, root, commit, entries);
    const digest = createCanonicalDigest(governedRecords.map(({ record }) => record));
    if (trailer.digest !== digest.value) fail("history-digest");
    for (const { record, entry } of governedRecords) {
      if (entry.brief !== trailer.brief || entry.owner !== trailer.owner) fail("history-owner");
      const prior = previous.get(record.path);
      if (prior === undefined) {
        if (
          record.operation !== operationFor(entry) ||
          entry.prerequisite.some((brief) => !firstBriefs.has(brief))
        )
          fail("history-first");
        firstBriefs.add(entry.brief);
      } else if (
        prior.deleted ||
        prior.brief !== trailer.brief ||
        prior.owner !== trailer.owner ||
        record.operation !== "M"
      )
        fail("history-successor");
      previous.set(record.path, {
        brief: trailer.brief,
        owner: trailer.owner,
        deleted: record.operation === "D",
      });
    }
    if (trailer.brief === requestedBrief) requestedDigest = digest.value;
  }
  if (governed === 0) fail("history-empty");
  if (requestedDigest === undefined) fail("history-incomplete");
  if (previous.size !== entriesByPath.size) fail("history-incomplete");
  const head = await runText(port, root, ["rev-parse", "HEAD"]);
  for (const entry of entries) {
    const record = toHistoryFinalRecord(
      entry.path,
      await readCommitTreeText(port, root, base, entry.path),
      await readCommitTreeText(port, root, head, entry.path),
    );
    if (record?.operation !== operationFor(entry)) fail("history-final-state");
  }
  return requestedDigest;
}

function toHistoryFinalRecord(
  path: string,
  base: Uint8Array | undefined,
  final: Uint8Array | undefined,
): CanonicalMaterializationRecord | undefined {
  if (base === undefined)
    return final === undefined ? undefined : { operation: "A", path, blobIdentity: "present" };
  if (final === undefined) return { operation: "D", path, blobIdentity: "absent" };
  return Buffer.compare(Buffer.from(base), Buffer.from(final)) === 0
    ? undefined
    : { operation: "M", path, blobIdentity: "present" };
}

export async function verifySignalBusMaterialization(
  request: SignalBusMaterializationVerificationRequest,
  port: SignalBusMaterializationGitPort = nodeSignalBusMaterializationPort,
): Promise<SignalBusMaterializationVerificationResult> {
  try {
    const roots = await verifyRepoRoots(port, request);
    const manifest = await immutableManifest(port, roots.manifestPath, request.role);
    const selected = selectedEntries(manifest, request.brief);
    let requestedBrief = "";
    for (const entry of selected) requestedBrief = entry.brief;
    const entries = request.mode === "history" ? manifest.materializations : selected;
    if (request.mode === "baseline") {
      await verifyBaseline(port, roots.candidateRoot, request.base ?? fail("base-required"), entries);
      return Object.freeze({ status: "pass", mode: request.mode, diagnostics: Object.freeze([]) });
    }
    const digest =
      request.mode === "candidate"
        ? await verifyCandidate(port, roots.candidateRoot, request.base ?? fail("base-required"), entries)
        : await verifyHistory(
            port,
            roots.candidateRoot,
            request.base ?? fail("base-required"),
            request.approval ?? fail("approval-required"),
            entries,
            requestedBrief,
          );
    return Object.freeze({ status: "pass", mode: request.mode, digest, diagnostics: Object.freeze([]) });
  } catch (error: unknown) {
    const diagnostic =
      error instanceof VerificationFailure
        ? error.diagnostic
        : { code: "unexpected", message: "signal-bus-materialization:unexpected" };
    return Object.freeze({ status: "fail", mode: request.mode, diagnostics: Object.freeze([diagnostic]) });
  }
}
