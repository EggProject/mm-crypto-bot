import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import {
  collectCandidateMaterialization,
  collectCommitMaterialization,
  createNodeSignalBusMaterializationPort,
  hasPorcelainStatusChanges,
  nodeSignalBusMaterializationPort,
  parseNameStatusGitDiff,
  parseRawGitDiff,
  validateStrictGovernedText,
} from "./signal-bus-materialization-git";
import {
  createSignalBusGitPort,
  createSignalBusVerificationPort,
  createTemporarySignalBusManifestFixture,
  createTemporarySignalBusRepo,
  signalBusFullIdentity,
  signalBusGitOutput,
  signalBusRepoVerificationRequest,
  signalBusVerificationRequest,
  writeTemporaryFile,
  writeSignalBusManifest,
} from "./signal-bus-materialization-test-support";
import { verifySignalBusMaterialization } from "./signal-bus-materialization-verifier";
const fullIdentity = signalBusFullIdentity;
const gitOutput = signalBusGitOutput;
const createGitPort = createSignalBusGitPort;
const createVerificationPort = createSignalBusVerificationPort;
const verificationRequest = signalBusVerificationRequest;
const addedRaw = `:100644 100644 ${"0".repeat(40)} ${fullIdentity} A\u{0}entry.ts\u{0}`;
const addedName = "A\u{0}entry.ts\u{0}";

test("rejects rename before path normalization", () => {
  expect(() =>
    parseRawGitDiff(
      new TextEncoder().encode(
        ":100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100\u{0}old.ts\u{0}new.ts\u{0}",
      ),
    ),
  ).toThrow(/rename-or-copy/u);
});

test("rejects a chmod-only diff with the same blob", () => {
  expect(() =>
    parseRawGitDiff(
      new TextEncoder().encode(
        ":100644 100755 1111111111111111111111111111111111111111 1111111111111111111111111111111111111111 M\u{0}entry.ts\u{0}",
      ),
    ),
  ).toThrow(/mode-only/u);
});

test("parses every supported NUL-delimited Git status", () => {
  expect(
    parseNameStatusGitDiff(new TextEncoder().encode("A\u{0}a.ts\u{0}M\u{0}m.ts\u{0}D\u{0}d.ts\u{0}")),
  ).toEqual(["a.ts", "m.ts", "d.ts"]);
  expect(
    parseRawGitDiff(
      new TextEncoder().encode(
        ":100644 100644 0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 A\u{0}a.ts\u{0}:100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 M\u{0}m.ts\u{0}:100644 100644 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 D\u{0}d.ts\u{0}",
      ),
    ).map((record) => record.path),
  ).toEqual(["a.ts", "m.ts", "d.ts"]);
});

test("validates NUL porcelain records and strict governed bytes", () => {
  expect(hasPorcelainStatusChanges(new Uint8Array())).toBe(false);
  expect(hasPorcelainStatusChanges(new TextEncoder().encode("R  new.ts\u{0}old.ts\u{0}"))).toBe(true);
  expect(() => hasPorcelainStatusChanges(new TextEncoder().encode("bad\u{0}"))).toThrow();
  expect(() => validateStrictGovernedText(new Uint8Array([255]))).toThrow(/governed-text/u);
});

test.each([
  new TextEncoder().encode("A\u{0}entry.ts"),
  new TextEncoder().encode("X\u{0}entry.ts\u{0}"),
  new TextEncoder().encode("A\u{0}"),
])("rejects malformed name-status output %#", (output) => {
  expect(() => parseNameStatusGitDiff(output)).toThrow();
});

test.each([
  new TextEncoder().encode(
    ":100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 M\u{0}entry.ts",
  ),
  new TextEncoder().encode("invalid\u{0}entry.ts\u{0}"),
  new TextEncoder().encode(
    ":100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 M\u{0}",
  ),
])("rejects malformed raw output %#", (output) => {
  expect(() => parseRawGitDiff(output)).toThrow();
});

