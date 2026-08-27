/**
 * `CliRouter` unit tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { CLI_COMMAND, CliRouter, type CliContext, type SubcommandHandler } from "./router.js";

const handlerReturningZero: SubcommandHandler = () => Promise.resolve(0);
const handlerReturningSeven: SubcommandHandler = () => Promise.resolve(7);

describe("CliRouter", () => {
  let captured: string[] = [];
  let previousConsoleError = console.error;

  beforeEach(() => {
    captured = [];
    previousConsoleError = console.error;
    console.error = (...values: unknown[]) => {
      captured.push(values.map((value) => (typeof value === "string" ? value : String(value))).join(" "));
    };
  });

  afterEach(() => {
    console.error = previousConsoleError;
  });

  it("routes a registered subcommand to its handler", async () => {
    const router = new CliRouter();
    let wasCalled = false;
    let receivedContext: CliContext | undefined;
    const handler: SubcommandHandler = (_arguments, context) => {
      wasCalled = true;
      receivedContext = context;
      return Promise.resolve(0);
    };
    router.register("fake", "Fake subcommand for tests", handler);
    const code = await router.run(["fake"]);
    expect(code).toBe(0);
    expect(wasCalled).toBe(true);
    const configFreeContext: CliContext = {};
    expect(configFreeContext.config).toBeUndefined();
    expect(receivedContext).toEqual(configFreeContext);
    expect(Object.hasOwn(receivedContext ?? {}, "config")).toBe(false);
  });

  it("returns 1 and prints help when no subcommand is given", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", handlerReturningZero);
    const code = await router.run([]);
    expect(code).toBe(1);
    const helpText = captured.join("\n");
    expect(helpText).toContain(CLI_COMMAND);
    expect(helpText).toContain("fake");
  });

  it("returns 1 and prints an error for unknown subcommands", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", handlerReturningZero);
    const code = await router.run(["nonexistent"]);
    expect(code).toBe(1);
    const helpText = captured.join("\n");
    expect(helpText).toContain("Unknown subcommand");
    expect(helpText).toContain("nonexistent");
  });

  it("returns 1 and prints global help when --help is set with no subcommand", async () => {
    const router = new CliRouter();
    let wasCalled = false;
    const handler: SubcommandHandler = () => {
      wasCalled = true;
      return Promise.resolve(0);
    };
    router.register("fake", "Fake subcommand for tests", handler);
    const code = await router.run(["--help"]);
    expect(code).toBe(1);
    expect(wasCalled).toBe(false);
    expect(captured.join("\n")).toContain("Usage");
  });

  it("returns 1 and prints global help when -h is set with no subcommand", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", handlerReturningZero);
    const code = await router.run(["-h"]);
    expect(code).toBe(1);
    expect(captured.join("\n")).toContain("Usage");
  });

  it("dispatches --help to the handler for a known subcommand", async () => {
    const router = new CliRouter();
    let hasReceivedHelpFlag = false;
    const handler: SubcommandHandler = (arguments_) => {
      hasReceivedHelpFlag = arguments_.flags.get("help") === true;
      return Promise.resolve(0);
    };
    router.register("start", "Start the bot", handler);
    const code = await router.run(["start", "--help"]);
    expect(code).toBe(0);
    expect(hasReceivedHelpFlag).toBe(true);
  });

  it("returns 1 and prints global help when --help is on an unknown subcommand", async () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", handlerReturningZero);
    const code = await router.run(["nonexistent", "--help"]);
    expect(code).toBe(1);
    expect(captured.join("\n")).toContain("Usage");
  });

  it("honors setProgramDescription", async () => {
    const router = new CliRouter();
    router.setProgramDescription("custom description");
    router.register("fake", "fake", handlerReturningZero);
    const code = await router.run([]);
    expect(code).toBe(1);
    expect(captured.join("\n")).toContain("custom description");
  });

  it("overwrites a previously registered handler when re-registered", async () => {
    const router = new CliRouter();
    router.register("fake", "first", handlerReturningZero);
    router.register("fake", "second", handlerReturningSeven);
    const code = await router.run(["fake"]);
    expect(code).toBe(7);
  });

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
    expect(receivedFlagValue).toBe("20");
    expect(receivedPositionalLength).toBe(1);
  });

  it("lists subcommands alphabetically in help", async () => {
    const router = new CliRouter();
    router.register("zebra", "Z subcommand", handlerReturningZero);
    router.register("alpha", "A subcommand", handlerReturningZero);
    router.register("middle", "M subcommand", handlerReturningZero);
    await router.run([]);
    const helpText = captured.join("\n");
    const alphaIndex = helpText.indexOf("alpha");
    const middleIndex = helpText.indexOf("middle");
    const zebraIndex = helpText.indexOf("zebra");
    expect(alphaIndex).toBeGreaterThan(-1);
    expect(middleIndex).toBeGreaterThan(alphaIndex);
    expect(zebraIndex).toBeGreaterThan(middleIndex);
  });

  it("printHelp with a known subcommand prints subcommand-specific help", () => {
    const router = new CliRouter();
    router.register("start", "Start the bot", handlerReturningZero);
    router.printHelp("start");
    const helpText = captured.join("\n");
    expect(helpText).toContain(`Usage: ${CLI_COMMAND} start`);
    expect(helpText).toContain("Start the bot");
    expect(helpText).toContain("--config=<path>");
    expect(helpText).toContain("requires an external runtime root if omitted");
    expect(helpText).not.toContain("uses defaults if absent");
  });

  it("printHelp with an unknown subcommand prints an error and global help", () => {
    const router = new CliRouter();
    router.register("fake", "Fake subcommand for tests", handlerReturningZero);
    router.printHelp("nonexistent");
    const helpText = captured.join("\n");
    expect(helpText).toContain("Unknown subcommand");
    expect(helpText).toContain("nonexistent");
    expect(helpText).toContain("fake");
  });

  it("SubcommandHandler is an exported function type alias", () => {
    expect(typeof handlerReturningZero).toBe("function");
  });

  it("prints ordered global help for many subcommands", () => {
    const router = new CliRouter();
    for (let index = 0; index < 20; index++) {
      const name = `cmd-${String(index).padStart(2, "0")}`;
      router.register(name, `Description ${String(index)}`, handlerReturningZero);
    }
    router.printHelp("");
    expect(captured.length).toBeGreaterThan(0);
  });
});
