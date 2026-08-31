import type { ExchangeFeed, Symbol } from "@mm-crypto-bot/exchange";
import { ExactRational, type ExactRationalSnapshot } from "@mm-crypto-bot/numeric";

export type LiveEquityAuthorityState =
  "initial" | "refreshing" | "fresh" | "unavailable" | "stale" | "emergency_latched";

export interface LiveEquityAuthoritySnapshot {
  readonly state: LiveEquityAuthorityState;
  readonly current: ExactRationalSnapshot | undefined;
  readonly peak: ExactRationalSnapshot | undefined;
  readonly observedAt: number | undefined;
}

export interface LiveEquityStartupEvidence {
  readonly source: "authenticated-bybiteu-feed";
  readonly observedAt: number;
  readonly snapshot: LiveEquityAuthoritySnapshot;
}

export class LiveEquityAuthorityError extends Error {
  public override readonly name = "LiveEquityAuthorityError";
}

export interface LiveEquityAuthorityOptions {
  readonly feed: ExchangeFeed;
  readonly symbols: readonly Symbol[];
  readonly maxAgeMs: number;
  readonly now: () => number;
  readonly maxDrawdownFraction: string;
}

const preparedLiveEquityAuthorityCapability = Symbol("prepared-live-equity-authority");
const authenticPreparedLiveEquityAuthorities = new WeakSet();
const exactLiveStartupEquity = ExactRational.from("1000");

export const liveEquitySystemClock = (): number => Date.now();

export interface LiveEquityPreparationRequest {
  readonly source: string;
  readonly feed: ExchangeFeed;
  readonly symbols: readonly Symbol[];
  readonly maxAgeMs: number;
  readonly now: () => number;
  readonly maxDrawdownFraction: ExactRationalSnapshot;
  readonly startupEquity: ExactRationalSnapshot;
}

function freezeExactSnapshot(snapshot: ExactRationalSnapshot): ExactRationalSnapshot {
  return Object.freeze({ ...snapshot });
}

function freezeAuthoritySnapshot(snapshot: LiveEquityAuthoritySnapshot): LiveEquityAuthoritySnapshot {
  return Object.freeze({
    ...snapshot,
    ...(snapshot.current !== undefined && { current: freezeExactSnapshot(snapshot.current) }),
    ...(snapshot.peak !== undefined && { peak: freezeExactSnapshot(snapshot.peak) }),
  });
}

function sealClassAtModuleEvaluation(target: { readonly prototype: object }): void {
  Object.freeze(target.prototype);
  Object.freeze(target);
}

export function createLiveEquityPreparationRequest(
  options: LiveEquityAuthorityOptions,
): LiveEquityPreparationRequest {
  if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs <= 0) {
    throw new LiveEquityAuthorityError("live authority requires a positive integral maximum age");
  }
  const maxDrawdownFraction = ExactRational.from(options.maxDrawdownFraction);
  if (maxDrawdownFraction.isNegative() || maxDrawdownFraction.compare(ExactRational.from("1")) >= 0) {
    throw new LiveEquityAuthorityError("live authority requires a drawdown fraction in [0, 1)");
  }
  return Object.freeze({
    source: "authenticated-bybiteu-feed" as const,
    feed: options.feed,
    symbols: Object.freeze([...options.symbols]),
    maxAgeMs: options.maxAgeMs,
    now: options.now,
    maxDrawdownFraction: freezeExactSnapshot(maxDrawdownFraction.toSnapshot()),
    startupEquity: freezeExactSnapshot(exactLiveStartupEquity.toSnapshot()),
  });
}

function isMatchingRequest(
  actual: LiveEquityPreparationRequest,
  expected: LiveEquityPreparationRequest,
): boolean {
  return (
    actual.source === expected.source &&
    actual.feed === expected.feed &&
    actual.now === expected.now &&
    actual.maxAgeMs === expected.maxAgeMs &&
    ExactRational.fromSnapshot(actual.maxDrawdownFraction).equals(
      ExactRational.fromSnapshot(expected.maxDrawdownFraction),
    ) &&
    ExactRational.fromSnapshot(actual.startupEquity).equals(
      ExactRational.fromSnapshot(expected.startupEquity),
    ) &&
    actual.symbols.length === expected.symbols.length &&
    actual.symbols.every((symbol, index) => symbol === expected.symbols.at(index))
  );
}

/**
 * Converts only the IEEE-754 value already received from the venue. It cannot
 * recover a venue decimal that was rounded before reaching this boundary.
 */
