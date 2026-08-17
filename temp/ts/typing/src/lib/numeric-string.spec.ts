import type { NumericString } from './numeric-string';
import {
  TEST_PI_3_14159,
  TEST_NEGATIVE_2_5,
  TEST_SMALL_DECIMAL_0_001,
  TEST_SCIENTIFIC_RESULT_10B,
  TEST_SCIENTIFIC_RESULT_0_00001,
  TEST_SCIENTIFIC_2E3,
} from './test-constants';

const PARSE_FLOAT_PRECISION = 5;

describe('NumericString', () => {
  describe('type validation', () => {
    it('should accept integer strings', () => {
      const integer: NumericString = '42';
      const negative: NumericString = '-10';
      const zero: NumericString = '0';

      expect(integer).toBe('42');
      expect(negative).toBe('-10');
      expect(zero).toBe('0');
    });

    it('should accept decimal strings', () => {
      const decimal: NumericString = '3.14159';
      const negativeDecimal: NumericString = '-2.5';
      const smallDecimal: NumericString = '0.001';

      expect(Number(decimal)).toBeCloseTo(TEST_PI_3_14159, PARSE_FLOAT_PRECISION);
      expect(Number(negativeDecimal)).toBe(TEST_NEGATIVE_2_5);
      expect(Number(smallDecimal)).toBe(TEST_SMALL_DECIMAL_0_001);
    });

    it('should accept scientific notation strings', () => {
      const scientific: NumericString = '1e10';
      const negativeExp: NumericString = '1e-5';
      const upperE: NumericString = '2E3';

      expect(Number(scientific)).toBe(TEST_SCIENTIFIC_RESULT_10B);
      expect(Number(negativeExp)).toBe(TEST_SCIENTIFIC_RESULT_0_00001);
      expect(Number(upperE)).toBe(TEST_SCIENTIFIC_2E3);
    });

    it('should be assignable to string type', () => {
      const number_: NumericString = '123';
      const string_: string = number_;

      expect(string_).toBe('123');
      expectTypeOf(number_).toEqualTypeOf<NumericString>();
    });
  });
});
