import { describe, expect, it } from "vitest";

import { ExactRational } from "./exact-rational.js";
import { isExactMultiple } from "./exact-step.js";

const generatorModulus = 2n ** 127n - 1n;
const generatorMultiplier = 6_364_136_223_846_793_005n;
const generatorIncrement = 1_442_695_040_888_963_407n;

class DeterministicRationalGenerator {
  #state: bigint;

  public constructor(seed: bigint) {
    this.#state = seed;
  }

  public nextRational(): ExactRational {
    this.#state = (this.#state * generatorMultiplier + generatorIncrement) % generatorModulus;
    const numerator = this.#state % 2n === 0n ? this.#state : -this.#state;
    this.#state = (this.#state * generatorMultiplier + generatorIncrement) % generatorModulus;
    return ExactRational.fromParts(numerator, (this.#state % 99_991n) + 1n);
  }
}

describe("ExactRational deterministic algebraic properties", () => {
  it("preserves identities, ordering, and snapshot round trips over seeded adversarial values", () => {
    const generator = new DeterministicRationalGenerator(987_654_321_987_654_321n);
    const one = ExactRational.from(1n);
    const tick = ExactRational.fromParts(7n, 13n);

    for (let sampleIndex = 0; sampleIndex < 64; sampleIndex += 1) {
      const left = generator.nextRational();
      const right = generator.nextRational();

      expect(left.add(right).subtract(right).equals(left)).toBe(true);
      expect(left.multiply(one).equals(left)).toBe(true);
      if (!left.isZero()) {
        expect(left.divide(left).equals(one)).toBe(true);
      }
      expect(left.compare(right)).toBe(-right.compare(left));
      expect(ExactRational.fromSnapshot(left.toSnapshot()).equals(left)).toBe(true);
      const multiplier = ExactRational.from(BigInt(sampleIndex));
      const exactTickMultiple = tick.multiply(multiplier);
      expect(isExactMultiple(exactTickMultiple, tick)).toBe(true);
    }
  });
});
