import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

type YamlRecord = Record<string, unknown>;

const readRepoFile = (relativePath: string): Promise<string> =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test input is a fixed repository-relative workflow path declared in this file.
  readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const requireRecord = (value: unknown, description: string): YamlRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${description} to be a YAML mapping`);
  }
  return value;
};

const requireString = (record: YamlRecord, key: string, description: string): string => {
  const value = Reflect.get(record, key);
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${description}.${key} to be a string`);
  }
  return value;
};

const requireSteps = (job: YamlRecord): readonly YamlRecord[] => {
  const steps = job.steps;
  if (!Array.isArray(steps)) {
    throw new TypeError("Expected format job steps to be a YAML sequence");
  }
  return steps.map((step, index) => requireRecord(step, `format job step ${String(index)}`));
};

const findActionStep = (steps: readonly YamlRecord[], action: string): YamlRecord => {
  for (const step of steps) {
    if (step.uses === action) {
      return step;
    }
  }
  throw new TypeError(`Expected format job to use ${action}`);
};

test("CI format job uses the pinned toolchain and checks formatting from a frozen install", async () => {
  const workflow = requireRecord(
    Bun.YAML.parse(await readRepoFile(".github/workflows/ci.yml")),
    "CI workflow",
  );
  const jobs = requireRecord(workflow.jobs, "CI workflow jobs");
  const formatJob = requireRecord(jobs.format, "CI format job");
  const steps = requireSteps(formatJob);

  expect(requireString(formatJob, "name", "CI format job")).toBe("Format");
  expect(steps.map((step) => step.run).filter((run): run is string => typeof run === "string")).toEqual([
    "bun install --frozen-lockfile",
    "bun run format:check",
  ]);

  const bunSetup = findActionStep(steps, "oven-sh/setup-bun@v2");
  const bunSetupWith = requireRecord(bunSetup.with, "Bun setup");
  expect(requireString(bunSetupWith, "bun-version-file", "Bun setup")).toBe(".bun-version");

  const nodeSetup = findActionStep(steps, "actions/setup-node@v4");
  const nodeSetupWith = requireRecord(nodeSetup.with, "Node setup");
  expect(requireString(nodeSetupWith, "node-version-file", "Node setup")).toBe(".nvmrc");
  expect(findActionStep(steps, "actions/checkout@v4")).toBeDefined();
});
