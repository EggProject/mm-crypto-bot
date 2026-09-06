import { canonicalizeExternalDecimal, SelectedLeverage } from "@mm-crypto-bot/numeric";

import { symbolOf } from "./symbols.js";
import type { OrderSide, SpotMarginOrderIntent, SpotMarginRequiredCapacity, Symbol } from "./types.js";

export const BYBIT_EU_SPOT_MARGIN_VENUE = "bybiteu" as const;
export const REQUIRED_SPOT_MARGIN_MODE = "1" as const;

const LIVE_BYBIT_SPOT_MARGIN_LEVERAGES = new Set(["10"]);

export interface SpotMarginClock {
  nowUtcMs(): number;
}

export interface SpotMarginActivationEvidence {
  readonly venue: typeof BYBIT_EU_SPOT_MARGIN_VENUE;
  readonly selectedLeverage: SelectedLeverage;
  readonly readbackLeverage: SelectedLeverage;
  readonly marginMode: typeof REQUIRED_SPOT_MARGIN_MODE;
  readonly verifiedAtUtcMs: number;
}

export interface SpotMarginAuthorizationRequest {
  readonly selectedLeverage: SelectedLeverage;
  readonly symbol: Symbol;
  readonly bybitSymbol: string;
  readonly side: OrderSide;
  readonly intent: SpotMarginOrderIntent;
  readonly requiredCapacity: SpotMarginRequiredCapacity | undefined;
}

export interface SpotMarginAuthorizationEvidence {
  readonly venue: typeof BYBIT_EU_SPOT_MARGIN_VENUE;
  readonly symbol: Symbol;
  readonly bybitSymbol: string;
  readonly side: OrderSide;
  readonly intent: SpotMarginOrderIntent;
  readonly verifiedAtUtcMs: number;
  readonly selectedLeverage: SelectedLeverage;
  readonly marginMode: typeof REQUIRED_SPOT_MARGIN_MODE;
  readonly borrowCapacity: SpotMarginBorrowCapacity | undefined;
}

type ValidatedAuthorizationCapacity =
  | Readonly<{ intent: "risk_increasing"; requiredCapacity: string }>
  | Readonly<{ intent: "risk_reducing"; requiredCapacity: string | undefined }>;

type SnapshotAuthorizationRequest = Readonly<{
  readonly selectedLeverage: SelectedLeverage;
  readonly selectedLeverageCanonical: string;
  readonly symbol: Symbol;
  readonly bybitSymbol: string;
  readonly side: OrderSide;
}> &
  ValidatedAuthorizationCapacity;

type EnabledSpotMarginState = Readonly<{
  readonly selectedLeverage: SelectedLeverage;
  readonly selectedLeverageCanonical: string;
}>;

export interface SpotMarginBorrowCapacity {
  readonly borrowCoin: string;
  readonly maxTradeQuantity: string;
  readonly maxTradeAmount: string;
  readonly spotMaxTradeQuantity: string;
  readonly spotMaxTradeAmount: string;
}

export interface SpotMarginAuthorizationClient {
  getSpotMarginState(): Promise<unknown>;
  setSpotMarginLeverage(input: Readonly<{ leverage: string }>): Promise<unknown>;
  getBorrowQuota(
    input: Readonly<{ category: "spot"; symbol: string; side: "Buy" | "Sell" }>,
  ): Promise<unknown>;
}

export class SpotMarginAuthorizationError extends Error {
  constructor(
    message: string,
    public override readonly cause: unknown,
  ) {
    super(message, { cause });
    this.name = "SpotMarginAuthorizationError";
  }
}

export class SpotMarginAuthorizer {
  private readonly issuedAuthorizationEvidence = new WeakSet<SpotMarginAuthorizationEvidence>();

  constructor(
    private readonly client: SpotMarginAuthorizationClient,
    private readonly clock: SpotMarginClock,
  ) {}

