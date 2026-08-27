import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";

import {
  type CanonicalMaterializationRecord,
  VerificationFailure,
  createCanonicalDigest,
  isWithinMaterializationLineLimit,
  parseMaterializationManifest,
  toSafeRepoRelativePath,
} from "./signal-bus-materialization-contract";
import {
  createTemporarySignalBusRepo,
  createSignalBusModifiedBaselinePort,
  createSignalBusVerificationPort,
  runBuiltDirectSignalBusVerifier,
  runDirectSignalBusVerifier,
  signalBusFullIdentity,
  signalBusGitOutput,
  signalBusManifest,
  signalBusVerificationBase,
  signalBusVerificationRequest,
  signalBusVerificationRequestWithoutBase,
  writeSignalBusManifest,
} from "./signal-bus-materialization-test-support";
import { type SignalBusMaterializationGitPort } from "./signal-bus-materialization-git";
import { verifySignalBusMaterialization } from "./signal-bus-materialization-verifier";
import {
  parseSignalBusMaterializationArguments,
  runSignalBusMaterializationCli,
} from "./verify-signal-bus-materialization";
test("orders final records and hashes tab-delimited bytes", () => {
  const digest = createCanonicalDigest([
    {
      operation: "M",
      path: toSafeRepoRelativePath("z.ts"),
      blobIdentity: "git:1111111111111111111111111111111111111111",
    },
    { operation: "D", path: toSafeRepoRelativePath("a.ts"), blobIdentity: "absent" },
  ]);
  expect(digest.records.map((record) => record.path)).toEqual(["a.ts", "z.ts"]);
  expect(digest.value).toMatch(/^sha256:[a-f0-9]{64}$/u);
});
test.each(["/x.ts", "x/../y.ts", String.raw`x\y.ts`, "x\ty.ts", "x\ny.ts", "x y.ts"])(
  "rejects unsafe path %j",
  (unsafePath) => {
    expect(() => toSafeRepoRelativePath(unsafePath)).toThrow(VerificationFailure);
  },
);
test("rejects empty and non-bijective manifests", () => {
  expect(() =>
    parseMaterializationManifest({ schemaVersion: 1, role: "active", materializations: [] }, "active"),
  ).toThrow(VerificationFailure);
  expect(() =>
    parseMaterializationManifest(
      {
        schemaVersion: 1,
        role: "active",
        materializations: [
          {
            role: "active",
            path: "a.ts",
            owner: "owner",
            allowedOperation: "create",
            prerequisite: [],
            brief: "ABC",
          },
          {
            role: "active",
            path: "a.ts",
            owner: "owner",
            allowedOperation: "create",
            prerequisite: [],
            brief: "DEF",
          },
        ],
      },
      "active",
    ),
  ).toThrow(VerificationFailure);
});
test.each([500, 501])("accepts only the 500-line boundary", (lineCount) => {
  expect(isWithinMaterializationLineLimit(lineCount)).toBe(lineCount === 500);
});
const validEntry = {
  role: "active",
  path: "governed/entry.ts",
  owner: "owner",
  allowedOperation: "create",
  prerequisite: [],
  brief: "ABC",
};
test("freezes a canonical manifest with its validated entries", () => {
  const manifest = parseMaterializationManifest(
    { schemaVersion: 1, role: "active", materializations: [validEntry] },
    "active",
  );
  expect(Object.isFrozen(manifest)).toBe(true);
  expect(Object.isFrozen(manifest.materializations)).toBe(true);
  expect(Object.isFrozen(manifest.materializations[0] ?? {})).toBe(true);
});
test.each([
  undefined,
  { schemaVersion: 2, role: "active", materializations: [validEntry] },
  { schemaVersion: 1, role: "exact", materializations: [validEntry] },
  { schemaVersion: 1, role: "active", materializations: "wrong" },
  { schemaVersion: 1, role: "active", materializations: [{ ...validEntry, role: "exact" }] },
  { schemaVersion: 1, role: "active", materializations: [{ ...validEntry, allowedOperation: "rename" }] },
  { schemaVersion: 1, role: "active", materializations: [{ ...validEntry, prerequisite: "ABC" }] },
  { schemaVersion: 1, role: "active", materializations: [{ ...validEntry, owner: "Owner" }] },
  { schemaVersion: 1, role: "active", materializations: [{ ...validEntry, brief: "a" }] },
  { schemaVersion: 1, role: "active", materializations: [{ ...validEntry, prerequisite: ["ABC"] }] },
  { schemaVersion: 1, role: "active", materializations: [{ ...validEntry, prerequisite: ["DEF"] }] },
])("fails closed for invalid manifest boundary %#", (input) => {
  expect(() => parseMaterializationManifest(input, "active")).toThrow(VerificationFailure);
});

