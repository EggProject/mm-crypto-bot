import { describe, expect, it } from "bun:test";

import { SelectedLeverage } from "@mm-crypto-bot/numeric";

import { asSymbol } from "./symbols.js";
import {
  SpotMarginAuthorizationError,
  SpotMarginAuthorizer,
  type SpotMarginAuthorizationClient,
  type SpotMarginClock,
} from "./spot-margin-authorization.js";

class TestClock implements SpotMarginClock {
  constructor(private value: number) {}

  nowUtcMs(): number {
    return this.value;
  }

  set(value: number): void {
    this.value = value;
  }
}

class TestClient implements SpotMarginAuthorizationClient {
  constructor(
    private readonly status: unknown = enabledStatus(),
    private readonly quota: unknown = availableQuota(),
  ) {}

  getSpotMarginState(): Promise<unknown> {
    return Promise.resolve(this.status);
  }

  setSpotMarginLeverage(_input: Readonly<{ leverage: string }>): Promise<unknown> {
    return Promise.resolve(successEnvelope());
  }

  getBorrowQuota(
    _input: Readonly<{ category: "spot"; symbol: string; side: "Buy" | "Sell" }>,
  ): Promise<unknown> {
    return Promise.resolve(this.quota);
  }
}

class ActivationClient implements SpotMarginAuthorizationClient {
  #stateIndex = 0;
  readonly operations: string[] = [];

  constructor(
    private readonly states: readonly unknown[],
    private readonly setResponse: unknown = successEnvelope(),
    private readonly quota: unknown = availableQuota(),
  ) {}