  async activateSelectedLeverage(selectedLeverage: SelectedLeverage): Promise<SpotMarginActivationEvidence> {
    const selected = requireLiveBybitSelectedLeverage(selectedLeverage);
    const verifiedAtUtcMs = captureUtcTimestamp(this.clock, "activation clock");
    requireEnabledSpotMarginMode(await getSpotMarginState(this.client));
    await setSpotMarginLeverage(this.client, selected.canonical);
    const readback = requireEnabledSpotMarginMode(await getSpotMarginState(this.client));
    if (selected.canonical !== readback.selectedLeverageCanonical) {
      throw new SpotMarginAuthorizationError("Bybit EU selected leverage readback mismatch", undefined);
    }
    return Object.freeze({
      venue: BYBIT_EU_SPOT_MARGIN_VENUE,
      selectedLeverage: selected.selectedLeverage,
      readbackLeverage: readback.selectedLeverage,
      marginMode: REQUIRED_SPOT_MARGIN_MODE,
      verifiedAtUtcMs,
    });
  }

  async authorize(input: unknown): Promise<SpotMarginAuthorizationEvidence> {
    const request = snapshotAuthorizationRequest(input);
    const verifiedAtUtcMs = captureUtcTimestamp(this.clock, "verification clock");
    const status = requireEnabledSpotMarginMode(await getSpotMarginState(this.client));
    if (request.selectedLeverageCanonical !== status.selectedLeverageCanonical) {
      throw new SpotMarginAuthorizationError(
        "Bybit EU selected leverage differs from the frozen session value",
        undefined,
      );
    }
    const borrowCapacity =
      request.intent === "risk_reducing"
        ? undefined
        : await getBorrowCapacity(this.client, request, request.requiredCapacity);
    const evidence = Object.freeze({
      venue: BYBIT_EU_SPOT_MARGIN_VENUE,
      symbol: request.symbol,
      bybitSymbol: request.bybitSymbol,
      side: request.side,
      intent: request.intent,
      verifiedAtUtcMs,
      selectedLeverage: request.selectedLeverage,
      marginMode: REQUIRED_SPOT_MARGIN_MODE,
      borrowCapacity,
    });
    this.issuedAuthorizationEvidence.add(evidence);
    return evidence;
  }

  assertFresh(evidence: SpotMarginAuthorizationEvidence, maximumAgeMs: number): void {
    validateMaximumAgeMs(maximumAgeMs);
    if (!this.issuedAuthorizationEvidence.has(evidence)) {
      throw new SpotMarginAuthorizationError(
        "Bybit EU Spot Margin authorization evidence was not issued by this authorizer",
        undefined,
      );
    }
    const nowUtcMs = captureUtcTimestamp(this.clock, "verification clock");
    if (nowUtcMs < evidence.verifiedAtUtcMs || nowUtcMs - evidence.verifiedAtUtcMs > maximumAgeMs) {
      throw new SpotMarginAuthorizationError(
        "Bybit EU Spot Margin authorization is stale or ambiguous",
        undefined,
      );
    }
  }
}

async function getSpotMarginState(client: SpotMarginAuthorizationClient): Promise<unknown> {
  try {
    return await client.getSpotMarginState();
  } catch (error) {
    throw new SpotMarginAuthorizationError("Bybit EU Spot Margin state query failed", error);
  }
}

async function setSpotMarginLeverage(client: SpotMarginAuthorizationClient, leverage: string): Promise<void> {
  let response: unknown;
  try {
    response = await client.setSpotMarginLeverage({ leverage });
  } catch (error) {
    throw new SpotMarginAuthorizationError("Bybit EU Spot Margin leverage set request failed", error);
  }
  resultOf(response, "Spot Margin leverage set");
}