test("rejects duplicate JSON keys before parsing the manifest", () => {
  expect(() =>
    parseMaterializationManifest(
      '{"schemaVersion":1,"schemaVersion":1,"role":"active","materializations":[]}',
      "active",
    ),
  ).toThrow(VerificationFailure);
});

test("reports malformed JSON string escapes as a typed verification failure", () => {
  expect(() =>
    parseMaterializationManifest(
      String.raw`{"schemaVersion":1,"role":"active","materializations":[],"extra":"\q"}`,
      "active",
    ),
  ).toThrow(VerificationFailure);
});

test.each(["", "entry/", "entry//child", ".entry", "entry/.child", "entry/..", "entry/child/", "entry/é.ts"])(
  "rejects every invalid path grammar edge %#",
  (unsafePath) => {
    expect(() => toSafeRepoRelativePath(unsafePath)).toThrow(VerificationFailure);
  },
);

test.each(["{", "[", "true false", '{"schemaVersion" 1}', '{"schemaVersion":1,}'])(
  "reports malformed JSON syntax %#",
  (input) => {
    expect(() => parseMaterializationManifest(input, "active")).toThrow(VerificationFailure);
  },
);

test.each([
  '"unterminated',
  String.raw`"\q"`,
  "\u{22}\u{1}\u{22}",
  "{}",
  "[]",
  "null",
  '{"schemaVersion":1 "role":"active"}',
  "[1 2]",
])("rejects every strict JSON parser boundary %#", (input) => {
  expect(() => parseMaterializationManifest(input, "active")).toThrow(VerificationFailure);
});

test("rejects a manifest role outside the two canonical roles", () => {
  expect(() =>
    parseMaterializationManifest(
      { schemaVersion: 1, role: "inactive", materializations: [validEntry] },
      "active",
    ),
  ).toThrow(VerificationFailure);
});

test.each([
  { schemaVersion: 1, role: "active", materializations: [validEntry], extra: true },
  [],
  undefined,
  { schemaVersion: 1, role: "active", materializations: [{ ...validEntry, extra: true }] },
  { schemaVersion: 1, role: "active", materializations: [{ ...validEntry, path: 1 }] },
  { schemaVersion: 1, role: "active", materializations: [{ ...validEntry, prerequisite: ["DEF", "DEF"] }] },
])("rejects strict manifest shape boundaries %#", (input) => {
  expect(() => parseMaterializationManifest(input, "active")).toThrow(VerificationFailure);
});

const invalidCanonicalRecords: readonly (readonly CanonicalMaterializationRecord[])[] = [
  [],
  [{ operation: "A", path: "unsafe path", blobIdentity: "git:1111111111111111111111111111111111111111" }],
  [{ operation: "D", path: "entry.ts", blobIdentity: "git:1111111111111111111111111111111111111111" }],
  [{ operation: "A", path: "entry.ts", blobIdentity: "absent" }],
  [
    { operation: "A", path: "entry.ts", blobIdentity: "git:1111111111111111111111111111111111111111" },
    { operation: "M", path: "entry.ts", blobIdentity: "git:2222222222222222222222222222222222222222" },
  ],
];