  getSpotMarginState(): Promise<unknown> {
    this.operations.push("state");
    const state = this.states.at(this.#stateIndex);
    this.#stateIndex += 1;
    return Promise.resolve(state);
  }

  setSpotMarginLeverage(input: Readonly<{ leverage: string }>): Promise<unknown> {
    this.operations.push(`set:${input.leverage}`);
    return Promise.resolve(this.setResponse);
  }

  getBorrowQuota(
    _input: Readonly<{ category: "spot"; symbol: string; side: "Buy" | "Sell" }>,
  ): Promise<unknown> {
    this.operations.push("borrow");
    return Promise.resolve(this.quota);
  }
}

const request = {
  selectedLeverage: SelectedLeverage.initialBaseline,
  symbol: asSymbol("BTC/USDC"),
  bybitSymbol: "BTCUSDC",
  side: "buy" as const,
  intent: "risk_increasing" as const,
  requiredCapacity: "100",
};

describe("SpotMarginAuthorizer", () => {
  it("rejects runtime-invalid side, Bybit symbol, and request capacity before state or borrow", async () => {
    const nullSymbol = new URL("https://example.invalid").searchParams.get("missing");
    const scenarios: readonly Readonly<{ field: string; value: unknown }>[] = [
      { field: "side", value: "hold" },
      { field: "bybitSymbol", value: nullSymbol },
      { field: "requiredCapacity", value: "100.0" },
      { field: "requiredCapacity", value: "9".repeat(1025) },
    ];
    for (const scenario of scenarios) {
      const client = new ActivationClient([enabledStatus()]);
      const authorizationRequest = { ...request };
      expect(Reflect.set(authorizationRequest, scenario.field, scenario.value)).toBe(true);

      await expectAuthorizationFailure(
        new SpotMarginAuthorizer(client, new TestClock(1)).authorize(authorizationRequest),
      );

      expect(client.operations).toEqual([]);
    }
  });

  it("normalizes external venue capacity 100.0 exactly to 100", async () => {
    const client = new ActivationClient(
      [enabledStatus()],
      successEnvelope(),
      availableQuota({ maxTradeAmount: "100.0" }),
    );
    const evidence = await new SpotMarginAuthorizer(client, new TestClock(1)).authorize(request);

    expect(evidence.borrowCapacity?.maxTradeAmount).toBe("100");
  });

  it("activates canonical 10 only after authenticated state, raw set, and exact readback", async () => {
    const selected = SelectedLeverage.parse("10");
    const client = new ActivationClient([
      enabledStatus({ spotLeverage: "2" }),
      enabledStatus({ spotLeverage: "10" }),
    ]);
    const evidence = await new SpotMarginAuthorizer(
      client,
      new TestClock(1_700_000_000_000),
    ).activateSelectedLeverage(selected);

    expect(client.operations).toEqual(["state", "set:10", "state"]);
    expect(evidence).toEqual({
      venue: "bybiteu",
      selectedLeverage: selected,
      readbackLeverage: selected,
      marginMode: "1",
      verifiedAtUtcMs: 1_700_000_000_000,
    });
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it.each(["1", "2", "3", "4", "5", "6", "7", "8", "9", "2.5", "11"])(
    "rejects unsupported live leverage %s before a state or set call",
    async (canonical) => {
      const client = new ActivationClient([enabledStatus()]);
      const authorizer = new SpotMarginAuthorizer(client, new TestClock(1));

      await expectAuthorizationFailure(
        authorizer.activateSelectedLeverage(SelectedLeverage.parse(canonical)),
      );
      expect(client.operations).toEqual([]);
    },
  );

  it("fails closed for malformed state, rejected set, and mismatched readback", async () => {
    const selected = SelectedLeverage.parse("10");
    const malformed = new ActivationClient([{ retCode: 0, result: { spotMarginMode: "1" } }]);
    await expectAuthorizationFailure(
      new SpotMarginAuthorizer(malformed, new TestClock(1)).activateSelectedLeverage(selected),
    );
    expect(malformed.operations).toEqual(["state"]);

    const rejectedSet = new ActivationClient([enabledStatus()], { retCode: 10_001, result: {} });
    await expectAuthorizationFailure(
      new SpotMarginAuthorizer(rejectedSet, new TestClock(1)).activateSelectedLeverage(selected),
    );
    expect(rejectedSet.operations).toEqual(["state", "set:10"]);

    const mismatch = new ActivationClient([enabledStatus(), enabledStatus({ spotLeverage: "2" })]);
    const mismatchError = await expectAuthorizationFailure(
      new SpotMarginAuthorizer(mismatch, new TestClock(1)).activateSelectedLeverage(selected),
    );
    expect(mismatchError.message).toBe("Bybit EU selected leverage readback mismatch");
    expect(mismatch.operations).toEqual(["state", "set:10", "state"]);
  });

  it("rejects authenticated canonical state 2 as a frozen-session mismatch", async () => {
    const client = new TestClient(enabledStatus({ spotLeverage: "2" }));
    const authorizer = new SpotMarginAuthorizer(client, new TestClock(1));
    const mismatchError = await expectAuthorizationFailure(authorizer.authorize(request));
    expect(mismatchError.message).toBe("Bybit EU selected leverage differs from the frozen session value");
  });

  it("returns authenticated selected-leverage evidence and checks borrow capacity for an entry", async () => {
    const clock = new TestClock(1_700_000_000_000);
    const evidence = await new SpotMarginAuthorizer(new TestClient(), clock).authorize(request);

    expect(evidence).toEqual({
      venue: "bybiteu",
      symbol: asSymbol("BTC/USDC"),
      bybitSymbol: "BTCUSDC",
      side: "buy",
      intent: "risk_increasing",
      verifiedAtUtcMs: 1_700_000_000_000,
      selectedLeverage: SelectedLeverage.initialBaseline,
      marginMode: "1",
      borrowCapacity: {
        borrowCoin: "USDC",
        maxTradeQuantity: "3.25",
        maxTradeAmount: "1000",
        spotMaxTradeQuantity: "0.25",
        spotMaxTradeAmount: "100",
      },
    });
  });

  it("does not query borrow availability for a risk-reducing order", async () => {
    const client = new TestClient();
    let borrowChecks = 0;
    const countingClient: SpotMarginAuthorizationClient = {
      getSpotMarginState: () => client.getSpotMarginState(),
      setSpotMarginLeverage: (input) => client.setSpotMarginLeverage(input),
      getBorrowQuota: async (input) => {
        borrowChecks++;
        return client.getBorrowQuota(input);
      },
    };

    const evidence = await new SpotMarginAuthorizer(countingClient, new TestClock(1)).authorize({
      ...request,
      intent: "risk_reducing",
      requiredCapacity: undefined,
    });

    expect(evidence.borrowCapacity).toBeUndefined();
    expect(borrowChecks).toBe(0);
  });

  it.each<readonly [string, unknown]>([
    ["malformed envelope", { result: enabledStatus().result }],
    ["non-success status", { retCode: 10_001, result: enabledStatus().result }],
    ["margin disabled", enabledStatus({ spotMarginMode: "0" })],
    ["wrong leverage", enabledStatus({ spotLeverage: "9" })],
    ["missing leverage", enabledStatus({ spotLeverage: undefined })],
  ])("fails closed for %s", async (_label, status) => {
    const authorizer = new SpotMarginAuthorizer(new TestClient(status), new TestClock(1));
    await expectAuthorizationFailure(authorizer.authorize(request));
  });

  it.each<readonly [string, () => Promise<unknown>]>([
    ["API failure", unavailableQuota],
    ["wrong response symbol", () => Promise.resolve(availableQuota({ symbol: "ETHUSDC" }))],
    ["wrong response side", () => Promise.resolve(availableQuota({ side: "Sell" }))],
    ["missing borrow coin", () => Promise.resolve(availableQuota({ borrowCoin: "" }))],
    ["malformed capacity", () => Promise.resolve(availableQuota({ maxTradeAmount: "1e3" }))],
    ["zero entry capacity", () => Promise.resolve(availableQuota({ maxTradeAmount: "0" }))],
  ])("fails closed for a risk-increasing entry with %s", async (_label, getQuota) => {
    const client: SpotMarginAuthorizationClient = {
      getSpotMarginState: () => Promise.resolve(enabledStatus()),
      setSpotMarginLeverage: () => Promise.resolve(successEnvelope()),
      getBorrowQuota: getQuota,
    };
    await expectAuthorizationFailure(new SpotMarginAuthorizer(client, new TestClock(1)).authorize(request));
  });

  it("rejects stale, future, and invalid verification timestamps", async () => {
    const clock = new TestClock(100);
    const authorizer = new SpotMarginAuthorizer(new TestClient(), clock);
    const evidence = await authorizer.authorize(request);

    expect(() => {
      authorizer.assertFresh(evidence, 5);
    }).not.toThrow();
    clock.set(106);
    expect(() => {
      authorizer.assertFresh(evidence, 5);
    }).toThrow(SpotMarginAuthorizationError);
    clock.set(99);
    expect(() => {
      authorizer.assertFresh(evidence, 5);
    }).toThrow(SpotMarginAuthorizationError);
    expect(() => {
      authorizer.assertFresh(evidence, 0);
    }).toThrow(SpotMarginAuthorizationError);
  });

  it("wraps malformed nested quota getters and preserves their cause", async () => {
    const cause = new Error("quota getter");
    const quota = availableQuota();
    Object.defineProperty(quota.result, "maxTradeAmount", {
      get: () => {
        throw cause;
      },
    });
    try {
      await new SpotMarginAuthorizer(new TestClient(enabledStatus(), quota), new TestClock(1)).authorize(
        request,
      );
      expect.unreachable("Expected malformed quota getter rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(SpotMarginAuthorizationError);
      if (!(error instanceof SpotMarginAuthorizationError)) return;
      expect(error.cause).toBe(cause);
    }
  });

  it("rejects malformed runtime clocks before a state query", async () => {
    const missingClock = authorizerWithUnknownClock(new ActivationClient([enabledStatus()]), {});
    await expectAuthorizationFailure(missingClock.authorize(request));

    const nonNumberClock: SpotMarginClock = { nowUtcMs: () => 1 };
    expect(Reflect.set(nonNumberClock, "nowUtcMs", () => "not-a-timestamp")).toBe(true);
    const nonNumberClient = new ActivationClient([enabledStatus()]);
    await expectAuthorizationFailure(
      new SpotMarginAuthorizer(nonNumberClient, nonNumberClock).authorize(request),
    );

    const nullClock = new URL("https://example.invalid").searchParams.get("missing");
    const nullClockClient = new ActivationClient([enabledStatus()]);
    await expectAuthorizationFailure(
      authorizerWithUnknownClock(nullClockClient, nullClock).authorize(request),
    );

    expect(Reflect.set(functionClock, "nowUtcMs", () => 1)).toBe(true);
    const functionClockClient = new ActivationClient([enabledStatus()]);
    const functionClockEvidence = await authorizerWithUnknownClock(
      functionClockClient,
      functionClock,
    ).authorize(request);

    expect(nonNumberClient.operations).toEqual([]);
    expect(nullClockClient.operations).toEqual([]);
    expect(functionClockEvidence).toBeDefined();
    expect(functionClockClient.operations).toEqual(["state", "borrow"]);
  });

  it("rejects a non-string runtime symbol before the authorization clock or state query", async () => {
    const candidate = { ...request };
    expect(Reflect.set(candidate, "symbol", {})).toBe(true);
    const client = new ActivationClient([enabledStatus()]);
    let clockReads = 0;

    await expectAuthorizationFailure(
      new SpotMarginAuthorizer(client, {
        nowUtcMs: () => {
          clockReads += 1;
          return 1;
        },
      }).authorize(candidate),
    );

    expect(clockReads).toBe(0);
    expect(client.operations).toEqual([]);
  });
});

async function unavailableQuota(): Promise<unknown> {
  await Promise.resolve();
  throw new Error("unavailable");
}

function functionClock(): void {
  return;
}

async function expectAuthorizationFailure(
  operation: Promise<unknown>,
): Promise<SpotMarginAuthorizationError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(SpotMarginAuthorizationError);
    if (error instanceof SpotMarginAuthorizationError) return error;
    throw new Error("Expected Spot Margin authorization error.", { cause: error });
  }
  expect.unreachable("Expected Spot Margin authorization to fail closed");
}

function authorizerWithUnknownClock(
  client: SpotMarginAuthorizationClient,
  clock: unknown,
): SpotMarginAuthorizer {
  const constructor: unknown = SpotMarginAuthorizer;
  if (typeof constructor !== "function") throw new Error("Spot Margin authorizer constructor is unavailable");
  const authorizer: unknown = Reflect.construct(constructor, [client, clock]);
  if (!(authorizer instanceof SpotMarginAuthorizer))
    throw new Error("Spot Margin authorizer construction failed");
  return authorizer;
}

function enabledStatus(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<{ retCode: number; result: Readonly<Record<string, unknown>> }> {
  return {
    retCode: 0,
    result: { spotMarginMode: "1", spotLeverage: "10", ...overrides },
  };
}

function successEnvelope(): Readonly<{ retCode: number; result: Readonly<Record<string, unknown>> }> {
  return { retCode: 0, result: {} };
}

function availableQuota(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<{ retCode: number; result: Readonly<Record<string, unknown>> }> {
  return {
    retCode: 0,
    result: {
      symbol: "BTCUSDC",
      side: "Buy",
      maxTradeQty: "3.25",
      maxTradeAmount: "1000",
      spotMaxTradeQty: "0.25",
      spotMaxTradeAmount: "100",
      borrowCoin: "USDC",
      ...overrides,
    },
  };
}
