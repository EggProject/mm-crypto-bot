import { describe, expect, it } from "bun:test";

import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  ArbLatencyBoundaryError,
  assertExactCcxtNumberMode,
  calculatePositiveMonotonicElapsedNanoseconds,
  captureMonotonicNanoseconds,
  createExactCcxtConstructorOptions,
  decodeExactCcxtTicker,
  defaultMonotonicClock,
  parseExactArbLatencyCliNumericInput,
  type ArbLatencyBoundaryErrorCode,
} from "./arb-latency-exact-boundary.js";

function expectBoundaryFailure(action: () => unknown, code: ArbLatencyBoundaryErrorCode): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ArbLatencyBoundaryError);
    if (error instanceof ArbLatencyBoundaryError) {
      expect(error.code).toBe(code);
      return;
    }
  }
  throw new Error(`Expected ArbLatencyBoundaryError with code ${code}.`);
}

function cliInput(
  overrides: Readonly<
    Partial<{
      readonly tradeNotionalUsd: unknown;
      readonly minSpreadBps: unknown;
      readonly durationMs: unknown;
      readonly rttIntervalMs: unknown;
    }>
  > = {},
): {
  readonly tradeNotionalUsd: unknown;
  readonly minSpreadBps: unknown;
  readonly durationMs: unknown;
  readonly rttIntervalMs: unknown;
} {
  return {
    tradeNotionalUsd: "1000",
    minSpreadBps: "0",
    durationMs: "30000",
    rttIntervalMs: "500",
    ...overrides,
  };
}