export function receivedNumberToExactRational(value: number): ExactRational {
  if (!Number.isFinite(value) || Object.is(value, -0) || value < 0) {
    throw new LiveEquityAuthorityError("live authority received an invalid numeric transport value");
  }
  const rendered = value.toString();
  const exponentIndex = rendered.search(/[eE]/u);
  if (exponentIndex < 0) return ExactRational.from(rendered);
  const mantissa = rendered.slice(0, exponentIndex);
  const exponentText = rendered.slice(exponentIndex + 1);
  const isNegativeExponent = exponentText.startsWith("-");
  const exponentDigits = exponentText.slice(1);
  if (exponentDigits.length === 0 || /[^0-9]/u.test(exponentDigits)) {
    throw new LiveEquityAuthorityError(
      "live authority received an invalid scientific numeric transport value",
    );
  }
  let exponent = 0n;
  for (const digit of exponentDigits) exponent = exponent * 10n + BigInt(digit);
  if (exponent > 10_000n)
    throw new LiveEquityAuthorityError("live authority numeric transport exponent exceeds bound");
  const point = mantissa.indexOf(".");
  const digits = mantissa.replace(".", "");
  let pointAt = BigInt(point === -1 ? mantissa.length : point);
  pointAt += isNegativeExponent ? -exponent : exponent;
  if (pointAt <= 0n) {
    let zeros = "";
    while (pointAt < 0n) {
      zeros += "0";
      pointAt += 1n;
    }
    return ExactRational.from(`0.${zeros}${digits}`);
  }
  const digitCount = BigInt(digits.length);
  if (pointAt >= digitCount) {
    let zeros = "";
    while (pointAt > digitCount) {
      zeros += "0";
      pointAt -= 1n;
    }
    return ExactRational.from(`${digits}${zeros}`);
  }
  let index = 0n;
  let integer = "";
  let fraction = "";
  for (const digit of digits) {
    if (index < pointAt) integer += digit;
    else fraction += digit;
    index += 1n;
  }
  return ExactRational.from(`${integer}.${fraction}`);
}

export class LiveEquityAuthority {
  static {
    sealClassAtModuleEvaluation(LiveEquityAuthority);
  }

  #state: LiveEquityAuthorityState = "initial";
  #current: ExactRational | undefined;
  #peak: ExactRational | undefined;
  #observedAt: number | undefined;
  #refreshPromise: Promise<void> | undefined;
  readonly #request: LiveEquityPreparationRequest;
  readonly #maxDrawdownFraction: ExactRational;

  public readonly getSnapshot = function (this: LiveEquityAuthority): LiveEquityAuthoritySnapshot {
    return freezeAuthoritySnapshot({
      state: this.#state,
      current: this.#current?.toSnapshot(),
      peak: this.#peak?.toSnapshot(),
      observedAt: this.#observedAt,
    });
  };

  public readonly getStartupEvidence = function (this: LiveEquityAuthority): LiveEquityStartupEvidence {
    const state = this.#state;
    const snapshot = this.getSnapshot();
    if (
      state !== "fresh" ||
      snapshot.state !== state ||
      snapshot.current === undefined ||
      snapshot.observedAt === undefined
    ) {
      throw new LiveEquityAuthorityError("live startup requires fresh exact equity authority evidence");
    }
    return Object.freeze({
      source: "authenticated-bybiteu-feed",
      observedAt: snapshot.observedAt,
      snapshot,
    });
  };

  public readonly getPreparationRequest = function (this: LiveEquityAuthority): LiveEquityPreparationRequest {
    return this.#request;
  };

  public readonly assertEntryAllowed = function (this: LiveEquityAuthority): void {
    if (this.#state !== "fresh" || this.#current === undefined || this.#observedAt === undefined) {
      throw new LiveEquityAuthorityError("live order entry requires fresh exact equity authority");
    }
    if (this.readNow() - this.#observedAt > this.#request.maxAgeMs) {
      this.#state = "stale";
      throw new LiveEquityAuthorityError("live order entry blocked by stale exact equity authority");
    }
  };

