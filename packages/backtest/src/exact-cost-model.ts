import { ExactRational } from "@mm-crypto-bot/shared";

export type ExactOrderSide = "buy" | "sell";

export interface ExactCostModel {
  readonly takerFeeRate: ExactRational;
  readonly slippageRate: ExactRational;
  readonly spreadRate: ExactRational;
  readonly borrowRatePerHour: ExactRational;
  readonly fundingRatePer8h: ExactRational;
}

const zero = ExactRational.from(0n);
const one = ExactRational.from(1n);
const two = ExactRational.from(2n);
const millisecondsPerHour = 3_600_000n;
const millisecondsPerEightHours = 28_800_000n;

function requireNonNegative(value: ExactRational, label: string): ExactRational {
  const authenticValue = ExactRational.requireAuthentic(value);
  if (authenticValue.isNegative()) {
    throw new Error(`${label} must be non-negative.`);
  }

  return authenticValue;
}

function requireNonNegativeDuration(durationMilliseconds: bigint): bigint {
  if (durationMilliseconds < 0n) {
    throw new Error("Holding duration must be non-negative.");
  }

  return durationMilliseconds;
}

function requireExactOrderSide(side: unknown): ExactOrderSide {
  if (side !== "buy" && side !== "sell") {
    throw new Error("Order side must be buy or sell.");
  }

  return side;
}

function signedPriceFactor(side: ExactOrderSide, rate: ExactRational): ExactRational {
  const exactOrderSide = requireExactOrderSide(side);
  const nonNegativeRate = requireNonNegative(rate, "rate");
  return exactOrderSide === "buy" ? one.add(nonNegativeRate) : one.subtract(nonNegativeRate);
}

export function applyExactSlippage(
  price: ExactRational,
  side: ExactOrderSide,
  rate: ExactRational,
): ExactRational {
  return requireNonNegative(price, "price").multiply(signedPriceFactor(side, rate));
}

export function applyExactSpread(
  price: ExactRational,
  side: ExactOrderSide,
  rate: ExactRational,
): ExactRational {
  return requireNonNegative(price, "price").multiply(
    signedPriceFactor(side, requireNonNegative(rate, "rate").divide(two)),
  );
}

export function exactEntryFee(notional: ExactRational, model: ExactCostModel): ExactRational {
  return requireNonNegative(notional, "notional").multiply(
    requireNonNegative(model.takerFeeRate, "taker fee rate"),
  );
}

export function exactRoundTripFee(notional: ExactRational, model: ExactCostModel): ExactRational {
  return exactEntryFee(notional, model).multiply(two);
}

export function exactMarginBorrowCost(
  marginNotional: ExactRational,
  durationMilliseconds: bigint,
  model: ExactCostModel,
): ExactRational {
  const validatedDuration = requireNonNegativeDuration(durationMilliseconds);
  return requireNonNegative(marginNotional, "margin notional")
    .multiply(requireNonNegative(model.borrowRatePerHour, "borrow rate"))
    .multiply(ExactRational.from(validatedDuration))
    .divide(ExactRational.from(millisecondsPerHour));
}

export function exactFundingCost(
  notional: ExactRational,
  durationMilliseconds: bigint,
  model: ExactCostModel,
): ExactRational {
  const validatedDuration = requireNonNegativeDuration(durationMilliseconds);
  const fundingRate = requireNonNegative(model.fundingRatePer8h, "funding rate");
  const calculatedCost = requireNonNegative(notional, "notional")
    .multiply(fundingRate)
    .multiply(ExactRational.from(validatedDuration))
    .divide(ExactRational.from(millisecondsPerEightHours));
  return fundingRate.isZero() ? zero : calculatedCost;
}