for (const [index, records] of invalidCanonicalRecords.entries()) {
  test(`rejects invalid canonical records ${index.toString()}`, () => {
    expect(() => createCanonicalDigest(records)).toThrow(VerificationFailure);
  });
}

test.each([-1, 1.5, Infinity, NaN])("rejects an invalid physical line count %#", (lineCount) => {
  expect(isWithinMaterializationLineLimit(lineCount)).toBe(false);
});

test("returns a redacted unexpected diagnostic when a public port throws", async () => {
  const port: SignalBusMaterializationGitPort = {
    canonicalize: () => Promise.reject(new Error("untrusted port failure")),
    run: () => Promise.resolve(signalBusGitOutput("")),
    snapshot: () =>
      Promise.resolve({
        bytes: new Uint8Array(),
        exists: false,
        identity: "",
        isRegularFile: false,
        isStable: true,
      }),
    inspect: () => Promise.resolve({ identity: "", isRegularFile: false, exists: false }),
  };
  await expect(
    verifySignalBusMaterialization(
      {
        mode: "candidate",
        toolchainRoot: "/toolchain",
        candidateRoot: "/candidate",
        manifestPath: "/manifest",
        role: "active",
        base: "a".repeat(40),
      },
      port,
    ),
  ).resolves.toEqual({
    status: "fail",
    mode: "candidate",
    diagnostics: [{ code: "unexpected", message: "signal-bus-materialization:unexpected" }],
  });
});

test.each([
  signalBusVerificationRequest({ candidateRoot: "/toolchain" }),
  signalBusVerificationRequest({ manifestPath: "/toolchain/manifest" }),
])("rejects canonical root and manifest containment ambiguity %#", async (request) => {
  await expect(
    verifySignalBusMaterialization(request, createSignalBusVerificationPort()),
  ).resolves.toMatchObject({ status: "fail" });
});

test.each([
  createSignalBusVerificationPort({ rootOutput: "/wrong-root" }),
  createSignalBusVerificationPort({ sourceExists: false }),
  createSignalBusVerificationPort({ manifestExists: false }),
  createSignalBusVerificationPort({ manifestChanges: true }),
])("fails closed for root, source, and immutable-manifest proof failures %#", async (port) => {
  await expect(verifySignalBusMaterialization(signalBusVerificationRequest(), port)).resolves.toMatchObject({
    status: "fail",
  });
});

test("rejects a manifest snapshot that changed during its single nofollow read", async () => {
  await expect(
    verifySignalBusMaterialization(
      signalBusVerificationRequest(),
      createSignalBusVerificationPort({
        manifestChanges: true,
        entryStates: [{ identity: `git:${signalBusFullIdentity}`, isRegularFile: true, exists: true }],
      }),
    ),
  ).resolves.toMatchObject({ status: "fail", diagnostics: [{ code: "manifest-file" }] });
});

test.each([
  [
    signalBusVerificationRequest({ mode: "baseline" }),
    createSignalBusVerificationPort({
      canonicalize: (input) =>
        input.endsWith("signal-bus-materialization-verifier.ts") ? "/outside/verifier.ts" : input,
    }),
  ],
  [
    signalBusVerificationRequest({ mode: "baseline" }),
    createSignalBusVerificationPort({
      entryStates: [
        { identity: `git:${signalBusFullIdentity}`, isRegularFile: true, exists: true },
        { identity: "", isRegularFile: false, exists: true },
      ],
    }),
  ],
  [
    signalBusVerificationRequest({ mode: "baseline" }),
    createSignalBusVerificationPort({
      entryStates: [{ identity: `git:${signalBusFullIdentity}`, isRegularFile: true, exists: true }],
      entryText: "x\n".repeat(501),
    }),
  ],
  [
    signalBusVerificationRequest({ mode: "baseline" }),
    createSignalBusVerificationPort({ statusExitCode: 1 }),
  ],
] as const)("fails closed for runtime binding and baseline snapshot boundaries %#", async (request, port) => {
  await expect(verifySignalBusMaterialization(request, port)).resolves.toMatchObject({ status: "fail" });
});

