import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const defaultBaselineRef = "9add1e445841b67b8f36cf035590026ff2198000";
const sourceRoots = new Map([
  ["--typing", "temp/ts/typing"],
  ["--typeguard", "temp/ts/typeguard"],
  ["--assert", "temp/ts/assert"],
]);
const allowedBlobModes = new Set(["100644", "100755"]);

function reject(message, exitCode) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function canonicalRepository(input) {
  const resolved = resolve(input);
  let details;
  try {
    details = lstatSync(resolved);
  } catch {
    reject(`Repository directory is unavailable: ${resolved}`, 67);
  }
  if (details.isSymbolicLink() || !details.isDirectory()) {
    reject(`Repository must be a non-symbolic-link directory: ${resolved}`, 68);
  }

  let canonical;
  try {
    canonical = realpathSync(resolved);
  } catch {
    reject(`Repository cannot be canonicalized: ${resolved}`, 69);
  }
  if (canonical !== resolved || !statSync(canonical).isDirectory()) {
    reject(`Repository path is not canonical: ${resolved}`, 69);
  }

  const gitDirectory = join(canonical, ".git");
  try {
    const gitDetails = lstatSync(gitDirectory);
    if (gitDetails.isSymbolicLink() || !gitDetails.isDirectory()) {
      reject(`Repository .git must be a directory: ${gitDirectory}`, 68);
    }
  } catch {
    reject(`Repository .git directory is unavailable: ${gitDirectory}`, 67);
  }
  return canonical;
}

function gitOutput(repository, arguments_, failureExit) {
  const result = spawnSync("git", ["-C", repository, ...arguments_], { encoding: null });
  if (result.error !== undefined || result.status !== 0 || result.stdout === undefined) {
    reject(`Git command failed: git ${arguments_.join(" ")}`, failureExit);
  }
  return result.stdout;
}

function parseTreeRecord(record, sourceRoot) {
  const parsed = /^(?<mode>[0-7]{6}) (?<type>[^ ]+) (?<object>[0-9a-f]+)\t(?<path>.+)$/u.exec(record);
  if (parsed?.groups === undefined) reject("Invalid git ls-tree record.", 75);

  const { mode, object, path, type } = parsed.groups;
  if (mode === "120000") reject("Symbolic-link tree entry is forbidden.", 71);
  if (mode === "160000") reject("Gitlink tree entry is forbidden.", 72);
  if (type !== "blob") reject("Non-blob tree entry is forbidden.", 73);
  if (!allowedBlobModes.has(mode)) reject(`Unexpected blob mode: ${mode}`, 74);
  if (!/^[0-9a-f]{40,64}$/u.test(object)) reject("Invalid Git object identifier.", 75);
  if (
    isAbsolute(path) ||
    path.includes("\0") ||
    !path.startsWith(`${sourceRoot}/`) ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    reject("Baseline tree contained an invalid path.", 75);
  }
  return path;
}

const arguments_ = process.argv.slice(2);
let repositoryInput = process.cwd();
let baselineRef = defaultBaselineRef;
let selector;

for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index];
  if (argument === "--repo" || argument === "--ref") {
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) reject(`Expected a value after ${argument}.`, 64);
    if (argument === "--repo") repositoryInput = value;
    else baselineRef = value;
    index += 1;
  } else if (sourceRoots.has(argument) && selector === undefined) {
    selector = argument;
  } else if (sourceRoots.has(argument)) {
    reject("Extra source selector is forbidden.", 65);
  } else if (selector !== undefined) {
    reject("Extra argument is forbidden.", 65);
  } else {
    reject("Arguments must be one selector plus optional --repo and --ref values.", 66);
  }
}

if (selector === undefined) reject("Expected exactly one source selector.", 64);
if (isAbsolute(baselineRef) || baselineRef.includes("\0")) reject("Baseline ref is invalid.", 66);

const sourceRoot = sourceRoots.get(selector);
if (sourceRoot === undefined) reject("Selector must be --typing, --typeguard, or --assert.", 66);
const repository = canonicalRepository(repositoryInput);
const records = gitOutput(repository, ["ls-tree", "-r", "-z", baselineRef, "--", sourceRoot], 70)
  .toString("utf8")
  .split("\0")
  .filter((record) => record.length > 0);

if (records.length === 0) reject(`No baseline files found below ${sourceRoot}.`, 76);
const paths = records.map((record) => parseTreeRecord(record, sourceRoot)).sort();
if (new Set(paths).size !== paths.length) reject("Baseline tree contains duplicate paths.", 75);

process.stdout.write("sha256\tpath\n");
for (const path of paths) {
  const contents = gitOutput(repository, ["show", `${baselineRef}:${path}`], 77);
  const hash = createHash("sha256").update(contents).digest("hex");
  process.stdout.write(`${hash}\t${path}\n`);
}
