import { SelectedLeverage } from "@mm-crypto-bot/numeric";

export interface FrozenSelectedLeverage {
  readonly selected: SelectedLeverage;
}

const CONSTRUCTION_CAPABILITY = Symbol("frozen-selected-leverage-construction-capability");

class FrozenSelectedLeverageState implements FrozenSelectedLeverage {
  static {
    Object.freeze(this.prototype);
    Object.freeze(this);
  }

  static requireAuthentic(input: unknown): FrozenSelectedLeverageState {
    try {
      if (input instanceof this) {
        void input.#selected;
        return input;
      }
    } catch {
      throw new TypeError("Frozen selected leverage must be an authentic session value.");
    }

    throw new TypeError("Frozen selected leverage must be an authentic session value.");
  }

  readonly #selected: SelectedLeverage;
  readonly selected: SelectedLeverage;

  constructor(selected: SelectedLeverage, capability: symbol) {
    if (capability !== CONSTRUCTION_CAPABILITY) {
      throw new TypeError("Frozen selected leverage construction is not permitted.");
    }

    this.#selected = requireAuthenticSelectedLeverage(selected);
    this.selected = this.#selected;
    Object.freeze(this);
  }
}

function requireAuthenticSelectedLeverage(input: unknown): SelectedLeverage {
  try {
    if (!(input instanceof SelectedLeverage)) {
      throw new TypeError("Selected leverage is not an instance.");
    }

    void Reflect.get(SelectedLeverage.prototype, "canonical", input);
    return input;
  } catch {
    throw new TypeError("Selected leverage must be an authentic selected leverage value.");
  }
}

export function freezeSelectedLeverage(selected: SelectedLeverage): FrozenSelectedLeverage {
  return new FrozenSelectedLeverageState(selected, CONSTRUCTION_CAPABILITY);
}

export function assertSelectedLeverageUnchanged(
  frozen: FrozenSelectedLeverage,
  candidate: SelectedLeverage,
): void {
  const selected = FrozenSelectedLeverageState.requireAuthentic(frozen).selected;
  const authenticCandidate = requireAuthenticSelectedLeverage(candidate);

  if (!SelectedLeverage.prototype.equals.call(selected, authenticCandidate)) {
    throw new Error("Selected leverage is immutable for a session.");
  }
}