function requireEnabledSpotMarginMode(response: unknown): EnabledSpotMarginState {
  try {
    const result = resultOf(response, "Spot Margin state");
    const marginMode = requiredString(
      Reflect.get(result, "spotMarginMode"),
      "spotMarginMode",
      "Spot Margin state",
    );
    if (marginMode !== REQUIRED_SPOT_MARGIN_MODE) {
      throw new SpotMarginAuthorizationError("Bybit EU Spot Margin mode is not enabled", undefined);
    }
    const serializedLeverage = requiredString(
      Reflect.get(result, "spotLeverage"),
      "spotLeverage",
      "Spot Margin state",
    );
    const selectedLeverage = SelectedLeverage.parse(serializedLeverage);
    return {
      selectedLeverage,
      selectedLeverageCanonical: SelectedLeverage.prototype.toJSON.call(selectedLeverage),
    };
  } catch (error) {
    if (error instanceof SpotMarginAuthorizationError) throw error;
    throw new SpotMarginAuthorizationError("Bybit EU Spot Margin state leverage is malformed", error);
  }
}

async function getBorrowCapacity(
  client: SpotMarginAuthorizationClient,
  request: SpotMarginAuthorizationRequest,
  requiredCapacity: string,
): Promise<SpotMarginBorrowCapacity> {
  let response: unknown;
  try {
    response = await client.getBorrowQuota({
      category: "spot",
      symbol: request.bybitSymbol,
      side: request.side === "buy" ? "Buy" : "Sell",
    });
  } catch (error) {
    throw new SpotMarginAuthorizationError("Bybit EU Spot Margin borrow quota query failed", error);
  }
  try {
    const result = resultOf(response, "Spot Margin borrow quota");
    const side = requiredString(Reflect.get(result, "side"), "side", "Spot Margin borrow quota");
    const symbol = requiredString(Reflect.get(result, "symbol"), "symbol", "Spot Margin borrow quota");
    const expectedSide = request.side === "buy" ? "Buy" : "Sell";
    if (side !== expectedSide || symbol !== request.bybitSymbol) {
      throw new SpotMarginAuthorizationError(
        "Bybit EU Spot Margin borrow quota response does not match the order",
        undefined,
      );
    }
    const maxTradeQuantity = requiredCanonicalDecimal(
      Reflect.get(result, "maxTradeQty"),
      "maxTradeQty",
      "Spot Margin borrow quota",
    );
    const maxTradeAmount = requiredCanonicalDecimal(
      Reflect.get(result, "maxTradeAmount"),
      "maxTradeAmount",
      "Spot Margin borrow quota",
    );
    const spotMaxTradeQuantity = requiredCanonicalDecimal(
      Reflect.get(result, "spotMaxTradeQty"),
      "spotMaxTradeQty",
      "Spot Margin borrow quota",
    );
    const spotMaxTradeAmount = requiredCanonicalDecimal(
      Reflect.get(result, "spotMaxTradeAmount"),
      "spotMaxTradeAmount",
      "Spot Margin borrow quota",
    );
    const borrowCoin = requiredString(
      Reflect.get(result, "borrowCoin"),
      "borrowCoin",
      "Spot Margin borrow quota",
    );
    const availableCapacity = request.side === "buy" ? maxTradeAmount : maxTradeQuantity;
    if (!isPositiveCanonicalDecimal(availableCapacity)) {
      throw new SpotMarginAuthorizationError(
        "Bybit EU Spot Margin reports no executable borrow capacity",
        undefined,
      );
    }
    if (compareCanonicalDecimals(requiredCapacity, availableCapacity) > 0) {
      throw new SpotMarginAuthorizationError(
        "Bybit EU Spot Margin borrow capacity is insufficient for the entry",
        undefined,
      );
    }
    return Object.freeze({
      borrowCoin,
      maxTradeQuantity,
      maxTradeAmount,
      spotMaxTradeQuantity,
      spotMaxTradeAmount,
    });
  } catch (error) {
    if (error instanceof SpotMarginAuthorizationError) throw error;
    throw new SpotMarginAuthorizationError("Bybit EU Spot Margin borrow quota response is malformed", error);
  }
}

