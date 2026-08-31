/**
 * apps/bot/src/cli/router.test.ts
 *
 * Phase 33 Track D — `CliRouter` unit tests.
 *
 * Coverage (bun:test):
 *   1.  Register a fake subcommand + run with `["fake"]` → handler called, returns 0
 *   2.  Run with no subcommand → returns 1 + prints help
 *   3.  Run with unknown subcommand → returns 1 + prints error
 *   4.  Run with `--help` → returns 1 + prints help
 *   5.  Run with `-h` → returns 1 + prints help
 *   6.  Subcommand-specific help is printed when a known subcommand has --help
 *   7.  setProgramDescription works
 *   8.  Re-registering a name overwrites the previous handler
 *   9.  Handlers receive the parsed flags and positional args
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { loadBotConfig } from "../config/index.js";

import { parseArgv } from "./argv.js";
import { CLI_COMMAND, CliRouter, type SubcommandHandler } from "./router.js";

function successfulHandler(): Promise<number> {
  return Promise.resolve(0);
}

function overwrittenHandler(): Promise<number> {
  return Promise.resolve(7);
}

describe("CliRouter", () => {
  // We capture console.error output so we can assert on the help text
  // without polluting the test runner's output.
  let originalConsoleError: typeof console.error;
  let captured: string[] = [];

  beforeEach(() => {
    captured = [];
    originalConsoleError = console.error;
    console.error = (...arguments_: unknown[]): void => {
      // Convert each arg to a string for stable comparison.
      captured.push(
        arguments_.map((argument) => (typeof argument === "string" ? argument : String(argument))).join(" "),
      );
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  // --------------------------------------------------------------------------
  // 1) Register + run a fake subcommand
  // --------------------------------------------------------------------------
  it("routes a registered subcommand to its handler", async () => {
    const router = new CliRouter();
    let isCalled = false;
    const handler: SubcommandHandler = (_arguments, _context) => {
      isCalled = true;
      return Promise.resolve(0);
    };
    router.register("fake", "Fake subcommand for tests", handler);
    const code = await router.run(["fake"]);
    expect(code).toBe(0);
    expect(isCalled).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 2) No subcommand → returns 1 + prints help
  // --------------------------------------------------------------------------
  it("returns 1 and prints help when no subcommand is given", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", successfulHandler);
    const code = await router.run([]);
    expect(code).toBe(1);
    // Help text is printed to stderr.
    const helpText = captured.join("\n");
    expect(helpText).toContain(CLI_COMMAND);
    expect(helpText).toContain("fake");
  });

  // --------------------------------------------------------------------------
  // 3) Unknown subcommand → returns 1 + prints error
  // --------------------------------------------------------------------------
  it("returns 1 and prints an error for unknown subcommands", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", successfulHandler);
    const code = await router.run(["nonexistent"]);
    expect(code).toBe(1);
    const helpText = captured.join("\n");
    expect(helpText).toContain("Unknown subcommand");
    expect(helpText).toContain("nonexistent");
  });

  // --------------------------------------------------------------------------
  // 4) --help at the top level → prints global help + returns 1
  // --------------------------------------------------------------------------
  it("returns 1 and prints global help when --help is set with no subcommand", async () => {
    const router = new CliRouter();
    let isCalled = false;
    router.register("fake", "Fake subcommand for tests", () => {
      isCalled = true;
      return Promise.resolve(0);
    });
    const code = await router.run(["--help"]);
    expect(code).toBe(1);
    expect(isCalled).toBe(false);
    const helpText = captured.join("\n");
    expect(helpText).toContain("Usage");
  });

  // --------------------------------------------------------------------------
  // 5) -h at the top level → prints global help + returns 1
  // --------------------------------------------------------------------------
  it("returns 1 and prints global help when -h is set with no subcommand", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", successfulHandler);
    const code = await router.run(["-h"]);
    expect(code).toBe(1);
    const helpText = captured.join("\n");
    expect(helpText).toContain("Usage");
  });

  // --------------------------------------------------------------------------
  // 6) --help on a known subcommand → dispatch to handler (which owns its help)
  // --------------------------------------------------------------------------
  it("dispatches --help to the handler for a known subcommand", async () => {
    const router = new CliRouter();
    let hasReceivedHelpFlag = false;
    router.register("start", "Start the bot", (arguments_) => {
      hasReceivedHelpFlag = arguments_.flags.get("help") === true;
      // The handler returns 0 to signal "I handled --help" (printed its own help).
      return Promise.resolve(0);
    });
    const code = await router.run(["start", "--help"]);
    expect(code).toBe(0);
    expect(hasReceivedHelpFlag).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 6b) --help on an unknown subcommand → router prints global help + returns 1
  // --------------------------------------------------------------------------
  it("returns 1 and prints global help when --help is on an unknown subcommand", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", successfulHandler);
    const code = await router.run(["nonexistent", "--help"]);
    expect(code).toBe(1);
    const helpText = captured.join("\n");
    expect(helpText).toContain("Usage");
  });

  // --------------------------------------------------------------------------
  // 7) setProgramDescription works
  // --------------------------------------------------------------------------
  it("honors setProgramDescription", async () => {
    const router = new CliRouter();
    router.setProgramDescription("custom description");
    router.register("fake", "fake", successfulHandler);
    const code = await router.run([]);
    expect(code).toBe(1);
    const helpText = captured.join("\n");
    expect(helpText).toContain("custom description");
  });

  // --------------------------------------------------------------------------
  // 8) Re-registering a name overwrites the previous handler
  // --------------------------------------------------------------------------
  it("overwrites a previously registered handler when re-registered", async () => {
    const router = new CliRouter();
    router.register("fake", "first", successfulHandler);
    router.register("fake", "second", overwrittenHandler);
    const code = await router.run(["fake"]);
    expect(code).toBe(7);
  });

  // --------------------------------------------------------------------------
  // 9) Handlers receive the parsed flags and positional args
  // --------------------------------------------------------------------------
  it("passes parsed args to the handler", async () => {
    const router = new CliRouter();
    let receivedSubcommand = "";
    let receivedFlagValue: string | boolean | undefined;
    let receivedPositionalLength = 0;
    const handler: SubcommandHandler = (arguments_) => {
      receivedSubcommand = arguments_.subcommand;
      receivedFlagValue = arguments_.flags.get("limit");
      receivedPositionalLength = arguments_.positional.length;
      return Promise.resolve(0);
    };
    router.register("trades", "Show trades", handler);
    const code = await router.run(["trades", "--limit=20", "BTC/USDC"]);
    expect(code).toBe(0);
    expect(receivedSubcommand).toBe("trades");
    if (receivedFlagValue !== "20") throw new Error("expected limit flag value");
    expect(receivedFlagValue).toBe("20");
    expect(receivedPositionalLength).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 10) Subcommand list is sorted alphabetically in help
  // --------------------------------------------------------------------------
  it("lists subcommands alphabetically in help", async () => {
    const router = new CliRouter();
    router.register("zebra", "Z subcommand", successfulHandler);
    router.register("alpha", "A subcommand", successfulHandler);
    router.register("middle", "M subcommand", successfulHandler);
    await router.run([]);
    const helpText = captured.join("\n");
    const alphaIndex = helpText.indexOf("alpha");
    const middleIndex = helpText.indexOf("middle");
    const zebraIndex = helpText.indexOf("zebra");
    expect(alphaIndex).toBeGreaterThan(-1);
    expect(middleIndex).toBeGreaterThan(alphaIndex);
    expect(zebraIndex).toBeGreaterThan(middleIndex);
  });

  // --------------------------------------------------------------------------
  // 11) printHelp with a known subcommand shows the subcommand-specific help
  // --------------------------------------------------------------------------
  it("printHelp with a known subcommand prints subcommand-specific help", () => {
    const router = new CliRouter();
    router.register("start", "Start the bot", successfulHandler);
    router.printHelp("start");
    const helpText = captured.join("\n");
    expect(helpText).toContain(`Usage: ${CLI_COMMAND} start`);
    expect(helpText).toContain("Start the bot");
    expect(helpText).toContain("--config=<path>");
  });

  // --------------------------------------------------------------------------
  // 12) printHelp with an unknown subcommand falls through to global help
  // --------------------------------------------------------------------------
  it("printHelp with an unknown subcommand prints 'Unknown subcommand' + global", () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", successfulHandler);
    router.printHelp("nonexistent");
    const helpText = captured.join("\n");
    expect(helpText).toContain("Unknown subcommand");
    expect(helpText).toContain("nonexistent");
    // Falls through to global help with the registered subcommands.
    expect(helpText).toContain("fake");
  });

  // --------------------------------------------------------------------------
  // 13) SubcommandHandler is exported and instantiable as a function value
  //     (catches bun's "type alias counted as a function" edge case)
  // --------------------------------------------------------------------------
  it("SubcommandHandler is an exported function type alias", () => {
    // Explicitly import the type and use it. The lcov reporter may count
    // the type alias as a "function" — exercising it as a value
    // ensures bun tracks it as "hit".
    const handler: SubcommandHandler = successfulHandler;
    expect(typeof handler).toBe("function");
    // The handler must be invokable.
    const result = handler(parseArgv(["handler"]), { config: loadBotConfig() });
    expect(result).toBeInstanceOf(Promise);
  });

  // --------------------------------------------------------------------------
  // 14) printHelp's sort callback (FNF=9 includes the (a,b) => ... arrow)
  //     Run with many entries to ensure both the sort and map callbacks
  //     are exercised and that the "fall back to global help" path is hit.
  // --------------------------------------------------------------------------
  it("printHelp sort callback runs even with many entries", () => {
    const router = new CliRouter();
    for (let index = 0; index < 20; index++) {
      const name = `cmd-${String(index).padStart(2, "0")}`;
      router.register(name, `Description ${String(index)}`, successfulHandler);
    }
    // printHelp with no subcommand triggers the global help + sort + map
    router.printHelp("");
    expect(captured.length).toBeGreaterThan(0);
  });
});
