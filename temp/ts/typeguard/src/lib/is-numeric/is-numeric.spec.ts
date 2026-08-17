import { isNumeric } from './is-numeric';
import {
  POSITIVE_INT_ZERO,
  POSITIVE_INT_MEDIUM,
  NEGATIVE_INT_SMALL,
  POSITIVE_FLOAT_LARGE,
  MAGIC_NUMBER_123,
  TEST_STRING_NUMERIC,
} from '../test-constants';

describe('isNumeric - valid numeric strings', () => {
  describe('integers', () => {
    it('should return true for positive integers', () => {
      expect(isNumeric('0')).toBe(true);
      expect(isNumeric('1')).toBe(true);
      expect(isNumeric('123')).toBe(true);
      expect(isNumeric('999999')).toBe(true);
    });

    it('should return true for negative integers', () => {
      expect(isNumeric('-1')).toBe(true);
      expect(isNumeric('-123')).toBe(true);
      expect(isNumeric('-999999')).toBe(true);
    });

    it('should return true for positive decimals', () => {
      expect(isNumeric('0.0')).toBe(true);
      expect(isNumeric('0.1')).toBe(true);
      expect(isNumeric('123.45')).toBe(true);
      expect(isNumeric('0.123456')).toBe(true);
      expect(isNumeric('.5')).toBe(true);
      expect(isNumeric('5.')).toBe(true);
    });

    it('should return true for negative decimals', () => {
      expect(isNumeric('-0.1')).toBe(true);
      expect(isNumeric('-123.45')).toBe(true);
      expect(isNumeric('-0.123456')).toBe(true);
      expect(isNumeric('-.5')).toBe(true);
      expect(isNumeric('-5.')).toBe(true);
    });

    it('should return true for scientific notation', () => {
      expect(isNumeric('1e10')).toBe(true);
      expect(isNumeric('1E10')).toBe(true);
      expect(isNumeric('1e-10')).toBe(true);
      expect(isNumeric('1E-10')).toBe(true);
      expect(isNumeric('1.23e5')).toBe(true);
      expect(isNumeric('-1.23E-5')).toBe(true);
    });

    it('should return true for zero variations', () => {
      expect(isNumeric('0')).toBe(true);
      expect(isNumeric('-0')).toBe(true);
      expect(isNumeric('0.0')).toBe(true);
      expect(isNumeric('-0.0')).toBe(true);
    });
  });
});

describe('isNumeric - invalid numeric strings', () => {
  describe('whitespace and empty', () => {
    it('should return false for empty or whitespace strings', () => {
      expect(isNumeric('')).toBe(false);
      expect(isNumeric(' ')).toBe(false);
      expect(isNumeric('  ')).toBe(false);
      expect(isNumeric('\t')).toBe(false);
      expect(isNumeric('\n')).toBe(false);
      expect(isNumeric('\r\n')).toBe(false);
    });

    it('should return false for strings containing non-numeric characters', () => {
      expect(isNumeric('abc')).toBe(false);
      expect(isNumeric('123abc')).toBe(false);
      expect(isNumeric('abc123')).toBe(false);
      expect(isNumeric('12a34')).toBe(false);
      expect(isNumeric('12 34')).toBe(false);
      expect(isNumeric('12,34')).toBe(false);
    });

    it('should return false for multiple decimal points', () => {
      expect(isNumeric('12.34.56')).toBe(false);
      expect(isNumeric('1.2.3')).toBe(false);
      expect(isNumeric('..5')).toBe(false);
    });

    it('should return false for invalid number formats', () => {
      expect(isNumeric('12-34')).toBe(false);
      expect(isNumeric('12+34')).toBe(false);
      expect(isNumeric('++123')).toBe(false);
      expect(isNumeric('--123')).toBe(false);
      expect(isNumeric('+-123')).toBe(false);
    });

    it('should return false for infinity and NaN strings', () => {
      expect(isNumeric('Infinity')).toBe(false);
      expect(isNumeric('-Infinity')).toBe(false);
      expect(isNumeric('NaN')).toBe(false);
    });

    it('should return false for currency and percentage strings', () => {
      expect(isNumeric('$123')).toBe(false);
      expect(isNumeric('123$')).toBe(false);
      expect(isNumeric('123%')).toBe(false);
      expect(isNumeric('€123')).toBe(false);
    });
  });
});

describe('isNumeric - non-string values', () => {
  describe('numbers and special values', () => {
    it('should return false for numbers', () => {
      expect(isNumeric(MAGIC_NUMBER_123)).toBe(false);
      expect(isNumeric(POSITIVE_FLOAT_LARGE)).toBe(false);
      expect(isNumeric(NEGATIVE_INT_SMALL)).toBe(false);
      expect(isNumeric(POSITIVE_INT_ZERO)).toBe(false);
      expect(isNumeric(Infinity)).toBe(false);
      expect(isNumeric(-Infinity)).toBe(false);
      expect(isNumeric(NaN)).toBe(false);
    });

    it('should return false for booleans', () => {
      expect(isNumeric(true)).toBe(false);
      expect(isNumeric(false)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isNumeric()).toBe(false);
    });

    it('should return false for objects and arrays', () => {
      expect(isNumeric({})).toBe(false);
      expect(isNumeric([])).toBe(false);
      expect(isNumeric([MAGIC_NUMBER_123])).toBe(false);
      expect(isNumeric({ value: MAGIC_NUMBER_123 })).toBe(false);
    });

    it('should return false for functions', () => {
      expect(
        isNumeric((() => {
          /* empty */
        }) as unknown),
      ).toBe(false);
    });

    it('should return false for symbols', () => {
      expect(isNumeric(Symbol('test'))).toBe(false);
    });
  });
});

describe('isNumeric - edge cases and type narrowing', () => {
  describe('edge cases', () => {
    it('should handle strings with leading/trailing whitespace correctly', () => {
      // Ezek sikeresek lesznek, mert a trim() eltávolítja a whitespace-t
      // és a Number() konstruktor kezeli
      expect(isNumeric(' 123 ')).toBe(true);
      expect(isNumeric('\t123\t')).toBe(true);
      expect(isNumeric('\n123\n')).toBe(true);
    });

    it('should handle very large numbers', () => {
      expect(isNumeric('999999999999999999999')).toBe(true);
      expect(isNumeric('1.7976931348623157e+308')).toBe(true); // Number.MAX_VALUE közelében
    });

    it('should handle very small numbers', () => {
      expect(isNumeric('0.0000000000001')).toBe(true);
      expect(isNumeric('5e-324')).toBe(true); // Number.MIN_VALUE közelében
    });

    it('should return false for hexadecimal, binary, and octal notation', () => {
      expect(isNumeric('0x123')).toBe(false);
      expect(isNumeric('0b101')).toBe(false);
      expect(isNumeric('0o123')).toBe(false);
    });
  });

  describe('type narrowing', () => {
    it('should properly narrow the type when used as type guard', () => {
      const value: unknown = '123';

      if (isNumeric(value)) {
        expect(Number(value)).toBe(Number(TEST_STRING_NUMERIC));
      } else {
        throw new Error('Value is not numeric');
      }
    });

    it('should work with filter operations', () => {
      const mixedArray: unknown[] = ['123', 'abc', POSITIVE_INT_MEDIUM, '78.9', undefined, '-10'];
      const numericStrings = mixedArray.filter(value => isNumeric(value));

      expect(numericStrings).toStrictEqual(['123', '78.9', '-10']);
    });
  });
});