test("uses a temporary local repository only", async () => {
  const fixture = await createTemporarySignalBusRepo();
  await fixture.writeAndCommit("governed/entry.ts", "export const entry = 1;\n");
  expect(await fixture.remoteNames()).toEqual([]);
  await fixture.dispose();
});

test("isolates fixture Git commands from hostile global configuration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-hostile-global-"));
  const config = path.join(directory, "config");
  await writeTemporaryFile(config, "[commit]\n\tgpgsign = true\n");
  const previous = process.env["GIT_CONFIG_GLOBAL"];
  process.env["GIT_CONFIG_GLOBAL"] = config;
  try {
    const fixture = await createTemporarySignalBusRepo();
    expect(await fixture.head()).toMatch(/^[a-f0-9]{40}$/u);
    await fixture.dispose();
  } finally {
    if (previous === undefined) delete process.env["GIT_CONFIG_GLOBAL"];
    else process.env["GIT_CONFIG_GLOBAL"] = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("collects an untracked final file once", async () => {
  const fixture = await createTemporarySignalBusRepo();
  await fixture.write("governed/entry.ts", "export const entry = 1;\n");
  const records = await collectCandidateMaterialization(fixture.port, fixture.root, await fixture.head());
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ operation: "A", path: "governed/entry.ts" });
  expect(records[0]?.blobIdentity).toMatch(/^git:[a-f0-9]{40}$/u);
  await fixture.dispose();
});

test("rejects an untracked final symlink instead of hashing its target", async () => {
  const fixture = await createTemporarySignalBusRepo();
  await fixture.write("governed/target.ts", "export const target = true;\n");
  await fixture.symlink("governed/link.ts", "target.ts");
  await expect(
    collectCandidateMaterialization(fixture.port, fixture.root, await fixture.head()),
  ).rejects.toThrow(/symlink-component/u);
  await fixture.dispose();
});

test("rejects a symlinked manifest rather than canonicalizing its target", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-manifest-symlink-"));
  const target = path.join(directory, "target.json");
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(target, [{ path: "governed/entry.ts", allowedOperation: "create" }]);
  const filesystem = await import("node:fs/promises");
  await filesystem.symlink(new URL(`file://${target}`), new URL(`file://${manifestPath}`));
  await fixture.write("governed/entry.ts", "export const entry = true;\n");
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
  ).resolves.toMatchObject({ status: "fail" });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("rejects NUL bytes in a governed candidate file", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-candidate-nul-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/entry.ts", allowedOperation: "create" }]);
  await fixture.write("governed/entry.ts", "export const entry = \u{0}true;\n");
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
  ).resolves.toMatchObject({ status: "fail" });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("overrides repository core.abbrev and retains a full canonical identity", async () => {
  const fixture = await createTemporarySignalBusRepo();
  await fixture.writeAndCommit("governed/source.ts", "export const source = 1;\n");
  await fixture.setGitConfig("core.abbrev", "7");
  await fixture.writeAndStage("governed/source.ts", "export const source = 2;\n");
  const records = await collectCandidateMaterialization(fixture.port, fixture.root, await fixture.head());
  expect(records[0]?.blobIdentity).toMatch(/^git:[a-f0-9]{40}$/u);
  await fixture.dispose();
});

test("reduces committed, staged, unstaged, and deleted state to final records", async () => {
  const fixture = await createTemporarySignalBusRepo();
  await fixture.writeAndCommit("governed/modify.ts", "export const modify = 0;\n");
  await fixture.writeAndCommit("governed/delete.ts", "export const remove = 0;\n");
  const base = await fixture.head();
  await fixture.writeAndStage("governed/modify.ts", "export const modify = 1;\n");
  await fixture.write("governed/modify.ts", "export const modify = 2;\n");
  await fixture.write("governed/create.ts", "export const created = true;\n");
  await fixture.remove("governed/delete.ts");
  expect(await collectCandidateMaterialization(fixture.port, fixture.root, base)).toMatchObject([
    { operation: "A", path: "governed/create.ts" },
    { operation: "D", path: "governed/delete.ts", blobIdentity: "absent" },
    { operation: "M", path: "governed/modify.ts" },
  ]);
  await fixture.dispose();
});

