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

  // --------------------------------------------------------------------------
  // 16) Bare `--` (no name) becomes positional
  // --------------------------------------------------------------------------
  it("treats a bare `--` followed by nothing as no-op sentinel", () => {
    const result = parseArgv(["start", "--"]);
    expect(result.subcommand).toBe("start");
    expect(result.positional).toEqual([]);
  });

  it("treats a bare `--` alone (no subcommand) as empty subcommand", () => {
    const result = parseArgv(["--"]);
    expect(result.subcommand).toBe("");
    expect(result.positional).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 17) Bundled short flags (-abc) become positional
  // --------------------------------------------------------------------------
  it("treats bundled short flags (-abc) as positional", () => {
    const result = parseArgv(["start", "-abc"]);
    expect(result.subcommand).toBe("start");
    expect(result.positional).toEqual(["-abc"]);
  });

  it("treats bundled short flag with no subcommand as the subcommand", () => {
    // No silent drop: -abc alone becomes the subcommand.
    const result = parseArgv(["-abc"]);
    expect(result.subcommand).toBe("-abc");
  });

  it("treats malformed long flag with no subcommand as the subcommand", () => {
    // No silent drop: --foo!bar alone becomes the subcommand.
    const result = parseArgv(["--foo!bar"]);
    expect(result.subcommand).toBe("--foo!bar");
  });

  // --------------------------------------------------------------------------
  // 18) Single-char short flag (not -h) recorded as bare letter
  // --------------------------------------------------------------------------
  it("records single-char short flag -v (not -h) as bare letter", () => {
    const result = parseArgv(["start", "-v"]);
    expect(result.flags.get("v")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 19) Malformed long flag (name fails regex) becomes positional
  // --------------------------------------------------------------------------
  it("treats malformed long flag (special chars) as positional", () => {
    // `!` is not in [a-zA-Z0-9_-] so the name regex rejects it.
    const result = parseArgv(["start", "--foo!bar"]);
    expect(result.subcommand).toBe("start");
    expect(result.positional).toEqual(["--foo!bar"]);
  });

  // --------------------------------------------------------------------------
  // 20) Malformed --no-X (X empty or invalid chars) → no silent drop
  // --------------------------------------------------------------------------
  it("treats --no- (3 chars, body='no-') as flag with name 'no-' (regex match)", () => {
    // `no-` is a valid name per the regex [a-zA-Z0-9_-]+, so this is
    // interpreted as a flag named "no-" with value true.
    const result = parseArgv(["start", "--no-"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.get("no-")).toBe(true);
    expect(result.positional).toEqual([]);
  });

  it("treats --no-foo! (invalid name chars) as positional (not silent drop)", () => {
    // Previously this was silently dropped. After the bug fix, it falls
    // through to the malformed-flag branch and becomes positional.
    const result = parseArgv(["start", "--no-foo!"]);
    expect(result.subcommand).toBe("start");
    expect(result.positional).toEqual(["--no-foo!"]);
  });

  // --------------------------------------------------------------------------
  // 21) Malformed --name=foo (name invalid) becomes positional
  // --------------------------------------------------------------------------
  it("treats --=value (empty name) as positional (not silent drop)", () => {
    // Previously this was silently dropped. After the bug fix, it falls
    // through to the malformed-flag branch and becomes positional.
    const result = parseArgv(["start", "--=value"]);
    expect(result.subcommand).toBe("start");
    expect(result.positional).toEqual(["--=value"]);
  });

  // --------------------------------------------------------------------------
  // 22) --flag followed by another --flag → first is boolean, second is its own
  // --------------------------------------------------------------------------
  it("treats --flag --other as two booleans (not flag with --other as value)", () => {
    const result = parseArgv(["start", "--foo", "--bar"]);
    expect(result.flags.get("foo")).toBe(true);
    expect(result.flags.get("bar")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 23) --no-foo! (regex-failing name) doesn't get parsed as flag
  // --------------------------------------------------------------------------
  it("--no-foo (no exclamation) does parse as negation", () => {
    const result = parseArgv(["start", "--no-foo"]);
    expect(result.flags.get("foo")).toBe(false);
  });
});
