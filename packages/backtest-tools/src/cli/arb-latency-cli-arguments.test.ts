import { ExactRational } from "@mm-crypto-bot/numeric";
import { describe, expect, it } from "vitest";

import {
  ArbLatencyCliArgumentsError,
  parseExactArbLatencyCliArguments,
} from "./arb-latency-cli-arguments.js";
import { ArbLatencyBoundaryError } from "./arb-latency-exact-boundary.js";

const requiredExchanges = ["--exchange-a=binance", "--exchange-b=bybit"] as const;

function parse(...tokens: readonly string[]): ReturnType<typeof parseExactArbLatencyCliArguments> {
  return parseExactArbLatencyCliArguments([...requiredExchanges, ...tokens]);
}

function expectConfigFailure(action: () => unknown): ArbLatencyCliArgumentsError {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ArbLatencyCliArgumentsError);
    if (error instanceof ArbLatencyCliArgumentsError) {
      expect(error.code).toBe("INVALID_ARB_LATENCY_CLI_ARGUMENTS");
      expect(error.message).toBe("Arbitrage latency CLI configuration is invalid.");
      return error;
    }
  }
  throw new TypeError("Expected arbitrage-latency CLI configuration parsing to fail.");
}

describe("parseExactArbLatencyCliArguments", () => {
  it("returns a frozen default exact configuration", () => {
    const result = parseExactArbLatencyCliArguments(requiredExchanges);

    expect(result).toMatchObject({
      durationMs: 30_000,
      exchangeA: "binance",
      exchangeB: "bybit",
      measureReconnect: true,
      outputPath: "arb-latency-sample.json",
      rttIntervalMs: 500,
      symbol: "BTC/USDT",
    });
    expect(result.minSpreadBps.equals(ExactRational.from(5n))).toBe(true);
    expect(result.tradeNotionalUsd.equals(ExactRational.from(10_000n))).toBe(true);
    expect(result.source).toEqual({
      durationMs: "30000",
      minSpreadBps: "5",
      rttIntervalMs: "500",
      tradeNotionalUsd: "10000",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.source)).toBe(true);
  });

  it("parses explicit exact string tokens without conversion", () => {
    const result = parse(
      "--symbol=ETH2/USDT1",
      "--duration-ms=30002",
      "--rtt-interval-ms=700",
      "--min-spread-bps=1.25",
      "--trade-notional-usd=10000.01",
      "--output=results/arb.json",
      "--no-reconnect",
    );

    expect(result).toMatchObject({
      durationMs: 30_002,
      measureReconnect: false,
      outputPath: "results/arb.json",
      rttIntervalMs: 700,
      symbol: "ETH2/USDT1",
    });
    expect(result.minSpreadBps.equals(ExactRational.from("1.25"))).toBe(true);
    expect(result.tradeNotionalUsd.equals(ExactRational.from("10000.01"))).toBe(true);
    expect(result.source).toEqual({
      durationMs: "30002",
      minSpreadBps: "1.25",
      rttIntervalMs: "700",
      tradeNotionalUsd: "10000.01",
    });
  });

  it("accepts the reconnect option regardless of token order", () => {
    expect(parse("--measure-reconnect").measureReconnect).toBe(true);
    expect(
      parseExactArbLatencyCliArguments(["--no-reconnect", "--exchange-b=bybit", "--exchange-a=binance"])
        .measureReconnect,
    ).toBe(false);
  });

  it.each([
    [undefined],
    [["--exchange-a=binance", "--exchange-b=bybit", 1]],
    [["--exchange-a=binance"]],
    [["--exchange-a=binance", "--exchange-b=binance"]],
    [["--exchange-a=unknown", "--exchange-b=bybit"]],
    [["--exchange-a=binance", "--exchange-b=bybit", "symbol"]],
    [["--exchange-a=binance", "--exchange-b=bybit", "--symbol"]],
    [["--exchange-a=binance", "--exchange-b=bybit", "--unknown=value"]],
    [["--exchange-a=binance", "--exchange-b=bybit", "--measure-reconnect=true"]],
    [["--exchange-a=binance", "--exchange-b=bybit", "--measure-reconnect", "--no-reconnect"]],
    [["--exchange-a=binance", "--exchange-b=bybit", "--measure-reconnect", "--measure-reconnect"]],
    [["--exchange-a=binance", "--exchange-a=kucoin", "--exchange-b=bybit"]],
  ])("rejects malformed, unknown, conflicting, or duplicate tokens", (tokens) => {
    expectConfigFailure(() => parseExactArbLatencyCliArguments(tokens));
  });

  it.each([
    "",
    "/USDT",
    "BTC/",
    "BTC//USDT",
    "btc/USDT",
    "BTC/USDT!",
    "BTC/USDT/USDC",
    "BTC/USDT\u{0}",
    "BTC/USDT\n",
  ])("rejects unsafe symbols: %j", (symbol) => {
    expectConfigFailure(() => parse(`--symbol=${symbol}`));
  });

  it.each([
    "",
    "results/arb\u{0}.json",
    "/tmp/arb.json",
    "//server/share/arb.json",
    "C:/temp/arb.json",
    String.raw`C:\temp\arb.json`,
    "results/./arb.json",
    "results/../arb.json",
  ])("rejects non-relative output paths: %j", (outputPath) => {
    expectConfigFailure(() => parse(`--output=${outputPath}`));
  });

  it.each([
    ["--duration-ms=999", "CLI_DURATION"],
    ["--rtt-interval-ms=0", "CLI_RTT_INTERVAL"],
    ["--min-spread-bps=-1", "CLI_MIN_SPREAD"],
    ["--trade-notional-usd=0", "CLI_NOTIONAL"],
  ] as const)("preserves numeric boundary failures for %s", (token, code) => {
    const error = expectConfigFailure(() => parse(token));

    expect(error.cause).toBeInstanceOf(ArbLatencyBoundaryError);
    if (!(error.cause instanceof ArbLatencyBoundaryError)) {
      throw new TypeError("Expected a preserved numeric boundary error.");
    }
    expect(error.cause.code).toBe(code);
  });
});