test("fails closed when paired diff transports disagree", async () => {
  const port = createGitPort(
    (arguments_) =>
      arguments_[0] === "diff"
        ? gitOutput(arguments_.includes("--raw") ? addedRaw : "A\u{0}other.ts\u{0}")
        : gitOutput(""),
    () => Promise.resolve({ identity: `git:${fullIdentity}`, isRegularFile: true, exists: true }),
  );
  await expect(collectCandidateMaterialization(port, "/candidate", "a".repeat(40))).rejects.toThrow(
    /git-diff-mismatch/u,
  );
});

test("omits a staged-then-removed create from the final materialization", async () => {
  const port = createGitPort(
    (arguments_) =>
      arguments_[0] === "diff"
        ? gitOutput(arguments_.includes("--raw") ? addedRaw : addedName)
        : gitOutput(""),
    () => Promise.resolve({ identity: "", isRegularFile: false, exists: false }),
  );
  await expect(collectCandidateMaterialization(port, "/candidate", "a".repeat(40))).resolves.toEqual([]);
});

test("omits a diff path whose final state equals its parent", async () => {
  const baseIdentity = "2".repeat(40);
  const modifiedRaw = `:100644 100644 ${fullIdentity} ${baseIdentity} M\u{0}entry.ts\u{0}`;
  const port = createGitPort(
    (arguments_) => {
      if (arguments_[0] === "diff")
        return gitOutput(arguments_.includes("--raw") ? modifiedRaw : "M\u{0}entry.ts\u{0}");
      if (arguments_[0] === "ls-tree") return gitOutput(`100644 blob ${baseIdentity}\tentry.ts\u{0}`);
      return gitOutput("");
    },
    () => Promise.resolve({ identity: `git:${baseIdentity}`, isRegularFile: true, exists: true }),
  );
  await expect(collectCandidateMaterialization(port, "/candidate", "a".repeat(40))).resolves.toEqual([]);
  await expect(
    collectCommitMaterialization(port, "/candidate", "a".repeat(40), "b".repeat(40)),
  ).resolves.toEqual([]);
});

test("rejects a Git tree response with an invalid NUL record arity", async () => {
  const port = createGitPort(
    (arguments_) => {
      if (arguments_[0] === "diff") return gitOutput(arguments_.includes("--raw") ? addedRaw : addedName);
      if (arguments_[0] === "ls-tree") return gitOutput("first\u{0}second\u{0}");
      return gitOutput("");
    },
    () => Promise.resolve({ identity: `git:${fullIdentity}`, isRegularFile: true, exists: true }),
  );
  await expect(collectCandidateMaterialization(port, "/candidate", "a".repeat(40))).rejects.toThrow(
    /git-tree-arity/u,
  );
});

test("reports a missing final filesystem entry without following a path", async () => {
  await expect(
    nodeSignalBusMaterializationPort.inspect("/tmp/nonexistent-signal-bus-materialization-entry"),
  ).resolves.toEqual({ identity: "", isRegularFile: false, exists: false });
  await expect(nodeSignalBusMaterializationPort.snapshot("\u{0}")).rejects.toThrow(/file-snapshot/u);
  await expect(nodeSignalBusMaterializationPort.snapshot("/tmp")).resolves.toMatchObject({
    isRegularFile: false,
  });
});

test("rejects a same-inode candidate rewrite after bytes were read", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const entryPath = path.join(fixture.root, "governed/entry.ts");
  await fixture.write("governed/entry.ts", "export const entry = 1;\n");
  const port = createNodeSignalBusMaterializationPort({
    afterRead: async (absolutePath) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The injected port supplies the fixture's exact candidate path.
      await writeFile(absolutePath, "export const entry = 2;\n", "utf8");
    },
  });
  await expect(collectCandidateMaterialization(port, fixture.root, await fixture.head())).rejects.toThrow(
    /file-mutated/u,
  );
  expect(await fixture.port.inspect(entryPath, fixture.root)).not.toEqual({ identity: "", exists: false });
  await fixture.dispose();
});