function requireLiveBybitSelectedLeverage(value: unknown): Readonly<{
  readonly selectedLeverage: SelectedLeverage;
  readonly canonical: string;
}> {
  try {
    if (!(value instanceof SelectedLeverage)) throw new TypeError("Selected leverage is not authentic");
    const canonical = SelectedLeverage.prototype.toJSON.call(value);
    if (!LIVE_BYBIT_SPOT_MARGIN_LEVERAGES.has(canonical)) {
      throw new SpotMarginAuthorizationError(
        "Bybit EU selected leverage is unsupported for Spot Margin",
        undefined,
      );
    }
    return Object.freeze({ selectedLeverage: value, canonical });
  } catch (error) {
    if (error instanceof SpotMarginAuthorizationError) throw error;
    throw new SpotMarginAuthorizationError("Bybit EU selected leverage is missing or forged", error);
  }
}

function snapshotAuthorizationRequest(input: unknown): SnapshotAuthorizationRequest {
  try {
    const request = recordOf(input, "Spot Margin authorization request");
    const selected = requireLiveBybitSelectedLeverage(Reflect.get(request, "selectedLeverage"));
    const symbolValue: unknown = Reflect.get(request, "symbol");
    if (typeof symbolValue !== "string") throw new Error("Symbol is not a string");
    const symbol = symbolOf(symbolValue);
    const bybitSymbol: unknown = Reflect.get(request, "bybitSymbol");
    const side: unknown = Reflect.get(request, "side");
    const intent: unknown = Reflect.get(request, "intent");
    if (!isSpotMarginOrderIntent(intent)) {
      throw new SpotMarginAuthorizationError(
        "Bybit EU Spot Margin order intent is missing or unrecognized",
        undefined,
      );
    }
    if (!isOrderSide(side)) {
      throw new SpotMarginAuthorizationError(
        "Bybit EU Spot Margin order side is missing or unrecognized",
        undefined,
      );
    }
    if (!isBybitSymbol(bybitSymbol)) {
      throw new SpotMarginAuthorizationError(
        "Bybit EU Spot Margin symbol is malformed or ambiguous",
        undefined,
      );
    }
    const requiredCapacity: unknown = Reflect.get(request, "requiredCapacity");
    const capacity = validateRequestCapacity(intent, requiredCapacity);
    return Object.freeze({
      selectedLeverage: selected.selectedLeverage,
      selectedLeverageCanonical: selected.canonical,
      symbol,
      bybitSymbol,
      side,
      ...capacity,
    });
  } catch (error) {
    if (error instanceof SpotMarginAuthorizationError) throw error;
    throw new SpotMarginAuthorizationError("Spot Margin authorization request is malformed", error);
  }
}

function isSpotMarginOrderIntent(value: unknown): value is SpotMarginOrderIntent {
  return value === "risk_increasing" || value === "risk_reducing";
}

function isOrderSide(value: unknown): value is OrderSide {
  return value === "buy" || value === "sell";
}

function validateRequestCapacity(
  intent: SpotMarginOrderIntent,
  value: unknown,
): ValidatedAuthorizationCapacity {
  if (intent === "risk_reducing" && value === undefined) return { intent, requiredCapacity: value };
  if (typeof value !== "string") {
    throw new SpotMarginAuthorizationError(
      "Spot Margin entry required capacity is missing or malformed",
      undefined,
    );
  }
  try {
    const canonical = canonicalizeExternalDecimal(value);
    if (canonical !== value || !isPositiveCanonicalDecimal(canonical)) {
      throw new SpotMarginAuthorizationError(
        "Spot Margin entry required capacity is missing or malformed",
        undefined,
      );
    }
    return { intent, requiredCapacity: canonical };
  } catch (error) {
    if (error instanceof SpotMarginAuthorizationError) throw error;
    throw new SpotMarginAuthorizationError(
      "Spot Margin entry required capacity is missing or malformed",
      error,
    );
  }
}

