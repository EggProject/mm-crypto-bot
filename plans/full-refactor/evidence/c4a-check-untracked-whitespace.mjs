import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";

function reject(message, exitCode) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function canonicalDirectory(path, unavailableExit, invalidExit) {
  const resolved = resolve(path);
  let details;
  try {
    details = lstatSync(resolved);
  } catch {
    reject(`Directory is unavailable: ${resolved}`, unavailableExit);
  }
  if (details.isSymbolicLink() || !details.isDirectory()) {
    reject(`Directory must be non-symbolic-link: ${resolved}`, invalidExit);
  }
  const canonical = realpathSync(resolved);
  if (canonical !== resolved || !statSync(canonical).isDirectory()) {
    reject(`Directory is not canonical: ${resolved}`, invalidExit);
  }
  return canonical;
}

function canonicalRegularFile(path, missingExit, invalidExit) {
  const resolved = resolve(path);
  let details;
  try {
    details = lstatSync(resolved);
  } catch {
    reject(`Missing path: ${resolved}`, missingExit);
  }
  if (details.isSymbolicLink() || !details.isFile()) {
    reject(`Path must be a non-symbolic-link regular file: ${resolved}`, invalidExit);
  }
  const canonical = realpathSync(resolved);
  if (!statSync(canonical).isFile()) reject(`Path is not a regular file: ${resolved}`, invalidExit);
  return canonical;
}

function contains(root, target) {
  const pathToTarget = relative(root, target);
  return pathToTarget.length > 0 && !pathToTarget.startsWith("..") && !isAbsolute(pathToTarget);
}

function validateRelativePath(path) {
  if (path.length === 0 || path.includes("\0") || isAbsolute(path)) {
    reject(`Manifest path is invalid: ${path}`, 70);
  }
  if (normalize(path) !== path || path.split("/").some((part) => part === "." || part === "..")) {
    reject(`Manifest path is not normalized: ${path}`, 71);
  }
}

function validateAllowedPath(path) {
  const packagePath = /^(?:packages\/(?:typing|typeguard|assert)\/)/u.test(path);
  const evidencePath = /^plans\/full-refactor\/evidence\/c4a-[^/]+$/u.test(path);
  if (!packagePath && !evidencePath) reject(`Path is outside the C4a manifest scope: ${path}`, 72);
}

function noSymbolicLinkComponents(repository, path) {
  let current = repository;
  for (const component of path.split("/")) {
    current = join(current, component);
    let details;
    try {
      details = lstatSync(current);
    } catch {
      reject(`Missing path component: ${current}`, 73);
    }
    if (details.isSymbolicLink()) reject(`Symbolic-link component is forbidden: ${current}`, 74);
  }
  return current;
}

const arguments_ = process.argv.slice(2);
if (arguments_.length === 0) reject("Expected --manifest <path>.", 64);
if (arguments_.length !== 2) reject("Expected exactly --manifest <path>.", 65);
if (arguments_[0] !== "--manifest") reject("First argument must be --manifest.", 66);

const repository = canonicalDirectory(process.cwd(), 67, 68);
const allowedRoots = [
  "packages/typing",
  "packages/typeguard",
  "packages/assert",
  "plans/full-refactor/evidence",
].map((path) => canonicalDirectory(join(repository, path), 67, 68));
const manifestPath = canonicalRegularFile(arguments_[1], 69, 70);
const lines = readFileSync(manifestPath, "utf8").split("\n");
if (lines.at(-1) === "") lines.pop();
if (lines.length === 0 || lines.some((path) => path.length === 0) || new Set(lines).size !== lines.length) {
  reject("Manifest must contain one or more unique nonempty paths.", 69);
}

for (const path of lines) {
  validateRelativePath(path);
  validateAllowedPath(path);
  const candidate = noSymbolicLinkComponents(repository, path);
  const target = canonicalRegularFile(candidate, 73, 75);
  if (!allowedRoots.some((root) => contains(root, target))) {
    reject(`Path escapes the C4a roots: ${path}`, 76);
  }
  const result = spawnSync("git", ["diff", "--no-index", "--check", "/dev/null", target], {
    cwd: repository,
    encoding: "utf8",
  });
  if (
    result.error !== undefined ||
    result.status !== 1 ||
    result.stdout.length > 0 ||
    result.stderr.length > 0
  ) {
    reject(`Unexpected whitespace result for ${path}.`, 77);
  }
}

const trackedResult = spawnSync("git", ["diff", "--check"], { cwd: repository, encoding: "utf8" });
if (
  trackedResult.error !== undefined ||
  trackedResult.status !== 0 ||
  trackedResult.stdout.length > 0 ||
  trackedResult.stderr.length > 0
) {
  reject("Tracked diff whitespace check failed.", 78);
}

process.stdout.write(`checked=${lines.length} untracked_exit=1 diagnostics=0 tracked_exit=0\n`);