test("rejects a SHA-256 Git object identity at the SHA-1-only verifier boundary", async () => {
  const fixture = await createTemporarySignalBusRepo("sha256");
  await fixture.write("governed/entry.ts", "export const entry = true;\n");
  await expect(
    fixture.port.inspect(path.join(fixture.root, "governed/entry.ts"), fixture.root),
  ).rejects.toThrow(/git-final-identity/u);
  await fixture.dispose();
});

test.each(["", "entry"])("accepts a bounded candidate entry with text variant %#", async (entryText) => {
  const entryStates = Array.from({ length: 3 }, () => ({
    identity: `git:${fullIdentity}`,
    isRegularFile: true,
    exists: true,
  }));
  await expect(
    verifySignalBusMaterialization(verificationRequest(), createVerificationPort({ entryStates, entryText })),
  ).resolves.toMatchObject({ status: "pass" });
});

test.each([
  () =>
    createGitPort(
      () => gitOutput("", 1),
      () => Promise.resolve({ identity: "", isRegularFile: false, exists: false }),
    ),
  () =>
    createGitPort(
      (arguments_) => {
        if (arguments_[0] === "diff") return gitOutput(arguments_.includes("--raw") ? addedRaw : addedName);
        if (arguments_[0] === "ls-tree") return gitOutput("100644 blob " + fullIdentity + "\u{0}");
        return gitOutput("");
      },
      () => Promise.resolve({ identity: `git:${fullIdentity}`, isRegularFile: true, exists: true }),
    ),
  () =>
    createGitPort(
      (arguments_) =>
        arguments_[0] === "diff"
          ? gitOutput(arguments_.includes("--raw") ? addedRaw : addedName)
          : gitOutput(""),
      () => Promise.resolve({ identity: `git:${fullIdentity}`, isRegularFile: false, exists: true }),
    ),
  () =>
    createGitPort(
      (arguments_) =>
        arguments_[0] === "diff"
          ? gitOutput(arguments_.includes("--raw") ? addedRaw : addedName)
          : gitOutput(""),
      () => Promise.resolve({ identity: "git:short", isRegularFile: true, exists: true }),
    ),
])("rejects malformed Git transport or final state %#", async (createPort) => {
  await expect(collectCandidateMaterialization(createPort(), "/candidate", "a".repeat(40))).rejects.toThrow();
});

