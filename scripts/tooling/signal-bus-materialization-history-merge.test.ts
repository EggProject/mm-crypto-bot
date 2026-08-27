import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { createCanonicalDigest } from "./signal-bus-materialization-contract";
import { collectCommitMaterializationDetail } from "./signal-bus-materialization-git";
import { writeSignalBusManifest } from "./signal-bus-materialization-test-support";
import {
  createTemporarySignalBusRepo,
  signalBusHistoryVerificationRequest as historyRequest,
} from "./signal-bus-materialization-repo-test-support";
import { verifySignalBusMaterialization } from "./signal-bus-materialization-verifier";

async function withHistory(
  entries: Parameters<typeof writeSignalBusManifest>[1],
  action: (
    fixture: Awaited<ReturnType<typeof createTemporarySignalBusRepo>>,
    manifestPath: string,
    approval: string,
  ) => Promise<void>,
): Promise<void> {
  const fixture = await createTemporarySignalBusRepo();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-contract-"));
  try {
    const manifestPath = path.join(directory, "manifest.json");
    await writeSignalBusManifest(manifestPath, entries);
    await action(fixture, manifestPath, await fixture.head());
  } finally {
    await fixture.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

async function digestFor(
  fixture: Awaited<ReturnType<typeof createTemporarySignalBusRepo>>,
  operation: "A" | "M" | "D",
  relativePath: string,
): Promise<string> {
  const inspection = await fixture.port.inspect(path.join(fixture.root, relativePath));
  const identity = operation === "D" ? "absent" : inspection.identity;
  return createCanonicalDigest([{ operation, path: relativePath, blobIdentity: identity }]).value;
}

function trailer(digest: string): string {
  return `materialize\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${digest}`;
}

test.each([true, false])(
  "checks a novel conflict-resolution modification trailer %#",
  async (validDigest) => {
    const source = "export const a = 0;\n";
    const resolved = "export const a = 3;\n";
    const fixture = await createTemporarySignalBusRepo();
    await fixture.writeAndCommit("governed/a.ts", source);
    const approval = await fixture.head();
    const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-conflict-"));
    const manifestPath = path.join(directory, "manifest.json");
    try {
      await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "modify" }]);
      const main = await fixture.currentBranch();
      await fixture.branch("feature");
      await fixture.write("governed/a.ts", "export const a = 1;\n");
      await fixture.commitWithMessage(
        "governed/a.ts",
        "export const a = 1;\n",
        trailer(await digestFor(fixture, "M", "governed/a.ts")),
      );
      await fixture.checkout(main);
      await fixture.write("governed/a.ts", "export const a = 2;\n");
      await fixture.commitWithMessage(
        "governed/a.ts",
        "export const a = 2;\n",
        trailer(await digestFor(fixture, "M", "governed/a.ts")),
      );
      await fixture.write("resolution.ts", resolved);
      const inspection = await fixture.port.inspect(path.join(fixture.root, "resolution.ts"));
      const identity = inspection.identity;
      const digest = createCanonicalDigest([
        { operation: "M", path: "governed/a.ts", blobIdentity: identity },
      ]).value;
      await fixture.remove("resolution.ts");
      await fixture.mergeWithResolution(
        "feature",
        "governed/a.ts",
        resolved,
        trailer(validDigest ? digest : "sha256:" + "0".repeat(64)),
      );
      const result = await verifySignalBusMaterialization(
        historyRequest(fixture.root, manifestPath, approval),
        fixture.port,
      );
      if (validDigest) expect(result).toEqual({ status: "pass", mode: "history", digest, diagnostics: [] });
      else expect(result).toMatchObject({ status: "fail", diagnostics: [{ code: "history-digest" }] });
    } finally {
      await fixture.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("enforces prerequisite first materialization order", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-dependency-manifest-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [
    { path: "governed/a.ts", allowedOperation: "create" },
    { path: "governed/b.ts", allowedOperation: "create", prerequisite: ["ABC"], brief: "DEF" },
  ]);
  const source = "export const b = 1;\n";
  await fixture.write("governed/b.ts", source);
  const { identity } = await fixture.port.inspect(path.join(fixture.root, "governed/b.ts"));
  const digest = createCanonicalDigest([
    { operation: "A", path: "governed/b.ts", blobIdentity: identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/b.ts",
    source,
    `materialize\n\nSignal-Bus-Materialization-Brief: DEF\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${digest}\n`,
  );
  const request = historyRequest(fixture.root, manifestPath, approval, "DEF");
  await expect(verifySignalBusMaterialization(request, fixture.port)).resolves.toMatchObject({
    status: "fail",
  });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("rejects body-only pseudo-trailers and binary governed history", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-terminal-trailer-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  const source = "export const a = \u{0}true;\n";
  await fixture.write("governed/a.ts", source);
  const inspected = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"));
  const digest = createCanonicalDigest([
    { operation: "A", path: "governed/a.ts", blobIdentity: inspected.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    source,
    `Signal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${digest}\n\nbody`,
  );
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toMatchObject({ status: "fail" });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("rejects an approval identifier outside the exact commit grammar", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-approval-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  const base = await fixture.head();
  const request = { ...historyRequest(fixture.root, manifestPath, base), approval: "bad" };
  await expect(verifySignalBusMaterialization(request, fixture.port)).resolves.toMatchObject({
    status: "fail",
  });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("rejects a governed history tree with more than 500 lines", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-lines-"));
  const manifestPath = path.join(directory, "manifest.json");
  const source = "x\n".repeat(501);
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  await fixture.write("governed/a.ts", source);
  const digest = await digestFor(fixture, "A", "governed/a.ts");
  await fixture.commitWithMessage("governed/a.ts", source, trailer(digest));
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toMatchObject({ status: "fail", diagnostics: [{ code: "line-limit" }] });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("accepts prerequisite-before-dependent materialization across a branch merge", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const main = await fixture.currentBranch();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-merge-order-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [
    { path: "governed/a.ts", allowedOperation: "create" },
    { path: "governed/b.ts", allowedOperation: "create", prerequisite: ["ABC"], brief: "DEF" },
  ]);
  const a = "export const a = true;\n";
  await fixture.write("governed/a.ts", a);
  const aFile = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"));
  const aDigest = createCanonicalDigest([
    { operation: "A", path: "governed/a.ts", blobIdentity: aFile.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    a,
    `a\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${aDigest}`,
  );
  await fixture.branch("dependent");
  const b = "export const b = true;\n";
  await fixture.write("governed/b.ts", b);
  const bFile = await fixture.port.inspect(path.join(fixture.root, "governed/b.ts"));
  const bDigest = createCanonicalDigest([
    { operation: "A", path: "governed/b.ts", blobIdentity: bFile.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/b.ts",
    b,
    `b\n\nSignal-Bus-Materialization-Brief: DEF\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${bDigest}`,
  );
  await fixture.checkout(main);
  await fixture.writeAndCommit("unrelated.ts", "export const unrelated = true;\n");
  await fixture.checkout("dependent");
  await fixture.merge(main);
  const verification = await verifySignalBusMaterialization(
    historyRequest(fixture.root, manifestPath, approval, "DEF"),
    fixture.port,
  );
  expect(verification).toEqual({ status: "pass", mode: "history", digest: bDigest, diagnostics: [] });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test("accepts a feature creation merged as the second parent without a merge trailer", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const approval = await fixture.head();
  const main = await fixture.currentBranch();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-second-parent-"));
  const manifestPath = path.join(directory, "manifest.json");
  await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "create" }]);
  await fixture.branch("feature");
  const source = "export const a = true;\n";
  await fixture.write("governed/a.ts", source);
  const file = await fixture.port.inspect(path.join(fixture.root, "governed/a.ts"));
  const digest = createCanonicalDigest([
    { operation: "A", path: "governed/a.ts", blobIdentity: file.identity },
  ]).value;
  await fixture.commitWithMessage(
    "governed/a.ts",
    source,
    `feature\n\nSignal-Bus-Materialization-Brief: ABC\nSignal-Bus-Materialization-Owner: owner\nSignal-Bus-Materialization-Digest: ${digest}`,
  );
  await fixture.checkout(main);
  await fixture.writeAndCommit("unrelated.ts", "export const unrelated = true;\n");
  await fixture.merge("feature");
  await expect(
    verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
  ).resolves.toEqual({ status: "pass", mode: "history", digest, diagnostics: [] });
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

test.each([
  [undefined, "pass"],
  ["merge\n\nSignal-Bus-Materialization-Brief: ABC", "history-nonmaterialized-trailer"],
])(
  "checks reserved trailers on an unchanged second-parent feature merge %#",
  async (mergeTrailer, expected) => {
    await withHistory(
      [{ path: "governed/a.ts", allowedOperation: "create" }],
      async (fixture, manifestPath, approval) => {
        const main = await fixture.currentBranch();
        await fixture.branch("feature");
        const source = "export const a = true;\n";
        await fixture.write("governed/a.ts", source);
        const digest = await digestFor(fixture, "A", "governed/a.ts");
        await fixture.commitWithMessage("governed/a.ts", source, trailer(digest));
        await fixture.checkout(main);
        await fixture.writeAndCommit("unrelated.ts", "export const unrelated = true;\n");
        await fixture.merge("feature", mergeTrailer);
        const mergeMessage = await fixture.port.run(fixture.root, [
          "show",
          "--no-patch",
          "--format=%B",
          "HEAD",
        ]);
        expect(new TextDecoder().decode(mergeMessage.stdout)).toContain(mergeTrailer ?? "Merge branch");
        const result = await verifySignalBusMaterialization(
          historyRequest(fixture.root, manifestPath, approval),
          fixture.port,
        );
        if (expected === "pass")
          expect(result).toEqual({ status: "pass", mode: "history", digest, diagnostics: [] });
        else expect(result).toMatchObject({ status: "fail", diagnostics: [{ code: expected }] });
      },
    );
  },
);

test("rejects an accepted feature creation discarded by its merge", async () => {
  await withHistory(
    [{ path: "governed/a.ts", allowedOperation: "create" }],
    async (fixture, manifestPath, approval) => {
      const main = await fixture.currentBranch();
      await fixture.branch("feature");
      const source = "export const a = true;\n";
      await fixture.write("governed/a.ts", source);
      const digest = await digestFor(fixture, "A", "governed/a.ts");
      await fixture.commitWithMessage("governed/a.ts", source, trailer(digest));
      await fixture.checkout(main);
      await fixture.writeAndCommit("unrelated.ts", "export const unrelated = true;\n");
      await fixture.mergeWithResolution("feature", "governed/a.ts", undefined, "discard feature");
      await expect(
        verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
      ).resolves.toMatchObject({ status: "fail", diagnostics: [{ code: "history-final-state" }] });
    },
  );
});

test("accepts an octopus merge whose governed state equals one parent", async () => {
  const fixture = await createTemporarySignalBusRepo();
  await fixture.writeAndCommit("governed/a.ts", "export const a = 0;\n");
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-octopus-"));
  const manifestPath = path.join(directory, "manifest.json");
  try {
    await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "modify" }]);
    const main = await fixture.currentBranch();
    await fixture.branch("one");
    const source = "export const a = 1;\n";
    await fixture.write("governed/a.ts", source);
    const digest = await digestFor(fixture, "M", "governed/a.ts");
    await fixture.commitWithMessage("governed/a.ts", source, trailer(digest));
    await fixture.checkout(main);
    await fixture.branch("two");
    await fixture.writeAndCommit("unrelated.ts", "export const unrelated = true;\n");
    await fixture.checkout(main);
    await fixture.merge(["one", "two"]);
    await expect(
      verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
    ).resolves.toEqual({ status: "pass", mode: "history", digest, diagnostics: [] });
  } finally {
    await fixture.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires a trailer for a novel governed octopus resolution", async () => {
  const fixture = await createTemporarySignalBusRepo();
  await fixture.writeAndCommit("governed/a.ts", "export const a = 0;\n");
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-octopus-novel-"));
  const manifestPath = path.join(directory, "manifest.json");
  try {
    await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "modify" }]);
    const main = await fixture.currentBranch();
    await fixture.branch("one");
    await fixture.write("governed/a.ts", "export const a = 1;\n");
    await fixture.commitWithMessage(
      "governed/a.ts",
      "export const a = 1;\n",
      trailer(await digestFor(fixture, "M", "governed/a.ts")),
    );
    await fixture.checkout(main);
    await fixture.branch("two");
    await fixture.write("governed/a.ts", "export const a = 2;\n");
    await fixture.commitWithMessage(
      "governed/a.ts",
      "export const a = 2;\n",
      trailer(await digestFor(fixture, "M", "governed/a.ts")),
    );
    await fixture.checkout(main);
    await fixture.write("resolution.ts", "export const a = 3;\n");
    const inspection = await fixture.port.inspect(path.join(fixture.root, "resolution.ts"));
    const identity = inspection.identity;
    await fixture.remove("resolution.ts");
    const digest = createCanonicalDigest([
      { operation: "M", path: "governed/a.ts", blobIdentity: identity },
    ]).value;
    await fixture.mergeWithResolution(
      ["one", "two"],
      "governed/a.ts",
      "export const a = 3;\n",
      trailer(digest),
    );
    await expect(
      verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
    ).resolves.toEqual({ status: "pass", mode: "history", digest, diagnostics: [] });
  } finally {
    await fixture.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a governed path returned to its approved base state", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const base = "export const a = 0;\n";
  await fixture.writeAndCommit("governed/a.ts", base);
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-return-base-"));
  const manifestPath = path.join(directory, "manifest.json");
  try {
    await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "modify" }]);
    await fixture.write("governed/a.ts", "export const a = 1;\n");
    await fixture.commitWithMessage(
      "governed/a.ts",
      "export const a = 1;\n",
      trailer(await digestFor(fixture, "M", "governed/a.ts")),
    );
    await fixture.write("governed/a.ts", base);
    await fixture.commitWithMessage(
      "governed/a.ts",
      base,
      trailer(await digestFor(fixture, "M", "governed/a.ts")),
    );
    await expect(
      verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), fixture.port),
    ).resolves.toMatchObject({ status: "fail", diagnostics: [{ code: "history-final-state" }] });
  } finally {
    await fixture.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a malformed direct-parent record", async () => {
  await withHistory(
    [{ path: "governed/a.ts", allowedOperation: "create" }],
    async (fixture, manifestPath, approval) => {
      await fixture.commitWithMessage("governed/a.ts", "export const a = 1;\n", "materialize");
      const port = {
        ...fixture.port,
        run: async (root: string, arguments_: readonly string[], input?: Uint8Array) =>
          arguments_.at(0) === "rev-list" && arguments_.includes("--parents")
            ? { stdout: new TextEncoder().encode("bad"), stderr: "", exitCode: 0 }
            : await fixture.port.run(root, arguments_, input),
      };
      await expect(
        verifySignalBusMaterialization(historyRequest(fixture.root, manifestPath, approval), port),
      ).resolves.toMatchObject({
        status: "fail",
        diagnostics: [{ code: "git-parents" }],
      });
    },
  );
});

test("rejects an empty direct-parent list", async () => {
  const fixture = await createTemporarySignalBusRepo();
  try {
    await expect(
      collectCommitMaterializationDetail(fixture.port, fixture.root, [], await fixture.head()),
    ).rejects.toThrow(/git-parents/u);
  } finally {
    await fixture.dispose();
  }
});

test.each([
  [undefined, "pass"],
  ["export const a = true;\n", "history-final-state"],
])("checks final state for a second-parent feature deletion %#", async (resolution, expected) => {
  const source = "export const a = true;\n";
  const fixture = await createTemporarySignalBusRepo();
  await fixture.writeAndCommit("governed/a.ts", source);
  const approval = await fixture.head();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-history-delete-"));
  const manifestPath = path.join(directory, "manifest.json");
  try {
    await writeSignalBusManifest(manifestPath, [{ path: "governed/a.ts", allowedOperation: "delete" }]);
    const main = await fixture.currentBranch();
    await fixture.branch("feature");
    const digest = await digestFor(fixture, "D", "governed/a.ts");
    await fixture.removeAndCommitWithMessage("governed/a.ts", trailer(digest));
    await fixture.checkout(main);
    await fixture.writeAndCommit("unrelated.ts", "export const unrelated = true;\n");
    if (resolution === undefined) await fixture.merge("feature");
    else await fixture.mergeWithResolution("feature", "governed/a.ts", resolution, "discard deletion");
    const result = await verifySignalBusMaterialization(
      historyRequest(fixture.root, manifestPath, approval),
      fixture.port,
    );
    if (expected === "pass")
      expect(result).toEqual({ status: "pass", mode: "history", digest, diagnostics: [] });
    else expect(result).toMatchObject({ status: "fail", diagnostics: [{ code: expected }] });
  } finally {
    await fixture.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
