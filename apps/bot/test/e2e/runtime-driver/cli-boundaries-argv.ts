import { parseArgv } from "../../../src/cli/argv.js";

import { assertCondition } from "./runtime-driver-core.js";

export function runCliBoundaries(): void {
  for (const argv of [
    [],
    ["start", "--config=foo"],
    ["start", "--help"],
    ["start", "--config="],
    ["start", "-x"],
    ["-abc"],
    ["start", "--foo!bar"],
    ["start", "--no-"],
    ["start", "--no-!"],
    ["start", "--=value"],
    ["start", "--foo", "--bar"],
    ["start", "--", "literal"],
    ["start", "--limit", "10"],
    ["--malformed!"],
    ["start", "-abc"],
    ["-h"],
  ])
    parseArgv(argv);
  const representative = parseArgv(["config", "validate", "--config=/external/config.toml"]);
  assertCondition(representative.subcommand === "config", "CLI boundary driver lost the subcommand");
  assertCondition(representative.positional[0] === "validate", "CLI boundary driver lost positional input");
}