  public readonly refresh = async function (this: LiveEquityAuthority): Promise<void> {
    if (this.#refreshPromise !== undefined) return this.#refreshPromise;
    if (this.#state !== "emergency_latched") this.#state = "refreshing";
    this.#refreshPromise = this.refreshOnceAndClear();
    return this.#refreshPromise;
  };

  public constructor(options: LiveEquityAuthorityOptions) {
    this.#request = createLiveEquityPreparationRequest(options);
    this.#maxDrawdownFraction = ExactRational.fromSnapshot(this.#request.maxDrawdownFraction);
    this.readNow();
    Object.freeze(this);
  }

  private readNow(): number {
    const now = this.#request.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new LiveEquityAuthorityError("live authority requires a non-negative integral clock timestamp");
    }
    return now;
  }

  private async refreshOnceAndClear(): Promise<void> {
    try {
      await this.refreshOnce();
    } finally {
      this.#refreshPromise = undefined;
    }
  }

  private async refreshOnce(): Promise<void> {
    const observedAt = this.readNow();
    const wasEmergencyLatched = this.#state === "emergency_latched";
    try {
      const balances = await this.#request.feed.fetchBalances();
      const byCurrency = new Map<string, ExactRational>();
      for (const balance of balances) {
        const total = receivedNumberToExactRational(balance.total);
        if (byCurrency.has(balance.currency))
          throw new LiveEquityAuthorityError("live authority rejects duplicate balance currency");
        byCurrency.set(balance.currency, total);
      }
      const usdc = byCurrency.get("USDC");
      if (usdc === undefined || usdc.isNegative() || usdc.isZero())
        throw new LiveEquityAuthorityError("live authority requires positive USDC total");
      let equity = usdc;
      const configuredAssets = new Map<string, Symbol>();
      for (const symbol of this.#request.symbols) {
        const market = await this.#request.feed.fetchMarketMeta(symbol);
        if (market.isSpot !== true || market.quote !== "USDC" || configuredAssets.has(market.base)) {
          throw new LiveEquityAuthorityError("live authority requires unique USDC spot markets");
        }
        configuredAssets.set(market.base, symbol);
      }
      const valuedAssets: { readonly symbol: Symbol; readonly total: ExactRational }[] = [];
      for (const [currency, total] of byCurrency) {
        if (currency === "USDC") continue;
        const symbol = configuredAssets.get(currency);
        if (symbol === undefined)
          throw new LiveEquityAuthorityError("live authority rejects an unconfigured asset currency");
        if (!total.isZero()) valuedAssets.push({ symbol, total });
      }
      const valuedNotionals = await Promise.all(
        valuedAssets.map(async ({ symbol, total }) => {
          const ticker = await this.#request.feed.fetchTickerSnapshot(symbol);
          if (
            !Number.isSafeInteger(ticker.timestamp) ||
            ticker.timestamp < 0 ||
            ticker.timestamp > observedAt ||
            observedAt - ticker.timestamp > this.#request.maxAgeMs
          ) {
            throw new LiveEquityAuthorityError("live authority requires a current ticker timestamp");
          }
          const price = receivedNumberToExactRational(ticker.last);
          if (price.isZero()) throw new LiveEquityAuthorityError("live authority requires positive ticker");
          return total.multiply(price);
        }),
      );
      for (const notional of valuedNotionals) {
        equity = equity.add(notional);
      }
      this.#current = equity;
      this.#peak = this.#peak === undefined || equity.compare(this.#peak) > 0 ? equity : this.#peak;
      this.#observedAt = observedAt;
      const threshold = this.#peak.multiply(ExactRational.from("1").subtract(this.#maxDrawdownFraction));
      this.#state = wasEmergencyLatched || equity.compare(threshold) <= 0 ? "emergency_latched" : "fresh";
    } catch (error) {
      if (!wasEmergencyLatched) this.#state = "unavailable";
      throw error instanceof LiveEquityAuthorityError ? error : new LiveEquityAuthorityError(String(error));
    }
  }
}

export class PreparedLiveEquityAuthority {
  static {
    sealClassAtModuleEvaluation(PreparedLiveEquityAuthority);
  }

  public static async prepare(options: LiveEquityAuthorityOptions): Promise<PreparedLiveEquityAuthority> {
    const authority = new LiveEquityAuthority(options);
    await authority.refresh();
    const evidence = authority.getStartupEvidence();
    if (
      evidence.snapshot.current === undefined ||
      !ExactRational.fromSnapshot(evidence.snapshot.current).equals(exactLiveStartupEquity)
    ) {
      throw new LiveEquityAuthorityError("live startup requires exactly USD 1000 authoritative equity");
    }
    const prepared = new PreparedLiveEquityAuthority(
      preparedLiveEquityAuthorityCapability,
      authority,
      evidence,
      authority.getPreparationRequest(),
    );
    return prepared;
  }

  public static require(
    value: object | undefined,
    expectedRequest: LiveEquityPreparationRequest,
    initialEquity: number,
  ): PreparedLiveEquityAuthority {
    if (value === undefined) {
      throw new LiveEquityAuthorityError("live runtime requires prepared equity authority");
    }
    const prepared = assertAuthenticPreparedLiveEquity(value);
    if (
      prepared.#authority !== prepared.authority ||
      prepared.#evidence !== prepared.evidence ||
      !isMatchingRequest(prepared.#request, expectedRequest) ||
      !receivedNumberToExactRational(initialEquity).equals(exactLiveStartupEquity)
    ) {
      throw new LiveEquityAuthorityError("prepared live equity authority does not match the runtime");
    }
    return prepared;
  }

  readonly #authority: LiveEquityAuthority;
  readonly #evidence: LiveEquityStartupEvidence;
  readonly #request: LiveEquityPreparationRequest;

  public readonly authority: LiveEquityAuthority;
  public readonly evidence: LiveEquityStartupEvidence;

  private constructor(
    capability: symbol,
    authority: LiveEquityAuthority,
    evidence: LiveEquityStartupEvidence,
    request: LiveEquityPreparationRequest,
  ) {
    if (capability !== preparedLiveEquityAuthorityCapability) {
      throw new LiveEquityAuthorityError("live equity preparation requires the module capability");
    }
    this.#authority = authority;
    this.#evidence = evidence;
    this.#request = request;
    this.authority = authority;
    this.evidence = evidence;
    authenticPreparedLiveEquityAuthorities.add(this);
    Object.freeze(this);
  }
}

function assertAuthenticPreparedLiveEquity(value: object): PreparedLiveEquityAuthority {
  if (!(value instanceof PreparedLiveEquityAuthority) || !authenticPreparedLiveEquityAuthorities.has(value)) {
    throw new LiveEquityAuthorityError("live runtime requires authentic prepared equity authority");
  }
  return value;
}
