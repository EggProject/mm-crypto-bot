import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { collectCandidateMaterialization, parseNameStatusGitDiff } from "./signal-bus-materialization-git";
import { createCanonicalDigest } from "./signal-bus-materialization-contract";
import {
  createSignalBusModifiedBaselinePort,
  createSignalBusVerificationPort,
  signalBusGitOutput,
  signalBusFullIdentity,
  signalBusVerificationRequest,
  writeTemporaryFile,
  writeSignalBusManifest,
} from "./signal-bus-materialization-test-support";
import {
  createTemporarySignalBusRepo,
  signalBusHistoryVerificationRequest as historyRequest,
} from "./signal-bus-materialization-repo-test-support";
import { verifySignalBusMaterialization } from "./signal-bus-materialization-verifier";

test("rejects an explicitly detected copy before canonicalization", () => {
  expect(() =>
    parseNameStatusGitDiff(new TextEncoder().encode("C100\u{0}source.ts\u{0}copy.ts\u{0}")),
  ).toThrow(/rename-or-copy/u);
});

test("rejects an unowned path hidden through inherited Git config injection", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-git-config-injection-"));
  const manifestPath = path.join(directory, "manifest.json");
  const excludesPath = path.join(directory, "excludes");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/entry.ts", allowedOperation: "create" }]);
  await writeTemporaryFile(excludesPath, "unowned.ts\n");
  await fixture.write("governed/entry.ts", "export const entry = true;\n");
  await fixture.write("unowned.ts", "export const unowned = true;\n");
  const inheritedCount = process.env["GIT_CONFIG_COUNT"];
  const inheritedKey = process.env["GIT_CONFIG_KEY_0"];
  const inheritedValue = process.env["GIT_CONFIG_VALUE_0"];
  process.env["GIT_CONFIG_COUNT"] = "1";
  process.env["GIT_CONFIG_KEY_0"] = "core.excludesFile";
  process.env["GIT_CONFIG_VALUE_0"] = excludesPath;
  try {
    await expect(
      verifySignalBusMaterialization(
        {
          mode: "candidate",
          toolchainRoot: process.cwd(),
          candidateRoot: fixture.root,
          manifestPath,
          role: "active",
          base: await fixture.head(),
        },
        fixture.port,
      ),
    ).resolves.toMatchObject({ status: "fail", diagnostics: [{ code: "candidate-bijection" }] });
  } finally {
    if (inheritedCount === undefined) delete process.env["GIT_CONFIG_COUNT"];
    else process.env["GIT_CONFIG_COUNT"] = inheritedCount;
    if (inheritedKey === undefined) delete process.env["GIT_CONFIG_KEY_0"];
    else process.env["GIT_CONFIG_KEY_0"] = inheritedKey;
    if (inheritedValue === undefined) delete process.env["GIT_CONFIG_VALUE_0"];
    else process.env["GIT_CONFIG_VALUE_0"] = inheritedValue;
    await fixture.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(["", "export const entry = 1;"])(
  "keeps nofollow snapshot line metadata with candidate bytes %#",
  async (source) => {
    const fixture = await createTemporarySignalBusRepo();
    await fixture.write("governed/entry.ts", source);
    const records = await collectCandidateMaterialization(fixture.port, fixture.root, await fixture.head());
    expect(records).toHaveLength(1);
    await fixture.dispose();
  },
);

test("rejects an unstable final candidate snapshot", async () => {
  await expect(
    verifySignalBusMaterialization(
      signalBusVerificationRequest(),
      createSignalBusVerificationPort({
        entryStates: [{ identity: `git:${signalBusFullIdentity}`, isRegularFile: true, exists: true }],
        entrySnapshotStable: false,
      }),
    ),
  ).resolves.toMatchObject({ status: "fail", diagnostics: [{ code: "file-mutated" }] });
});

test.each(["/manifest", "/candidate/governed/entry.ts"])(
  "fails closed when a governed snapshot lacks its derived immutable data %#",
  async (missingPath) => {
    const basePort = createSignalBusModifiedBaselinePort();
    const port = {
      ...basePort,
      snapshot: async (absolutePath: string, gitRoot?: string) => {
        const snapshot = await basePort.snapshot(absolutePath, gitRoot);
        if (absolutePath !== missingPath) return snapshot;
        const { governedText: _governedText, lineCount: _lineCount, ...missingDerivedData } = snapshot;
        return missingDerivedData;
      },
    };
    await expect(
      verifySignalBusMaterialization(signalBusVerificationRequest({ mode: "baseline" }), port),
    ).resolves.toMatchObject({ status: "fail", diagnostics: [{ code: "governed-text" }] });
  },
);

test("requires one canonical trailer set per governed commit", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-manifest-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  const source = "export const a = 1;";
  await fixture.writeAndCommit("unrelated.ts", "export const unrelated = true;\n");
  await fixture.write("governed/a.ts", source);
  const { identity } = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"));
  const digest = createCanonicalDigest([
    { operation: "A", path: "governed/a.ts", blobIdentity: identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    source,
    `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${digest}\n`,
  );
  const request = historyRequest(fixture.root, manifestPath, approval);
  const runCalls: { readonly arguments_: readonly string[]; readonly input: Uint8Array | undefined }[] = [];
  const observedTrailerPort = {
    ...fixture.port,
    run: async (root: string, arguments_: readonly string[], input?: Uint8Array) => {
      runCalls.push({ arguments_, input });
      return await fixture.port.run(root, arguments_, input);
    },
  };
  expect(await verifySignalBusMaterialization(request, observedTrailerPort)).toEqual({
    status: "pass",
    mode: "history",
    digest,
    diagnostics: [],
  });
  const trailerCall = runCalls.find((call) => call.arguments_[0] === "interpret-trailers");
  expect(trailerCall).toBeDefined();
  expect(trailerCall?.arguments_).toEqual(["interpret-trailers", "--parse"]);
  expect(trailerCall?.input).toBeInstanceOf(Uint8Array);
  await expect(
    verifySignalBusMaterialization({ ...request, base: "b".repeat(40) }, fixture.port),
  ).resolves.toMatchObject({ status: "fail" });
  const failedTrailerPort = {
    ...fixture.port,
    run: async (root: string, arguments_: readonly string[], input?: Uint8Array) =>
      arguments_[1] === "--no-patch"
        ? signalBusGitOutput("", 1)
        : await fixture.port.run(root, arguments_, input),
  };
  await expect(verifySignalBusMaterialization(request, failedTrailerPort)).resolves.toMatchObject({
    status: "fail",
    diagnostics: [{ code: "git-command" }],
  });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("rejects a commit that mixes a governed path with an unrelated path", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-mixed-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  await fixture.write("unrelated.ts", "export const unrelated = true;\n");
  await fixture.commitWithMessage("governed/a.ts", "export const a = 1;\n", "mixed", ["unrelated.ts"]);
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toMatchObject({ status: "fail", diagnostics: [{ code: "history-owner" }] });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("rejects a non-modification successor after its initial materialization", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-deleted-successor-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  const source = "export const a = 1;\n";
  await fixture.write("governed/a.ts", source);
  const firstInspection = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"));
  const first = createCanonicalDigest([
    { operation: "A", path: "governed/a.ts", blobIdentity: firstInspection.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    source,
    `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${first}\n`,
  );
  const digest = createCanonicalDigest([
    { operation: "D", path: "governed/a.ts", blobIdentity: "absent" },
  ]).value;
  await fixture.removeAndCommitWithMessage(
    "governed/a.ts",
    `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${digest}\n`,
  );
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toMatchObject({ status: "fail" });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("rejects a partial manifest history even when the requested terminal brief exists", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-partial-history-manifest-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [
    { path: "governed/a.ts", allowedOperation: "create" },
    { path: "governed/b.ts", allowedOperation: "create", brief: "DEF" },
  ]);
  const source = "export const a = true;\n";
  await fixture.write("governed/a.ts", source);
  const inspected = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"));
  const digest = createCanonicalDigest([
    { operation: "A", path: "governed/a.ts", blobIdentity: inspected.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    source,
    `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${digest}`,
  );
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval, "DEF"), fixture.port),
  ).resolves.toEqual({
    status: "fail",
    mode: "history",
    diagnostics: [{ code: "history-incomplete", message: "signal-bus-materialization:history-incomplete" }],
  });
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval, "ABC"), fixture.port),
  ).resolves.toEqual({
    status: "fail",
    mode: "history",
    diagnostics: [{ code: "history-incomplete", message: "signal-bus-materialization:history-incomplete" }],
  });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("returns the requested brief terminal digest after a later brief materializes", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-requested-brief-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [
    { path: "governed/a.ts", allowedOperation: "create" },
    { path: "governed/a2.ts", allowedOperation: "create" },
    { path: "governed/b.ts", allowedOperation: "create", prerequisite: ["ABC"], brief: "DEF" },
  ]);
  const abcSource = "export const a = true;\n";
  await fixture.write("governed/a.ts", abcSource);
  await fixture.write("governed/a2.ts", "export const a2 = true;\n");
  const abcInspection = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"));
  const abcSecondInspection = await fixture.port.inspect(path.join(fixture.root, "governed/a2.ts"));
  const abcDigest = createCanonicalDigest([
    { operation: "A", path: "governed/a.ts", blobIdentity: abcInspection.identity },
    { operation: "A", path: "governed/a2.ts", blobIdentity: abcSecondInspection.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    abcSource,
    `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${abcDigest}`,
    ["governed/a2.ts"],
  );
  const dependentSource = "export const b = true;\n";
  await fixture.write("governed/b.ts", dependentSource);
  const dependentInspection = await fixture.port.inspect(path.join(fixture.root, "governed/b.ts"));
  const dependentDigest = createCanonicalDigest([
    { operation: "A", path: "governed/b.ts", blobIdentity: dependentInspection.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/b.ts",
    dependentSource,
    `materialize\n\nSignal-Bus-Materialization-Brief: DEF\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${dependentDigest}`,
  );
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval, "ABC"), fixture.port),
  ).resolves.toEqual({ status: "pass", mode: "history", digest: abcDigest, diagnostics: [] });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("rejects an empty manifest history", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-empty-history-manifest-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toEqual({
    status: "fail",
    mode: "history",
    diagnostics: [{ code: "history-empty", message: "signal-bus-materialization:history-empty" }],
  });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("accepts an empty initial materialization", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-empty-initial-history-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  await fixture.write("governed/a.ts", "");
  const inspection = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"));
  const digest = createCanonicalDigest([
    { operation: "A", path: "governed/a.ts", blobIdentity: inspection.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    "",
    `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${digest}\n`,
  );
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toEqual({ status: "pass", mode: "history", digest, diagnostics: [] });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("accepts a same-owner successor modification after its initial materialization", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-successor-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  const initial = "export const a = 1;\n";
  await fixture.write("governed/a.ts", initial);
  const firstInspection = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"));
  const first = createCanonicalDigest([
    { operation: "A", path: "governed/a.ts", blobIdentity: firstInspection.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    initial,
    `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${first}\n`,
  );
  const successor = "export const a = 2;\n";
  await fixture.write("governed/a.ts", successor);
  const successorInspection = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"));
  const digest = createCanonicalDigest([
    { operation: "M", path: "governed/a.ts", blobIdentity: successorInspection.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    successor,
    `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${digest}\n`,
  );
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toEqual({ status: "pass", mode: "history", digest, diagnostics: [] });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test.each([
  "materialize",
  "materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: \n",
  "materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: sha256:0000000000000000000000000000000000000000000000000000000000000000\n",
])("fails a governed commit without exactly one complete trailer set %#", async (message) => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-trailer-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  await fixture.commitWithMessage("governed/a.ts", "export const a = 1;\n", message);
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toMatchObject({ status: "fail" });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("rejects a governed commit whose trailer digest does not match its materialization", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-digest-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  await fixture.commitWithMessage(
    "governed/a.ts",
    "export const a = 1;\n",
    "materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: sha256:0000000000000000000000000000000000000000000000000000000000000000\n",
  );
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toMatchObject({ status: "fail" });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("rejects a governed commit whose canonical trailer owner differs from the manifest", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-owner-"));
  const manifestPath = path.join(directory, "manifest.json");
  const source = "export const a = 1;\n";
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  await fixture.write("governed/a.ts", source);
  const inspected = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"), fixture.root);
  const digest = createCanonicalDigest([
    { operation: "A", path: "governed/a.ts", blobIdentity: inspected.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    source,
    `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: other\nSignal-Bus-Materialization-Digest: ${digest}\n`,
  );
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toMatchObject({ status: "fail" });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test.each([
  ["C0 byte", "export const unsafe = \u{0}true;\n", "governed-text"],
  ["501 physical lines", "x\n".repeat(501), "line-limit"],
] as const)("rejects a %s in the approved deletion baseline", async (_name, source, code) => {
  const fixture = await createTemporarySignalBusRepo();
  await fixture.writeAndCommit("governed/a.ts", source);
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-delete-baseline-"));
  const manifestPath = path.join(directory, "manifest.json");
  try {
    await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "delete" }]);
    const digest = createCanonicalDigest([
      { operation: "D", path: "governed/a.ts", blobIdentity: "absent" },
    ]).value;
    await fixture.removeAndCommitWithMessage(
      "governed/a.ts",
      `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${digest}`,
    );
    await expect(
      verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
    ).resolves.toMatchObject({ status: "fail", diagnostics: [{ code }] });
  } finally {
    await fixture.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
