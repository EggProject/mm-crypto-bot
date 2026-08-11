/* eslint-disable security/detect-non-literal-fs-filename -- isolated test temp directories */
import { afterEach, describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const requireFromTest = createRequire(import.meta.url);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("patched glob/minimatch dependency compatibility", () => {
  it("ESLint's minimatch 10 consumer expands braces with its compatible dependency", () => {
    const requireFromEslint = createRequire(requireFromTest.resolve("eslint"));
    const minimatch = requireFromEslint("minimatch") as {
      minimatch: (input: string, pattern: string) => boolean;
    };
    expect(minimatch.minimatch("src/a.ts", "src/{a,b}.ts")).toBe(true);
    expect(minimatch.minimatch("src/c.ts", "src/{a,b}.ts")).toBe(false);
  });

  it("NYC's legacy glob/minimatch consumer expands braces with patched 1.x", () => {
    const root = mkdtempSync(join(tmpdir(), "minimatch-compat-"));
    temporaryRoots.push(root);
    writeFileSync(join(root, "alpha.txt"), "a");
    writeFileSync(join(root, "beta.txt"), "b");
    writeFileSync(join(root, "gamma.txt"), "c");

    const requireFromNyc = createRequire(requireFromTest.resolve("nyc"));
    const glob = requireFromNyc("glob") as {
      sync: (pattern: string, options: { readonly cwd: string }) => string[];
    };
    expect(glob.sync("{alpha,beta}.txt", { cwd: root }).sort()).toEqual([
      "alpha.txt",
      "beta.txt",
    ]);
  });

  it("Istanbul's test-exclude consumer accepts brace include patterns", () => {
    const root = mkdtempSync(join(tmpdir(), "test-exclude-compat-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "src"));

    const requireFromPlugin = createRequire(requireFromTest.resolve("babel-plugin-istanbul"));
    const TestExclude = requireFromPlugin("test-exclude") as new (options: {
      readonly cwd: string;
      readonly include: readonly string[];
      readonly exclude: readonly string[];
    }) => { shouldInstrument: (file: string) => boolean };
    const exclude = new TestExclude({
      cwd: root,
      include: ["src/{a,b}.ts"],
      exclude: [],
    });
    expect(exclude.shouldInstrument(join(root, "src", "a.ts"))).toBe(true);
    expect(exclude.shouldInstrument(join(root, "src", "c.ts"))).toBe(false);
  });
});
