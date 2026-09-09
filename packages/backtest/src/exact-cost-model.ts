import { ExactRational } from "@mm-crypto-bot/shared";

export type ExactOrderSide = "buy" | "sell";
export type ExactPositionSide = "long" | "short";

interface ExactCostModelConfig {
  readonly takerFeeRate: ExactRational;
  readonly slippageRate: ExactRational;
  readonly spreadRate: ExactRational;
  readonly borrowRatePerHour: ExactRational;
  readonly fundingRatePer8h: ExactRational;
}

const EXACT_COST_MODEL_CONSTRUCTION_CAPABILITY = Symbol("exact-cost-model-construction-capability");
const EXACT_COST_MODEL_RATE_NAMES = new Set([
  "takerFeeRate",
  "slippageRate",
  "spreadRate",
  "borrowRatePerHour",
  "fundingRatePer8h",
]);
const authenticatedExactCostModels = new WeakSet();
const zero = ExactRational.from(0n);
const one = ExactRational.from(1n);
const two = ExactRational.from(2n);
const millisecondsPerHour = 3_600_000n;
const millisecondsPerEightHours = 28_800_000n;

function failInvalidCostModelConfig(): never {
  throw new Error("Exact cost model configuration is invalid.");
}

function isObject(input: unknown): input is object {
  return typeof input === "object" && input !== null;
}

function isAuthenticExactCostModel(input: unknown): input is ExactCostModel {
  return isObject(input) && authenticatedExactCostModels.has(input);
}

function requireNonNegative(value: unknown, label: string): ExactRational {
  const authenticValue = ExactRational.requireAuthentic(value);
  if (authenticValue.isNegative()) {
    throw new Error(`${label} must be non-negative.`);
  }

  return authenticValue;
}

function requirePositive(value: unknown, label: string): ExactRational {
  const authenticValue = ExactRational.requireAuthentic(value);
  if (authenticValue.compare(zero) <= 0) {
    throw new Error(`${label} must be positive.`);
  }

  return authenticValue;
}

function requireStrictlyLessThan(
  value: ExactRational,
  upperBound: ExactRational,
  label: string,
): ExactRational {
  if (value.compare(upperBound) >= 0) {
    throw new Error(`${label} must be strictly less than ${upperBound.toCanonicalDecimal()}.`);
  }

  return value;
}

function requireNonNegativeDuration(durationMilliseconds: unknown): bigint {
  if (typeof durationMilliseconds !== "bigint" || durationMilliseconds < 0n) {
    throw new Error("Holding duration must be a non-negative bigint.");
  }

  return durationMilliseconds;
}

function requireExactOrderSide(side: unknown): ExactOrderSide {
  if (side !== "buy" && side !== "sell") {
    throw new Error("Order side must be buy or sell.");
  }

  return side;
}

function requireExactPositionSide(side: unknown): ExactPositionSide {
  if (side !== "long" && side !== "short") {
    throw new Error("Position side must be long or short.");
  }

  return side;
}

function readExactModelRate(input: object, propertyName: string): ExactRational {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, propertyName);
  } catch {
    failInvalidCostModelConfig();
  }
  if (
    descriptor?.enumerable !== true ||
    !Object.hasOwn(descriptor, "value") ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined
  ) {
    failInvalidCostModelConfig();
  }

  return ExactRational.requireAuthentic(descriptor.value);
}

function readExactCostModelConfig(input: unknown): ExactCostModelConfig {
  if (!isObject(input)) {
    failInvalidCostModelConfig();
  }

  let propertyNames: readonly PropertyKey[];
  try {
    if (Object.getPrototypeOf(input) !== Object.prototype) {
      failInvalidCostModelConfig();
    }
    propertyNames = Reflect.ownKeys(input);
  } catch {
    failInvalidCostModelConfig();
  }

  if (propertyNames.length !== EXACT_COST_MODEL_RATE_NAMES.size) {
    failInvalidCostModelConfig();
  }

  for (const propertyName of propertyNames) {
    if (typeof propertyName !== "string" || !EXACT_COST_MODEL_RATE_NAMES.has(propertyName)) {
      failInvalidCostModelConfig();
    }
  }

  return {
    borrowRatePerHour: requireNonNegative(readExactModelRate(input, "borrowRatePerHour"), "borrow rate"),
    fundingRatePer8h: readExactModelRate(input, "fundingRatePer8h"),
    slippageRate: requireStrictlyLessThan(
      requireNonNegative(readExactModelRate(input, "slippageRate"), "slippage rate"),
      one,
      "slippage rate",
    ),
    spreadRate: requireStrictlyLessThan(
      requireNonNegative(readExactModelRate(input, "spreadRate"), "spread rate"),
      two,
      "spread rate",
    ),
    takerFeeRate: requireNonNegative(readExactModelRate(input, "takerFeeRate"), "taker fee rate"),
  };
}