describe("arb latency exact boundary", () => {
  it("parses canonical CLI financial strings and safe infrastructure durations without rounding", () => {
    const input = parseExactArbLatencyCliNumericInput(
      cliInput({ minSpreadBps: "1.25", rttIntervalMs: "9007199254740991", tradeNotionalUsd: "1000.01" }),
    );

    expect(input.tradeNotionalUsd).toBeInstanceOf(ExactRational);
    expect(input.tradeNotionalUsd.toSnapshot()).toMatchObject({ denominator: "100", numerator: "100001" });
    expect(input.minSpreadBps.toSnapshot()).toMatchObject({ denominator: "4", numerator: "5" });
    expect(input.durationMs).toBe(30_000);
    expect(input.rttIntervalMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(input.forcedDisconnectAtMs).toBe(15_000);
    expect(input.source).toEqual({
      tradeNotionalUsd: "1000.01",
      minSpreadBps: "1.25",
      durationMs: "30000",
      rttIntervalMs: "9007199254740991",
    });
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.source)).toBe(true);
  });

  it.each(["", " 1", "1 ", "+1", "01", "1.0", "1e3", "-0"])(
    "rejects non-canonical trade notionals: %s",
    (tradeNotionalUsd) => {
      expectBoundaryFailure(
        () => parseExactArbLatencyCliNumericInput(cliInput({ tradeNotionalUsd })),
        "CLI_NOTIONAL",
      );
    },
  );

  it.each(["0", "-1", "-0.1"])("rejects non-positive trade notionals: %s", (tradeNotionalUsd) => {
    expectBoundaryFailure(
      () => parseExactArbLatencyCliNumericInput(cliInput({ tradeNotionalUsd })),
      "CLI_NOTIONAL",
    );
  });

  it.each(["", " 1", "+1", "01", "1.0", "1e3", "-0.1"])(
    "rejects invalid minimum spreads: %s",
    (minSpreadBps) => {
      expectBoundaryFailure(
        () => parseExactArbLatencyCliNumericInput(cliInput({ minSpreadBps })),
        "CLI_MIN_SPREAD",
      );
    },
  );

  it.each([
    ["0", "CLI_DURATION"],
    ["999", "CLI_DURATION"],
    ["1001", "CLI_DURATION"],
    ["1.5", "CLI_DURATION"],
    ["01", "CLI_DURATION"],
    ["1e3", "CLI_DURATION"],
    ["9007199254740992", "CLI_DURATION"],
  ] as const)("rejects invalid durations: %s", (durationMs, code) => {
    expectBoundaryFailure(() => parseExactArbLatencyCliNumericInput(cliInput({ durationMs })), code);
  });

  it.each(["0", "1.5", "01", "1e3", "9007199254740992"])(
    "rejects invalid RTT intervals: %s",
    (rttIntervalMs) => {
      expectBoundaryFailure(
        () => parseExactArbLatencyCliNumericInput(cliInput({ rttIntervalMs })),
        "CLI_RTT_INTERVAL",
      );
    },
  );

  it("rejects missing, non-string, accessor, and throwing proxy CLI fields", () => {
    expectBoundaryFailure(() => parseExactArbLatencyCliNumericInput(undefined), "CLI_NOTIONAL");
    const nullInput: unknown = JSON.parse("null");
    expectBoundaryFailure(() => parseExactArbLatencyCliNumericInput(nullInput), "CLI_NOTIONAL");
    expectBoundaryFailure(() => parseExactArbLatencyCliNumericInput([]), "CLI_NOTIONAL");
    expectBoundaryFailure(() => parseExactArbLatencyCliNumericInput({}), "CLI_NOTIONAL");
    expectBoundaryFailure(
      () => parseExactArbLatencyCliNumericInput(cliInput({ tradeNotionalUsd: 1000 })),
      "CLI_NOTIONAL",
    );
    expectBoundaryFailure(
      () => parseExactArbLatencyCliNumericInput(cliInput({ durationMs: 30_000 })),
      "CLI_DURATION",
    );
    expectBoundaryFailure(
      () =>
        parseExactArbLatencyCliNumericInput({
          ...cliInput(),
          get tradeNotionalUsd(): unknown {
            return "1000";
          },
        }),
      "CLI_NOTIONAL",
    );
    const throwingProxy = new Proxy(cliInput(), {
      getOwnPropertyDescriptor: () => {
        throw new Error("proxy trap");
      },
    });
    expectBoundaryFailure(() => parseExactArbLatencyCliNumericInput(throwingProxy), "CLI_NOTIONAL");
  });

  it("decodes padded CCXT string prices as positive exact rationals", () => {
    const ticker = decodeExactCcxtTicker({ ask: "100.5000", bid: "99.0100" });

    expect(ticker.bid.toSnapshot()).toMatchObject({ denominator: "100", numerator: "9901" });
    expect(ticker.ask.toSnapshot()).toMatchObject({ denominator: "2", numerator: "201" });
    expect(ticker.source).toEqual({ bid: "99.01", ask: "100.5" });
    expect(Object.isFrozen(ticker)).toBe(true);
    expect(Object.isFrozen(ticker.source)).toBe(true);
  });

  it.each([
    [{ bid: 1, ask: "1" }],
    [{ bid: undefined, ask: "1" }],
    [{ bid: "1e3", ask: "1" }],
    [{ bid: "0", ask: "1" }],
    [{ bid: "-1", ask: "1" }],
    [{ bid: "1", ask: 1 }],
    [{ bid: "1", ask: "0" }],
    [{ bid: "1", ask: "-1" }],
  ])("rejects invalid CCXT transport scalars", (ticker) => {
    expectBoundaryFailure(() => decodeExactCcxtTicker(ticker), "CCXT_TICKER");
  });

  it("rejects CCXT ticker accessors and throwing proxies", () => {
    expectBoundaryFailure(
      () =>
        decodeExactCcxtTicker({
          get bid(): unknown {
            return "1";
          },
          ask: "1",
        }),
      "CCXT_TICKER",
    );
    expectBoundaryFailure(
      () =>
        decodeExactCcxtTicker({
          bid: "1",
          set ask(_value: unknown) {
            void _value;
          },
        }),
      "CCXT_TICKER",
    );
    const throwingProxy = new Proxy(
      { ask: "1", bid: "1" },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("proxy trap");
        },
      },
    );
    expectBoundaryFailure(() => decodeExactCcxtTicker(throwingProxy), "CCXT_TICKER");
  });

  it("creates and verifies the exact CCXT String number mode", () => {
    const options = createExactCcxtConstructorOptions();

    expect(options).toEqual({ number: String });
    expect(Object.isFrozen(options)).toBe(true);
    expect(() => {
      assertExactCcxtNumberMode({ number: String });
    }).not.toThrow();
    expectBoundaryFailure(() => {
      assertExactCcxtNumberMode({ number: Number });
    }, "CCXT_NUMBER_MODE");
    expectBoundaryFailure(() => {
      assertExactCcxtNumberMode({});
    }, "CCXT_NUMBER_MODE");
    expectBoundaryFailure(() => {
      assertExactCcxtNumberMode({
        get number(): unknown {
          return String;
        },
      });
    }, "CCXT_NUMBER_MODE");
  });

  it("captures a bigint default monotonic endpoint and calculates a positive elapsed duration", () => {
    expect(typeof captureMonotonicNanoseconds(defaultMonotonicClock)).toBe("bigint");
    expect(Object.isFrozen(defaultMonotonicClock)).toBe(true);

    const clock = {
      nowNanoseconds: (): bigint => 4n,
    };
    expect(captureMonotonicNanoseconds(clock)).toBe(4n);
    expect(calculatePositiveMonotonicElapsedNanoseconds(4n, 9n)).toBe(5n);
  });

  it("fails closed for invalid injected monotonic clocks", () => {
    expectBoundaryFailure(() => captureMonotonicNanoseconds({}), "MONOTONIC_CLOCK");
    expectBoundaryFailure(
      () => captureMonotonicNanoseconds({ nowNanoseconds: (): string => "1" }),
      "MONOTONIC_CLOCK",
    );
    expectBoundaryFailure(
      () => captureMonotonicNanoseconds({ nowNanoseconds: "not-a-function" }),
      "MONOTONIC_CLOCK",
    );
    expectBoundaryFailure(
      () =>
        captureMonotonicNanoseconds({
          nowNanoseconds: (): bigint => {
            throw new Error("clock failure");
          },
        }),
      "MONOTONIC_CLOCK",
    );
    expectBoundaryFailure(
      () => captureMonotonicNanoseconds({ nowNanoseconds: (): bigint => -1n }),
      "MONOTONIC_CLOCK",
    );
    const throwingProxy = new Proxy(
      { nowNanoseconds: (): bigint => 1n },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("proxy trap");
        },
      },
    );
    expectBoundaryFailure(() => captureMonotonicNanoseconds(throwingProxy), "MONOTONIC_CLOCK");
  });

  it("fails closed for invalid monotonic elapsed endpoints", () => {
    expectBoundaryFailure(() => calculatePositiveMonotonicElapsedNanoseconds("1", 2n), "MONOTONIC_ELAPSED");
    expectBoundaryFailure(() => calculatePositiveMonotonicElapsedNanoseconds(1n, "2"), "MONOTONIC_ELAPSED");
    expectBoundaryFailure(() => calculatePositiveMonotonicElapsedNanoseconds(-1n, 1n), "MONOTONIC_ELAPSED");
    expectBoundaryFailure(() => calculatePositiveMonotonicElapsedNanoseconds(1n, -1n), "MONOTONIC_ELAPSED");
    expectBoundaryFailure(() => calculatePositiveMonotonicElapsedNanoseconds(1n, 1n), "MONOTONIC_ELAPSED");
    expectBoundaryFailure(() => calculatePositiveMonotonicElapsedNanoseconds(2n, 1n), "MONOTONIC_ELAPSED");
  });
});
