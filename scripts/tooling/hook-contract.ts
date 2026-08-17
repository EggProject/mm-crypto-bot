import { readFile } from "node:fs/promises";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- This URL is a fixed repository configuration path.
const hookConfig = await readFile(new URL("../../lefthook.yml", import.meta.url), "utf8");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- This URL is a fixed repository configuration path.
const packageConfig = await readFile(new URL("../../package.json", import.meta.url), "utf8");

if (!hookConfig.includes("bun run hook:pre-commit")) {
  throw new Error("Lefthook must invoke the repository pre-commit pipeline.");
}
if (!packageConfig.includes('"hook:pre-commit"')) {
  throw new Error("The pre-commit pipeline script is missing.");
}
if (!packageConfig.includes('"lefthook": "2.1.10"')) {
  throw new Error("Lefthook must be exact-pinned.");
}

process.stdout.write("Lefthook configuration contract is valid.\n");
