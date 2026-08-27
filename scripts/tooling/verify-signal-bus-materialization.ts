import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type SignalBusMaterializationVerificationRequest,
  verifySignalBusMaterialization,
} from "./signal-bus-materialization-verifier";

class InvocationFailure extends Error {}

const optionNames = new Set([
  "mode",
  "toolchain-root",
  "candidate-root",
  "manifest",
  "role",
  "brief",
  "base",
  "approval",
]);

function invocation(isValid: boolean): void {
  if (!isValid) throw new InvocationFailure("invalid signal-bus-materialization invocation");
}

export function parseSignalBusMaterializationArguments(
  arguments_: readonly string[],
): SignalBusMaterializationVerificationRequest {
  const values = new Map<string, string>();
  for (const argument of arguments_) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (match === null) throw new InvocationFailure("invalid signal-bus-materialization invocation");
    const [, name = "", value = ""] = match;
    invocation(optionNames.has(name) && !values.has(name));
    values.set(name, value);
  }
  const mode = values.get("mode");
  if (mode !== "baseline" && mode !== "candidate" && mode !== "history")
    throw new InvocationFailure("invalid signal-bus-materialization invocation");
  const role = values.get("role");
  if (role !== "active" && role !== "exact")
    throw new InvocationFailure("invalid signal-bus-materialization invocation");
  const toolchainRoot = values.get("toolchain-root");
  const candidateRoot = values.get("candidate-root");
  const manifestPath = values.get("manifest");
  if (
    toolchainRoot === undefined ||
    candidateRoot === undefined ||
    manifestPath === undefined ||
    !path.isAbsolute(toolchainRoot) ||
    !path.isAbsolute(candidateRoot) ||
    !path.isAbsolute(manifestPath)
  )
    throw new InvocationFailure("invalid signal-bus-materialization invocation");
  const base = values.get("base");
  if (base === undefined || !/^[a-f0-9]{40}$/u.test(base))
    throw new InvocationFailure("invalid signal-bus-materialization invocation");
  const approval = values.get("approval");
  if (
    mode === "history" ? approval === undefined || !/^[a-f0-9]{40}$/u.test(approval) : approval !== undefined
  )
    throw new InvocationFailure("invalid signal-bus-materialization invocation");
  const brief = values.get("brief");
  if (brief !== undefined && !/^[A-Z][A-Z0-9-]{2,127}$/u.test(brief))
    throw new InvocationFailure("invalid signal-bus-materialization invocation");
  return {
    mode,
    toolchainRoot,
    candidateRoot,
    manifestPath,
    role,
    base,
    ...(brief !== undefined && { brief }),
    ...(approval !== undefined && { approval }),
  };
}

export async function runSignalBusMaterializationCli(arguments_: readonly string[]): Promise<number> {
  let request: SignalBusMaterializationVerificationRequest;
  try {
    request = parseSignalBusMaterializationArguments(arguments_);
  } catch {
    process.stderr.write("signal-bus-materialization:invocation\n");
    return 2;
  }
  const result = await verifySignalBusMaterialization(request);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === "pass" ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void runSignalBusMaterializationCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
