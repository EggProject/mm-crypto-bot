import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { dropBotE2eCredentialsFromProcessEnvironment as dropCredentialsFromProcessEnvironment } from "./bot-e2e-child-environment.ts";
import { createBotE2EPreloadRuntimeState, installBotE2EPreloadRuntime } from "./bot-e2e-preload-runtime.ts";
import { REPOSITORY_ROOT } from "./bot-runtime-scope.ts";
import { installOutboundNetworkGuard } from "./bot-runtime-network-guard.ts";

const state = createBotE2EPreloadRuntimeState();

installBotE2EPreloadRuntime(
  {
    dropCredentials: dropCredentialsFromProcessEnvironment,
    environment: process.env,
    exitCodeTarget: process,
    getCoverage: () => {
      const coverage: unknown = Object.getOwnPropertyDescriptor(globalThis, "__coverage__")?.value;
      return coverage;
    },
    installNetworkGuard: installOutboundNetworkGuard,
    mkdir: mkdirSync,
    processId: process.pid,
    registerBeforeExit: (listener) => {
      process.once("beforeExit", listener);
    },
    registerExit: (listener) => {
      process.once("exit", listener);
    },
    repositoryRoot: REPOSITORY_ROOT,
    resolvePath: path.resolve.bind(path),
    writeFile: writeFileSync.bind(undefined),
    writeStandardError: process.stderr.write.bind(process.stderr),
  },
  state,
);