test("candidate requires an exact final materialization bijection", async () => {
  const { fixture, manifestPath, dispose } =
    await createTemporarySignalBusManifestFixture("signal-bus-manifest-");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/entry.ts", allowedOperation: "create" }]);
  await fixture.write("governed/entry.ts", "export const entry = 1;\n");
  const request = signalBusRepoVerificationRequest(
    "candidate",
    fixture.root,
    manifestPath,
    await fixture.head(),
  );
  const initial = await verifySignalBusMaterialization(request, fixture.port);
  expect(initial.status).toBe("pass");
  expect(initial.mode).toBe("candidate");
  expect(initial.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(initial.diagnostics).toEqual([]);
  await fixture.write("governed/extra.ts", "export const extra = 1;\n");
  await expect(verifySignalBusMaterialization(request, fixture.port)).resolves.toMatchObject({
    status: "fail",
  });
  await dispose();
});

test("accepts a declared deletion after the final path is absent", async () => {
  const { fixture, manifestPath, dispose } = await createTemporarySignalBusManifestFixture(
    "signal-bus-delete-manifest-",
  );
  await fixture.writeAndCommit("governed/entry.ts", "export const entry = true;\n");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/entry.ts", allowedOperation: "delete" }]);
  const base = await fixture.head();
  await fixture.remove("governed/entry.ts");
  await expect(
    verifySignalBusMaterialization(
      {
        mode: "candidate",
        toolchainRoot: process.cwd(),
        candidateRoot: fixture.root,
        manifestPath,
        role: "active",
        base,
      },
      fixture.port,
    ),
  ).resolves.toMatchObject({ status: "pass" });
  await dispose();
});

test("fails candidate verification for empty, mismatched, and overlong final materializations", async () => {
  const { fixture, manifestPath, dispose } = await createTemporarySignalBusManifestFixture(
    "signal-bus-candidate-boundary-",
  );
  const base = await fixture.head();
  const request = signalBusRepoVerificationRequest("candidate", fixture.root, manifestPath, base);
  await writeSignalBusManifest(manifestPath, [{ path: "governed/entry.ts", allowedOperation: "create" }]);
  await expect(verifySignalBusMaterialization(request, fixture.port)).resolves.toMatchObject({
    status: "fail",
  });
  await fixture.write("governed/entry.ts", "export const entry = true;\n");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/entry.ts", allowedOperation: "modify" }]);
  await expect(verifySignalBusMaterialization(request, fixture.port)).resolves.toMatchObject({
    status: "fail",
  });
  await writeSignalBusManifest(manifestPath, [{ path: "governed/entry.ts", allowedOperation: "create" }]);
  await fixture.write("governed/entry.ts", "x\n".repeat(501));
  await expect(verifySignalBusMaterialization(request, fixture.port)).resolves.toMatchObject({
    status: "fail",
  });
  await dispose();
});

test("requires an explicit known brief when a manifest has multiple briefs", async () => {
  const { fixture, manifestPath, dispose } = await createTemporarySignalBusManifestFixture(
    "signal-bus-brief-boundary-",
  );
  const base = await fixture.head();
  await writeSignalBusManifest(manifestPath, [
    { path: "governed/a.ts", allowedOperation: "create" },
    { path: "governed/b.ts", allowedOperation: "create", brief: "DEF" },
  ]);
  await fixture.write("governed/a.ts", "export const a = true;\n");
  await fixture.write("governed/b.ts", "export const b = true;\n");
  const request = signalBusRepoVerificationRequest("candidate", fixture.root, manifestPath, base);
  await expect(verifySignalBusMaterialization(request, fixture.port)).resolves.toMatchObject({
    status: "fail",
  });
  await expect(
    verifySignalBusMaterialization({ ...request, brief: "XYZ" }, fixture.port),
  ).resolves.toMatchObject({ status: "fail" });
  await dispose();
});

test("baseline proves create absent, modify and delete present, and a clean base", async () => {
  const { fixture, manifestPath, dispose } = await createTemporarySignalBusManifestFixture(
    "signal-bus-baseline-manifest-",
  );
  await fixture.writeAndCommit("governed/modify.ts", "export const modify = 0;\n");
  await fixture.writeAndCommit("governed/delete.ts", "export const remove = 0;\n");
  await writeSignalBusManifest(manifestPath, [
    { path: "governed/create.ts", allowedOperation: "create" },
    { path: "governed/modify.ts", allowedOperation: "modify" },
    { path: "governed/delete.ts", allowedOperation: "delete" },
  ]);
  const base = await fixture.head();
  const request = signalBusRepoVerificationRequest("baseline", fixture.root, manifestPath, base);
  await expect(verifySignalBusMaterialization(request, fixture.port)).resolves.toEqual({
    status: "pass",
    mode: "baseline",
    diagnostics: [],
  });
  await fixture.write("governed/create.ts", "export const premature = 1;\n");
  await expect(verifySignalBusMaterialization(request, fixture.port)).resolves.toMatchObject({
    status: "fail",
  });
  await dispose();
});

test("fails a clean baseline when a required modify path is absent", async () => {
  const { fixture, manifestPath, dispose } = await createTemporarySignalBusManifestFixture(
    "signal-bus-baseline-missing-",
  );
  await writeSignalBusManifest(manifestPath, [{ path: "governed/missing.ts", allowedOperation: "modify" }]);
  await expect(
    verifySignalBusMaterialization(
      {
        mode: "baseline",
        toolchainRoot: process.cwd(),
        candidateRoot: fixture.root,
        manifestPath,
        role: "active",
        base: await fixture.head(),
      },
      fixture.port,
    ),
  ).resolves.toMatchObject({ status: "fail" });
  await dispose();
});
