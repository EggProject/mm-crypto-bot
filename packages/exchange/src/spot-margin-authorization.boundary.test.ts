import { describe, expect, it } from "bun:test";

import { SelectedLeverage } from "@mm-crypto-bot/numeric";

import { asSymbol } from "./symbols.js";
import {
  SpotMarginAuthorizationError,
  SpotMarginAuthorizer,
  type SpotMarginAuthorizationClient,
} from "./spot-margin-authorization.js";

const request = {
  selectedLeverage: SelectedLeverage.initialBaseline,
  symbol: asSymbol("BTC/USDC"),
  bybitSymbol: "BTCUSDC",
  side: "buy" as const,
  intent: "risk_increasing" as const,
  requiredCapacity: "10",
};

describe("SpotMarginAuthorizer public failure boundaries", () => {
  it("wraps state, set, parse, and quota transport failures", async () => {
    const failures: readonly Readonly<{
      readonly operation: (authorizer: SpotMarginAuthorizer) => Promise<unknown>;
      readonly client: SpotMarginAuthorizationClient;
    }>[] = [
      {
        operation: (authorizer) => authorizer.activateSelectedLeverage(SelectedLeverage.initialBaseline),
        client: client({ state: new Error("state") }),
      },
      {
        operation: (authorizer) => authorizer.activateSelectedLeverage(SelectedLeverage.initialBaseline),
        client: client({ set: new Error("set") }),
      },
      {
        operation: (authorizer) => authorizer.activateSelectedLeverage(SelectedLeverage.initialBaseline),
        client: client({ state: state({ spotLeverage: "2.0" }) }),
      },
      {
        operation: (authorizer) => authorizer.authorize(request),
        client: client({ quota: new Error("quota") }),
      },
    ];
    for (const failure of failures) {
      await expectFailure(failure.operation(new SpotMarginAuthorizer(failure.client, { nowUtcMs: () => 1 })));
    }
  });

  it("fails closed for forged leverage, invalid request fields, and invalid verification time", async () => {
    const forged: unknown = Object.create(SelectedLeverage.prototype);
    const proxied = new Proxy(SelectedLeverage.initialBaseline, {});
    const cases: readonly Readonly<{ readonly field: string; readonly value: unknown }>[] = [
      { field: "selectedLeverage", value: {} },
      { field: "selectedLeverage", value: forged },
      { field: "selectedLeverage", value: proxied },
      { field: "intent", value: "unknown" },
      { field: "side", value: "hold" },
      { field: "bybitSymbol", value: "" },
      { field: "bybitSymbol", value: "btc-usdc" },
      { field: "requiredCapacity", value: 10 },
      { field: "requiredCapacity", value: "0" },
    ];
    for (const scenario of cases) {
      const candidate = { ...request };
      expect(Reflect.set(candidate, scenario.field, scenario.value)).toBe(true);
      await expectFailure(new SpotMarginAuthorizer(client(), { nowUtcMs: () => 1 }).authorize(candidate));
    }
    await expectFailure(new SpotMarginAuthorizer(client(), { nowUtcMs: () => NaN }).authorize(request));
  });

  it("rejects malformed and non-executable venue quotas before emitting evidence", async () => {
    const quotas: readonly unknown[] = [
      new URL("https://example.invalid").searchParams.get("missing"),
      [],
      envelope({ maxTradeAmount: "-1" }),
      envelope({ maxTradeAmount: "0" }),
      envelope({ maxTradeAmount: "9" }),
      envelope({ maxTradeAmount: "9.9" }),
      envelope({ maxTradeQty: "9", side: "Sell" }),
      envelope({ maxTradeAmount: "10", borrowCoin: "" }),
    ];
    for (const quota of quotas) {
      const candidate = quota === quotas.at(6) ? { ...request, side: "sell" as const } : request;
      await expectFailure(
        new SpotMarginAuthorizer(client({ quota }), { nowUtcMs: () => 1 }).authorize(candidate),
      );
    }
  });

  it("compares fractional and equal exact capacities without floating point coercion", async () => {
    const equal = await new SpotMarginAuthorizer(client({ quota: envelope({ maxTradeAmount: "10" }) }), {
      nowUtcMs: () => 1,
    }).authorize(request);
    expect(equal.borrowCapacity?.maxTradeAmount).toBe("10");
    const fractional = await new SpotMarginAuthorizer(
      client({ quota: envelope({ maxTradeAmount: "10.2" }) }),
      { nowUtcMs: () => 1 },
    ).authorize({ ...request, requiredCapacity: "10.1" });
    expect(fractional.borrowCapacity?.maxTradeAmount).toBe("10.2");
    await authorizationFailure(
      { quota: envelope({ maxTradeAmount: "10" }) },
      { ...request, requiredCapacity: "20" },
    );
    const largerWhole = await new SpotMarginAuthorizer(
      client({ quota: envelope({ maxTradeAmount: "20" }) }),
      { nowUtcMs: () => 1 },
    ).authorize(request);
    expect(largerWhole.borrowCapacity?.maxTradeAmount).toBe("20");
    await authorizationFailure(
      { quota: envelope({ maxTradeAmount: "10.2" }) },
      { ...request, requiredCapacity: "10.3" },
    );
  });

  it("rejects hostile activation leverage before clock or client access", async () => {
    let proxyGets = 0;
    let clockReads = 0;
    const selectedLeverage = new Proxy(SelectedLeverage.initialBaseline, {
      get(target, property, receiver) {
        proxyGets += 1;
        if (property === "canonical") return "10";
        if (property === "equals") return () => true;
        if (property === "toJSON") return () => "10";
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
    const observed = observedClient();

    await expectFailure(
      new SpotMarginAuthorizer(observed.client, {
        nowUtcMs: () => {
          clockReads += 1;
          return 1;
        },
      }).activateSelectedLeverage(selectedLeverage),
    );

    expect(proxyGets).toBe(0);
    expect(clockReads).toBe(0);
    expect(observed.operations).toEqual([]);
  });

  it("uses the first authentic dynamic request value exactly once for the frozen authorization snapshot", async () => {
    let selectedReads = 0;
    let symbolReads = 0;
    let bybitSymbolReads = 0;
    let sideReads = 0;
    let intentReads = 0;
    let capacityReads = 0;
    const dynamic = { ...request };
    Object.defineProperties(dynamic, {
      selectedLeverage: {
        enumerable: true,
        get: () => {
          selectedReads += 1;
          if (selectedReads === 1) return SelectedLeverage.initialBaseline;
          const forged: unknown = Object.create(SelectedLeverage.prototype);
          return forged;
        },
      },
      symbol: {
        enumerable: true,
        get: () => {
          symbolReads += 1;
          return request.symbol;
        },
      },
      bybitSymbol: {
        enumerable: true,
        get: () => {
          bybitSymbolReads += 1;
          return request.bybitSymbol;
        },
      },
      side: {
        enumerable: true,
        get: () => {
          sideReads += 1;
          return request.side;
        },
      },
      intent: {
        enumerable: true,
        get: () => {
          intentReads += 1;
          return request.intent;
        },
      },
      requiredCapacity: {
        enumerable: true,
        get: () => {
          capacityReads += 1;
          return request.requiredCapacity;
        },
      },
    });
    const observed = observedClient();

    const evidence = await new SpotMarginAuthorizer(observed.client, { nowUtcMs: () => 1 }).authorize(
      dynamic,
    );

    expect([selectedReads, symbolReads, bybitSymbolReads, sideReads, intentReads, capacityReads]).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
    expect(evidence.selectedLeverage).toBe(SelectedLeverage.initialBaseline);
    expect(observed.operations).toEqual(["state", "borrow"]);
  });

  it("rejects hostile and revoked authorization leverage values before clock or client access", async () => {
    let proxyGets = 0;
    let clockReads = 0;
    const hostile = new Proxy(SelectedLeverage.initialBaseline, {
      get(target, property, receiver) {
        proxyGets += 1;
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
    const revoked = Proxy.revocable(SelectedLeverage.initialBaseline, {});
    revoked.revoke();
    for (const selectedLeverage of [hostile, revoked.proxy]) {
      const candidate = { ...request };
      expect(Reflect.set(candidate, "selectedLeverage", selectedLeverage)).toBe(true);
      const observed = observedClient();
      await expectFailure(
        new SpotMarginAuthorizer(observed.client, {
          nowUtcMs: () => {
            clockReads += 1;
            return 1;
          },
        }).authorize(candidate),
      );
      expect(observed.operations).toEqual([]);
    }
    expect(proxyGets).toBe(0);
    expect(clockReads).toBe(0);
  });

  it("captures a valid authorization clock before any state query", async () => {
    let clockReads = 0;
    const observed = observedClient();

    await expectFailure(
      new SpotMarginAuthorizer(observed.client, {
        nowUtcMs: () => {
          clockReads += 1;
          return NaN;
        },
      }).authorize(request),
    );

    expect(clockReads).toBe(1);
    expect(observed.operations).toEqual([]);
  });

  it("wraps request, clock, and nested raw-result getter errors without client I/O where possible", async () => {
    const requestCause = new Error("request getter");
    const throwingRequest = { ...request };
    Object.defineProperty(throwingRequest, "side", {
      get: () => {
        throw requestCause;
      },
    });
    const requestObserved = observedClient();
    await expectFailureWithCause(
      new SpotMarginAuthorizer(requestObserved.client, { nowUtcMs: () => 1 }).authorize(throwingRequest),
      requestCause,
    );
    expect(requestObserved.operations).toEqual([]);

    const clockCause = new Error("clock getter");
    const clock = Object.defineProperty({ nowUtcMs: () => 1 }, "nowUtcMs", {
      get: () => {
        throw clockCause;
      },
    });
    const clockObserved = observedClient();
    await expectFailureWithCause(
      new SpotMarginAuthorizer(clockObserved.client, clock).authorize(request),
      clockCause,
    );
    expect(clockObserved.operations).toEqual([]);

    const resultCause = new Error("result getter");
    const raw = Object.defineProperty({ retCode: 0 }, "result", {
      get: () => {
        throw resultCause;
      },
    });
    const rawObserved = observedClient({ state: raw });
    await expectFailureWithCause(
      new SpotMarginAuthorizer(rawObserved.client, { nowUtcMs: () => 1 }).authorize(request),
      resultCause,
    );
    expect(rawObserved.operations).toEqual(["state"]);
  });

  it("accepts freshness only for exact evidence issued by the same authorizer", async () => {
    let clockReads = 0;
    const clock = {
      nowUtcMs: () => {
        clockReads += 1;
        return 1;
      },
    };
    const owner = new SpotMarginAuthorizer(client(), clock);
    const evidence = await owner.authorize(request);
    const other = new SpotMarginAuthorizer(client(), clock);
    const activation = await new SpotMarginAuthorizer(client(), clock).activateSelectedLeverage(
      SelectedLeverage.initialBaseline,
    );
    const proxied = new Proxy(evidence, {});
    const revoked = Proxy.revocable(evidence, {});
    revoked.revoke();
    const candidates: readonly unknown[] = [{ ...evidence }, evidence, activation, proxied, revoked.proxy];

    for (const [index, candidate] of candidates.entries()) {
      clockReads = 0;
      const authorizer = index === 1 ? other : owner;
      expectFreshFailure(() => {
        assertFreshUnknown(authorizer, candidate);
      });
      expect(clockReads).toBe(0);
    }
  });
});

function client(
  overrides: Readonly<{ state?: unknown; set?: unknown; quota?: unknown }> = {},
): SpotMarginAuthorizationClient {
  const stateResponse = "state" in overrides ? overrides.state : state();
  const setResponse = "set" in overrides ? overrides.set : { retCode: 0, result: {} };
  const quotaResponse = "quota" in overrides ? overrides.quota : envelope();
  return {
    getSpotMarginState: () => toPromise(stateResponse),
    setSpotMarginLeverage: () => toPromise(setResponse),
    getBorrowQuota: () => toPromise(quotaResponse),
  };
}

function state(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return { retCode: 0, result: { spotMarginMode: "1", spotLeverage: "10", ...overrides } };
}

function envelope(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    retCode: 0,
    result: {
      symbol: "BTCUSDC",
      side: "Buy",
      maxTradeQty: "10",
      maxTradeAmount: "10",
      spotMaxTradeQty: "1",
      spotMaxTradeAmount: "1",
      borrowCoin: "USDC",
      ...overrides,
    },
  };
}

function toPromise(value: unknown): Promise<unknown> {
  if (value instanceof Error) return Promise.reject(value);
  return value instanceof Promise ? value : Promise.resolve(value);
}

async function expectFailure(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
    throw new Error("Spot Margin authorization unexpectedly succeeded");
  } catch (error) {
    expect(error).toBeInstanceOf(SpotMarginAuthorizationError);
  }
}

function authorizationFailure(
  overrides: Readonly<{ state?: unknown; set?: unknown; quota?: unknown }>,
  candidate: Parameters<SpotMarginAuthorizer["authorize"]>[0],
): Promise<void> {
  return expectFailure(
    new SpotMarginAuthorizer(client(overrides), { nowUtcMs: () => 1 }).authorize(candidate),
  );
}

function observedClient(
  overrides: Readonly<{ state?: unknown; set?: unknown; quota?: unknown }> = {},
): Readonly<{
  readonly client: SpotMarginAuthorizationClient;
  readonly operations: string[];
}> {
  const operations: string[] = [];
  const base = client(overrides);
  return {
    operations,
    client: {
      getSpotMarginState: async () => {
        operations.push("state");
        return base.getSpotMarginState();
      },
      setSpotMarginLeverage: async (input) => {
        operations.push(`set:${input.leverage}`);
        return base.setSpotMarginLeverage(input);
      },
      getBorrowQuota: async (input) => {
        operations.push("borrow");
        return base.getBorrowQuota(input);
      },
    },
  };
}

async function expectFailureWithCause(operation: Promise<unknown>, cause: Error): Promise<void> {
  try {
    await operation;
    throw new Error("Spot Margin authorization unexpectedly succeeded");
  } catch (error) {
    expect(error).toBeInstanceOf(SpotMarginAuthorizationError);
    if (!(error instanceof SpotMarginAuthorizationError)) return;
    expect(error.cause).toBe(cause);
  }
}

function assertFreshUnknown(authorizer: SpotMarginAuthorizer, evidence: unknown): void {
  const method: unknown = Reflect.get(authorizer, "assertFresh");
  if (typeof method !== "function") throw new Error("Spot Margin authorizer has no freshness method");
  const result: unknown = Reflect.apply(method, authorizer, [evidence, 1]);
  if (result !== undefined) throw new Error("Spot Margin freshness check must return undefined");
}

function expectFreshFailure(operation: () => void): void {
  try {
    operation();
    throw new Error("Spot Margin freshness unexpectedly succeeded");
  } catch (error) {
    expect(error).toBeInstanceOf(SpotMarginAuthorizationError);
  }
}
