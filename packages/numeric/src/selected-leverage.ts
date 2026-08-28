import { canonicalizeExternalDecimal } from "./canonical.js";
import { ExactNumericError } from "./errors.js";
import { ExactRational } from "./exact-rational.js";

const CONSTRUCTION_CAPABILITY = Symbol("selected-leverage-construction-capability");
const ZERO = ExactRational.from(0n);

export class SelectedLeverage {
  public static parse(input: unknown): SelectedLeverage {
    if (typeof input !== "string" || canonicalizeExternalDecimal(input) !== input) {
      throw new ExactNumericError("INVALID_INPUT", "Selected leverage must be a canonical decimal string.");
    }

    const exact = ExactRational.from(input);
    if (exact.compare(ZERO) <= 0) {
      throw new ExactNumericError("INVALID_INPUT", "Selected leverage must be positive.");
    }

    return new SelectedLeverage(input, exact, CONSTRUCTION_CAPABILITY);
  }

  public static get initialBaseline(): SelectedLeverage {
    return INITIAL_BASELINE;
  }

  private static requireAuthenticSelectedLeverage(input: unknown): SelectedLeverage {
    try {
      if (input instanceof this) {
        void input.#canonical;
        void input.#exact;
        return input;
      }
    } catch {
      // A failed private-field brand access is an invalid runtime receiver.
    }

    throw new ExactNumericError(
      "INVALID_INPUT",
      "Selected leverage operation requires an authentic operand.",
    );
  }

  readonly #canonical: string;
  readonly #exact: ExactRational;

  private constructor(canonical: string, exact: ExactRational, capability: unknown) {
    if (capability !== CONSTRUCTION_CAPABILITY) {
      throw new ExactNumericError("INVALID_INPUT", "Selected leverage construction is not permitted.");
    }

    this.#canonical = canonical;
    this.#exact = exact;
    Object.freeze(this);
  }

  public get canonical(): string {
    return SelectedLeverage.requireAuthenticSelectedLeverage(this).#canonical;
  }

  public get exact(): ExactRational {
    return SelectedLeverage.requireAuthenticSelectedLeverage(this).#exact;
  }

  public equals(other: SelectedLeverage): boolean {
    const self = SelectedLeverage.requireAuthenticSelectedLeverage(this);
    const operand = SelectedLeverage.requireAuthenticSelectedLeverage(other);
    return self.#exact.equals(operand.#exact);
  }

  public compare(other: SelectedLeverage): -1 | 0 | 1 {
    const self = SelectedLeverage.requireAuthenticSelectedLeverage(this);
    const operand = SelectedLeverage.requireAuthenticSelectedLeverage(other);
    return self.#exact.compare(operand.#exact);
  }

  public toJSON(): string {
    return SelectedLeverage.requireAuthenticSelectedLeverage(this).#canonical;
  }
}

function initializeSelectedLeverage(): SelectedLeverage {
  const initialBaseline = SelectedLeverage.parse("10");
  Object.freeze(SelectedLeverage.prototype);
  Object.freeze(SelectedLeverage);
  return initialBaseline;
}

const INITIAL_BASELINE = initializeSelectedLeverage();