test("accepts an empty baseline governed file snapshot", async () => {
  const result = await verifySignalBusMaterialization(
    signalBusVerificationRequest({ mode: "baseline" }),
    createSignalBusModifiedBaselinePort(""),
  );
  expect(result).toMatchObject({ status: "pass" });
});

test.each(["entry", "x\n".repeat(501)])(
  "checks nonempty baseline snapshot line limits %#",
  async (entryText) => {
    const result = await verifySignalBusMaterialization(
      signalBusVerificationRequest({ mode: "baseline" }),
      createSignalBusModifiedBaselinePort(entryText),
    );
    expect(result.status).toBe(entryText === "entry" ? "pass" : "fail");
  },
);

test("rejects a nonregular baseline snapshot after its regular state proof", async () => {
  const result = await verifySignalBusMaterialization(
    signalBusVerificationRequest({ mode: "baseline" }),
    createSignalBusModifiedBaselinePort(undefined, { identity: "", isRegularFile: false, exists: true }),
  );
  expect(result).toMatchObject({ status: "fail", diagnostics: [{ code: "governed-non-regular" }] });
});

const baselineRequestWithoutBase = signalBusVerificationRequestWithoutBase({ mode: "baseline" });
const candidateRequestWithoutBase = signalBusVerificationRequestWithoutBase();
const historyRequestWithoutBase = signalBusVerificationRequestWithoutBase({
  mode: "history",
  approval: signalBusVerificationBase,
});

test.each([
  [signalBusVerificationRequest({ base: "bad" }), createSignalBusVerificationPort()],
  [baselineRequestWithoutBase, createSignalBusVerificationPort()],
  [candidateRequestWithoutBase, createSignalBusVerificationPort()],
  [historyRequestWithoutBase, createSignalBusVerificationPort()],
  [signalBusVerificationRequest({ mode: "history" }), createSignalBusVerificationPort()],
  [signalBusVerificationRequest({}), createSignalBusVerificationPort({ mergeBaseExitCode: 1 })],
  [signalBusVerificationRequest({ brief: "DEF" }), createSignalBusVerificationPort()],
  [
    signalBusVerificationRequest({ manifestPath: "/manifest" }),
    createSignalBusVerificationPort({
      manifestText: signalBusManifest([
        { path: "governed/a.ts", allowedOperation: "create" },
        { path: "governed/b.ts", allowedOperation: "create", brief: "DEF" },
      ]),
    }),
  ],
] as const)("fails closed for base and brief selection boundaries %#", async (request, port) => {
  await expect(verifySignalBusMaterialization(request, port)).resolves.toMatchObject({ status: "fail" });
});

test("rejects duplicate, unknown, mode-incompatible, and non-absolute options", async () => {
  await expect(runSignalBusMaterializationCli(["--mode=candidate", "--mode=history"])).resolves.toBe(2);
});

test("runs the direct CLI entry point and maps malformed input to exit two", async () => {
  await expect(runDirectSignalBusVerifier(["--mode=candidate"])).resolves.toEqual({
    exitCode: 2,
    stderr: "signal-bus-materialization:invocation\n",
  });
});

test("runs malformed built CLI artifact when its path contains a space", async () => {
  await expect(runBuiltDirectSignalBusVerifier(["--mode=candidate"])).resolves.toEqual({
    exitCode: 2,
    stderr: "signal-bus-materialization:invocation\n",
  });
});