function validateMaximumAgeMs(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SpotMarginAuthorizationError(
      "Spot Margin authorization maximum age must be a positive safe integer",
      undefined,
    );
  }
}

function validateUtcTimestamp(value: number, source: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SpotMarginAuthorizationError(
      `${source} did not provide a valid UTC millisecond timestamp`,
      undefined,
    );
  }
}

function captureUtcTimestamp(clock: unknown, source: string): number {
  try {
    if (clock === null || (typeof clock !== "object" && typeof clock !== "function")) {
      throw new TypeError("Spot Margin clock is not an object");
    }
    const nowUtcMs: unknown = Reflect.get(clock, "nowUtcMs");
    if (typeof nowUtcMs !== "function") throw new TypeError("Spot Margin clock has no nowUtcMs method");
    const timestamp: unknown = Reflect.apply(nowUtcMs, clock, []);
    if (typeof timestamp !== "number")
      throw new TypeError("Spot Margin clock returned a non-number timestamp");
    validateUtcTimestamp(timestamp, source);
    return timestamp;
  } catch (error) {
    if (error instanceof SpotMarginAuthorizationError) throw error;
    throw new SpotMarginAuthorizationError(
      `${source} did not provide a valid UTC millisecond timestamp`,
      error,
    );
  }
}

function resultOf(response: unknown, operation: string): Record<string, unknown> {
  try {
    const envelope = recordOf(response, operation);
    if (Reflect.get(envelope, "retCode") !== 0) {
      throw new SpotMarginAuthorizationError(`${operation} returned a non-success response`, undefined);
    }
    return recordOf(Reflect.get(envelope, "result"), `${operation} result`);
  } catch (error) {
    if (error instanceof SpotMarginAuthorizationError) throw error;
    throw new SpotMarginAuthorizationError(`${operation} response is malformed`, error);
  }
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!isUnknownRecord(value)) throw new SpotMarginAuthorizationError(`${label} is malformed`, undefined);
  return value;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, key: string, operation: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SpotMarginAuthorizationError(`${operation}.${key} is missing or malformed`, undefined);
  }
  return value;
}

function requiredCanonicalDecimal(value: unknown, key: string, operation: string): string {
  const decimal = requiredString(value, key, operation);
  try {
    const canonical = canonicalizeExternalDecimal(decimal);
    if (canonical.startsWith("-")) throw new Error("negative venue capacity");
    return canonical;
  } catch (error) {
    throw new SpotMarginAuthorizationError(
      `${operation}.${key} is not a canonical non-negative decimal`,
      error,
    );
  }
}

function isBybitSymbol(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  for (const character of value) {
    if (!isUppercaseAlphaNumeric(character)) return false;
  }
  return true;
}

function isPositiveCanonicalDecimal(value: string): boolean {
  for (const character of value) {
    if (character >= "1" && character <= "9") return true;
  }
  return false;
}

function compareCanonicalDecimals(left: string, right: string): -1 | 0 | 1 {
  const leftWhole = left.replace(/\..*$/u, "");
  const leftFraction = left.replace(/^[^.]*\.?/u, "");
  const rightWhole = right.replace(/\..*$/u, "");
  if (leftWhole.length !== rightWhole.length) return leftWhole.length < rightWhole.length ? -1 : 1;
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1;
  const rightFraction = right.replace(/^[^.]*\.?/u, "");
  const fractionLength = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeftFraction = leftFraction.padEnd(fractionLength, "0");
  const normalizedRightFraction = rightFraction.padEnd(fractionLength, "0");
  if (normalizedLeftFraction === normalizedRightFraction) return 0;
  return normalizedLeftFraction < normalizedRightFraction ? -1 : 1;
}

function isUppercaseAlphaNumeric(value: string): boolean {
  return (value >= "A" && value <= "Z") || (value >= "0" && value <= "9");
}
