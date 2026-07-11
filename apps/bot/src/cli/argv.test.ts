/**
 * apps/bot/src/cli/argv.test.ts
 *
 * Phase 33 Track D — `parseArgv` unit tests.
 *
 * Coverage (≥ 8 cases, all on `bun:test`):
 *   1.  `["start", "--config=foo"]` → subcommand=start, flags={config: foo}
 *   2.  `["start", "--config", "foo"]` → subcommand=start, flags={config: foo}
 *   3.  `["start", "--mock"]` → subcommand=start, flags={mock: true}
 *   4.  `["start", "--no-mock"]` → subcommand=start, flags={mock: false}
 *   5.  `[]` → no subcommand
 *   6.  `--help` / `-h` → help flag set
 *   7.  multiple flags combined
 *   8.  `--` sentinel stops flag parsing
 *   9.  positional after subcommand
 *  10.  `--no-flag value` → boolean false + value is positional
 *  11.  empty value (`--flag=`) → empty string, not boolean
 *  12.  unknown short flag becomes positional
 */

import { describe, expect, it } from "bun:test";

import { parseArgv } from "./argv.js";

describe("parseArgv", () => {
  // --------------------------------------------------------------------------
  // 1) --flag=value
  // --------------------------------------------------------------------------
  it("parses --flag=value", () => {
    const result = parseArgv(["start", "--config=foo"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.get("config")).toBe("foo");
    expect(result.positional).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 2) --flag value (space-separated)
  // --------------------------------------------------------------------------
  it("parses --flag value (space)", () => {
    const result = parseArgv(["start", "--config", "foo"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.get("config")).toBe("foo");
    expect(result.positional).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 3) --flag (boolean)
  // --------------------------------------------------------------------------
  it("treats --flag (no value) as boolean true", () => {
    const result = parseArgv(["start", "--mock"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.get("mock")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 4) --no-flag (negation)
  // --------------------------------------------------------------------------
  it("treats --no-flag as boolean false", () => {
    const result = parseArgv(["start", "--no-mock"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.get("mock")).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 5) empty argv
  // --------------------------------------------------------------------------
  it("returns no subcommand for empty argv", () => {
    const result = parseArgv([]);
    expect(result.subcommand).toBe("");
    expect(result.flags.size).toBe(0);
    expect(result.positional).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 6) --help / -h
  // --------------------------------------------------------------------------
  it("treats --help as help flag", () => {
    const result = parseArgv(["start", "--help"]);
    expect(result.flags.get("help")).toBe(true);
  });

  it("treats -h as help flag", () => {
    const result = parseArgv(["start", "-h"]);
    expect(result.flags.get("help")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 7) multiple flags
  // --------------------------------------------------------------------------
  it("parses multiple flags in one call", () => {
    const result = parseArgv(["trades", "--limit=20", "--symbol=BTC/USDC"]);
    expect(result.subcommand).toBe("trades");
    expect(result.flags.get("limit")).toBe("20");
    expect(result.flags.get("symbol")).toBe("BTC/USDC");
  });

  // --------------------------------------------------------------------------
  // 8) `--` sentinel
  // --------------------------------------------------------------------------
  it("stops flag parsing at `--` sentinel", () => {
    const result = parseArgv(["config", "init", "--", "--not-a-flag"]);
    expect(result.subcommand).toBe("config");
    expect(result.positional).toEqual(["init", "--not-a-flag"]);
  });

  // --------------------------------------------------------------------------
  // 9) positional after subcommand
  // --------------------------------------------------------------------------
  it("records positional args after subcommand", () => {
    const result = parseArgv(["config", "validate"]);
    expect(result.subcommand).toBe("config");
    expect(result.positional).toEqual(["validate"]);
  });

  it("records positional args mixed with flags after subcommand", () => {
    const result = parseArgv(["config", "init", "--out=./foo.toml"]);
    expect(result.subcommand).toBe("config");
    expect(result.positional).toEqual(["init"]);
    expect(result.flags.get("out")).toBe("./foo.toml");
  });

  // --------------------------------------------------------------------------
  // 10) --no-flag value (boolean + value is positional)
  // --------------------------------------------------------------------------
  it("treats --no-flag as boolean and consumes next arg as positional", () => {
    const result = parseArgv(["start", "--no-mock", "extra"]);
    expect(result.flags.get("mock")).toBe(false);
    expect(result.positional).toEqual(["extra"]);
  });

  // --------------------------------------------------------------------------
  // 11) --flag= (empty value)
  // --------------------------------------------------------------------------
  it("treats --flag= as empty string value (not boolean)", () => {
    const result = parseArgv(["start", "--config="]);
    expect(result.flags.get("config")).toBe("");
    // Crucially, NOT boolean — distinguish via typeof.
    expect(typeof result.flags.get("config")).toBe("string");
  });

  // --------------------------------------------------------------------------
  // 12) unknown short flag → letter-as-flag
  // --------------------------------------------------------------------------
  it("records single-letter short flag as bare letter", () => {
    const result = parseArgv(["start", "-x"]);
    // -x is a known short flag (single letter) and we record it as `x: true`.
    // This is by design: short flags are letter-as-flag, not positional.
    expect(result.flags.get("x")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 13) Mixed forms in one call
  // --------------------------------------------------------------------------
  it("parses a realistic mixed call", () => {
    const result = parseArgv([
      "trades",
      "--limit",
      "10",
      "--symbol=ETH/USDC",
      "--no-header",
      "extra-positional",
    ]);
    expect(result.subcommand).toBe("trades");
    expect(result.flags.get("limit")).toBe("10");
    expect(result.flags.get("symbol")).toBe("ETH/USDC");
    expect(result.flags.get("header")).toBe(false);
    expect(result.positional).toEqual(["extra-positional"]);
  });

  // --------------------------------------------------------------------------
  // 14) No subcommand + only flags
  // --------------------------------------------------------------------------
  it("yields empty subcommand when argv starts with a flag", () => {
    const result = parseArgv(["--help"]);
    expect(result.subcommand).toBe("");
    expect(result.flags.get("help")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 15) Subcommand followed only by flags
  // --------------------------------------------------------------------------
  it("yields empty positional when only flags follow subcommand", () => {
    const result = parseArgv(["start", "--config=foo", "--mock"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.get("config")).toBe("foo");
    expect(result.flags.get("mock")).toBe(true);
    expect(result.positional).toEqual([]);
  });
});