test("executes the direct CLI guard through its public entry module", async () => {
  const previousArgument = process.argv[1];
  const previousExitCode = process.exitCode;
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    process.argv[1] = new URL("verify-signal-bus-materialization.ts", import.meta.url).pathname;
    await import(new URL("verify-signal-bus-materialization.ts?direct-entry-coverage", import.meta.url).href);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(stderr).toHaveBeenCalledWith("signal-bus-materialization:invocation\n");
  } finally {
    stderr.mockRestore();
    if (previousArgument === undefined) process.argv.splice(1, 1);
    else process.argv[1] = previousArgument;
    process.exitCode = previousExitCode;
  }
});

test("parses the exact history invocation contract", () => {
  const identity = "a".repeat(40);
  expect(
    parseSignalBusMaterializationArguments([
      "--mode=history",
      "--toolchain-root=/toolchain",
      "--candidate-root=/candidate",
      "--manifest=/manifest.json",
      "--role=active",
      `--base=${identity}`,
      `--approval=${identity}`,
      "--brief=ABC",
    ]),
  ).toEqual({
    mode: "history",
    toolchainRoot: "/toolchain",
    candidateRoot: "/candidate",
    manifestPath: "/manifest.json",
    role: "active",
    base: identity,
    approval: identity,
    brief: "ABC",
  });
});

test("maps a well-formed verification failure to JSON stdout and exit one", async () => {
  const identity = "a".repeat(40);
  await expect(
    runSignalBusMaterializationCli([
      "--mode=candidate",
      `--toolchain-root=${process.cwd()}`,
      `--candidate-root=${process.cwd()}`,
      "--manifest=/tmp/nonexistent-signal-bus-materialization-manifest.json",
      "--role=active",
      `--base=${identity}`,
    ]),
  ).resolves.toBe(1);
});

test("maps a passing candidate verification to exit zero", async () => {
  const fixture = await createTemporarySignalBusRepo();
  const directory = await mkdtemp(path.join(tmpdir(), "signal-bus-cli-manifest-"));
  const manifestPath = path.join(directory, "manifest.json");
  const base = await fixture.head();
  await writeSignalBusManifest(manifestPath, [{ path: "governed/entry.ts", allowedOperation: "create" }]);
  await fixture.write("governed/entry.ts", "export const entry = true;\n");
  await expect(
    runSignalBusMaterializationCli([
      "--mode=candidate",
      `--toolchain-root=${process.cwd()}`,
      `--candidate-root=${fixture.root}`,
      `--manifest=${manifestPath}`,
      "--role=active",
      `--base=${base}`,
    ]),
  ).resolves.toBe(0);
  await fixture.dispose();
  await rm(directory, { recursive: true, force: true });
});

const invalidCliArguments: readonly (readonly string[])[] = [
  ["--mode=unsupported"],
  ["mode=candidate"],
  ["--unknown=value"],
  ["--mode=candidate", "--role=active"],
  ["--mode=candidate", "--toolchain-root=relative"],
  [
    "--mode=candidate",
    "--toolchain-root=/toolchain",
    "--candidate-root=/candidate",
    "--manifest=/manifest",
    "--role=wrong",
    `--base=${"a".repeat(40)}`,
  ],
  [
    "--mode=candidate",
    "--toolchain-root=/toolchain",
    "--candidate-root=/candidate",
    "--manifest=/manifest",
    "--role=active",
    "--base=wrong",
  ],
  [
    "--mode=candidate",
    "--toolchain-root=/toolchain",
    "--candidate-root=/candidate",
    "--manifest=/manifest",
    "--role=active",
    `--base=${"a".repeat(40)}`,
    `--approval=${"a".repeat(40)}`,
  ],
  ["--mode=history", "--approval=wrong"],
  [
    "--mode=candidate",
    "--toolchain-root=/toolchain",
    "--candidate-root=/candidate",
    "--manifest=/manifest",
    "--role=active",
    `--base=${"a".repeat(40)}`,
    "--brief=bad",
  ],
];
for (const [index, arguments_] of invalidCliArguments.entries())
  test(`rejects an incomplete or malformed CLI invocation ${index.toString()}`, () => {
    expect(() => parseSignalBusMaterializationArguments(arguments_)).toThrow();
  });
