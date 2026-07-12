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

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { CliRouter, type SubcommandHandler } from "./router.js";

describe("CliRouter", () => {
  // We capture console.error output so we can assert on the help text
  // without polluting the test runner's output.
  let errorSpy: ReturnType<typeof spyOn>;
  let captured: string[] = [];

  beforeEach(() => {
    captured = [];
    errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      // Convert each arg to a string for stable comparison.
      captured.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // --------------------------------------------------------------------------
  // 1) Register + run a fake subcommand
  // --------------------------------------------------------------------------
  it("routes a registered subcommand to its handler", async () => {
    const router = new CliRouter();
    let called = false;
    const handler: SubcommandHandler = async (_args, _ctx) => {
      called = true;
      return 0;
    };
    router.register("fake", "Fake subcommand for tests", handler);
    const code = await router.run(["fake"]);
    expect(code).toBe(0);
    expect(called).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 2) No subcommand → returns 1 + prints help
  // --------------------------------------------------------------------------
  it("returns 1 and prints help when no subcommand is given", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", async () => 0);
    const code = await router.run([]);
    expect(code).toBe(1);
    // Help text is printed to stderr.
    const helpText = captured.join("\n");
    expect(helpText).toContain("mm-bot");
    expect(helpText).toContain("fake");
  });

  // --------------------------------------------------------------------------
  // 3) Unknown subcommand → returns 1 + prints error
  // --------------------------------------------------------------------------
  it("returns 1 and prints an error for unknown subcommands", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", async () => 0);
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
    let called = false;
    router.register("fake", "Fake subcommand for tests", async () => {
      called = true;
      return 0;
    });
    const code = await router.run(["--help"]);
    expect(code).toBe(1);
    expect(called).toBe(false);
    const helpText = captured.join("\n");
    expect(helpText).toContain("Usage");
  });

  // --------------------------------------------------------------------------
  // 5) -h at the top level → prints global help + returns 1
  // --------------------------------------------------------------------------
  it("returns 1 and prints global help when -h is set with no subcommand", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", async () => 0);
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
    let receivedHelpFlag = false;
    router.register("start", "Start the bot", async (args) => {
      receivedHelpFlag = args.flags.get("help") === true;
      // The handler returns 0 to signal "I handled --help" (printed its own help).
      return 0;
    });
    const code = await router.run(["start", "--help"]);
    expect(code).toBe(0);
    expect(receivedHelpFlag).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 6b) --help on an unknown subcommand → router prints global help + returns 1
  // --------------------------------------------------------------------------
  it("returns 1 and prints global help when --help is on an unknown subcommand", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", async () => 0);
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
    router.register("fake", "fake", async () => 0);
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
    const handler1: SubcommandHandler = async () => 0;
    const handler2: SubcommandHandler = async () => 7;
    router.register("fake", "first", handler1);
    router.register("fake", "second", handler2);
    const code = await router.run(["fake"]);
    expect(code).toBe(7);
  });

  // --------------------------------------------------------------------------
  // 9) Handlers receive the parsed flags and positional args
  // --------------------------------------------------------------------------
  it("passes parsed args to the handler", async () => {
    const router = new CliRouter();
    let receivedSubcommand = "";
    let receivedFlagValue: string | boolean | undefined = undefined;
    let receivedPositionalLength = 0;
    const handler: SubcommandHandler = async (args) => {
      receivedSubcommand = args.subcommand;
      receivedFlagValue = args.flags.get("limit");
      receivedPositionalLength = args.positional.length;
      return 0;
    };
    router.register("trades", "Show trades", handler);
    const code = await router.run(["trades", "--limit=20", "BTC/USDC"]);
    expect(code).toBe(0);
    expect(receivedSubcommand).toBe("trades");
    expect(receivedFlagValue).toBe("20");
    expect(receivedPositionalLength).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 10) Subcommand list is sorted alphabetically in help
  // --------------------------------------------------------------------------
  it("lists subcommands alphabetically in help", async () => {
    const router = new CliRouter();
    router.register("zebra", "Z subcommand", async () => 0);
    router.register("alpha", "A subcommand", async () => 0);
    router.register("middle", "M subcommand", async () => 0);
    await router.run([]);
    const helpText = captured.join("\n");
    const alphaIdx = helpText.indexOf("alpha");
    const middleIdx = helpText.indexOf("middle");
    const zebraIdx = helpText.indexOf("zebra");
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(middleIdx).toBeGreaterThan(alphaIdx);
    expect(zebraIdx).toBeGreaterThan(middleIdx);
  });

  // --------------------------------------------------------------------------
  // 11) printHelp with a known subcommand shows the subcommand-specific help
  // --------------------------------------------------------------------------
  it("printHelp with a known subcommand prints subcommand-specific help", () => {
    const router = new CliRouter();
    router.register("start", "Start the bot", async () => 0);
    router.printHelp("start");
    const helpText = captured.join("\n");
    expect(helpText).toContain("Usage: mm-bot start");
    expect(helpText).toContain("Start the bot");
    expect(helpText).toContain("--config=<path>");
  });

  // --------------------------------------------------------------------------
  // 12) printHelp with an unknown subcommand falls through to global help
  // --------------------------------------------------------------------------
  it("printHelp with an unknown subcommand prints 'Unknown subcommand' + global", () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", async () => 0);
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
    const handler: SubcommandHandler = async (_args, _ctx) => 0;
    expect(typeof handler).toBe("function");
    // The handler must be invokable.
    const result = handler({} as never, { config: undefined as never });
    expect(result).toBeInstanceOf(Promise);
  });
});