export class ExactCostModel {
  public static create(input: unknown): ExactCostModel {
    const config = readExactCostModelConfig(input);
    return new ExactCostModel(config, EXACT_COST_MODEL_CONSTRUCTION_CAPABILITY);
  }

  public static requireAuthentic(input: unknown): ExactCostModel {
    if (!isAuthenticExactCostModel(input)) {
      throw new Error("Exact cost model operation requires an authentic ExactCostModel operand.");
    }

    return input;
  }

  readonly #takerFeeRate: ExactRational;
  readonly #slippageRate: ExactRational;
  readonly #spreadRate: ExactRational;
  readonly #borrowRatePerHour: ExactRational;
  readonly #fundingRatePer8h: ExactRational;

  private constructor(config: ExactCostModelConfig, capability: symbol) {
    if (capability !== EXACT_COST_MODEL_CONSTRUCTION_CAPABILITY) {
      throw new Error("Exact cost model construction is not permitted.");
    }

    this.#takerFeeRate = config.takerFeeRate;
    this.#slippageRate = config.slippageRate;
    this.#spreadRate = config.spreadRate;
    this.#borrowRatePerHour = config.borrowRatePerHour;
    this.#fundingRatePer8h = config.fundingRatePer8h;
    authenticatedExactCostModels.add(this);
    Object.freeze(this);
  }

  public get takerFeeRate(): ExactRational {
    return ExactCostModel.requireAuthentic(this).#takerFeeRate;
  }

  public get slippageRate(): ExactRational {
    return ExactCostModel.requireAuthentic(this).#slippageRate;
  }

  public get spreadRate(): ExactRational {
    return ExactCostModel.requireAuthentic(this).#spreadRate;
  }

  public get borrowRatePerHour(): ExactRational {
    return ExactCostModel.requireAuthentic(this).#borrowRatePerHour;
  }

  public get fundingRatePer8h(): ExactRational {
    return ExactCostModel.requireAuthentic(this).#fundingRatePer8h;
  }

  // Freeze only after all prototype members exist so no external code can replace them.
  // eslint-disable-next-line unicorn/consistent-class-member-order -- The placement preserves the immutable class invariant.
  static {
    Object.freeze(this.prototype);
    Object.freeze(this);
  }
}

function signedPriceFactor(side: ExactOrderSide, rate: ExactRational): ExactRational {
  const exactOrderSide = requireExactOrderSide(side);
  const nonNegativeRate = requireNonNegative(rate, "rate");
  const factor = exactOrderSide === "buy" ? one.add(nonNegativeRate) : one.subtract(nonNegativeRate);
  return requirePositive(factor, "adjusted price factor");
}

export function applyExactSlippage(
  price: ExactRational,
  side: ExactOrderSide,
  rate: ExactRational,
): ExactRational {
  return requirePositive(price, "price").multiply(signedPriceFactor(side, rate));
}

export function applyExactSpread(
  price: ExactRational,
  side: ExactOrderSide,
  rate: ExactRational,
): ExactRational {
  return requirePositive(price, "price").multiply(
    signedPriceFactor(side, requireNonNegative(rate, "rate").divide(two)),
  );
}

export function exactEntryFee(notional: ExactRational, model: ExactCostModel): ExactRational {
  const authenticModel = ExactCostModel.requireAuthentic(model);
  return requireNonNegative(notional, "notional").multiply(
    requireNonNegative(authenticModel.takerFeeRate, "taker fee rate"),
  );
}

export function exactRoundTripFee(notional: ExactRational, model: ExactCostModel): ExactRational {
  const authenticModel = ExactCostModel.requireAuthentic(model);
  return exactEntryFee(notional, authenticModel).multiply(two);
}

export function exactMarginBorrowCost(
  marginNotional: ExactRational,
  durationMilliseconds: bigint,
  model: ExactCostModel,
): ExactRational {
  const authenticModel = ExactCostModel.requireAuthentic(model);
  const validatedDuration = requireNonNegativeDuration(durationMilliseconds);
  return requireNonNegative(marginNotional, "margin notional")
    .multiply(requireNonNegative(authenticModel.borrowRatePerHour, "borrow rate"))
    .multiply(ExactRational.from(validatedDuration))
    .divide(ExactRational.from(millisecondsPerHour));
}

export function exactFundingCost(
  notional: ExactRational,
  durationMilliseconds: bigint,
  model: ExactCostModel,
  positionSide: ExactPositionSide,
): ExactRational {
  const authenticModel = ExactCostModel.requireAuthentic(model);
  const validatedDuration = requireNonNegativeDuration(durationMilliseconds);
  const exactPositionSide = requireExactPositionSide(positionSide);
  const calculatedCost = requireNonNegative(notional, "notional")
    .multiply(ExactRational.requireAuthentic(authenticModel.fundingRatePer8h))
    .multiply(ExactRational.from(validatedDuration))
    .divide(ExactRational.from(millisecondsPerEightHours));
  return exactPositionSide === "long" ? calculatedCost : calculatedCost.negate();
}
