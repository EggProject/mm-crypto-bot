import { isNumber } from './is-number';
import {
  POSITIVE_INT_ZERO,
  POSITIVE_INT_ONE,
  POSITIVE_INT_SMALL,
  POSITIVE_INT_MEDIUM,
  NEGATIVE_INT_ONE,
  NEGATIVE_INT_SMALL,
  NEGATIVE_INT_MEDIUM,
  POSITIVE_FLOAT_TYPICAL,
  POSITIVE_FLOAT_MEDIUM,
  POSITIVE_FLOAT_LARGE,
  NEGATIVE_FLOAT_MEDIUM,
  NEGATIVE_FLOAT_LARGE,
} from '../test-constants';

describe('isNumber', () => {
  describe('integers', () => {
    it('should return true for positive integers', () => {
      expect(isNumber(POSITIVE_INT_SMALL)).toBe(true);
      expect(isNumber(POSITIVE_INT_ZERO)).toBe(true);
      expect(isNumber(POSITIVE_INT_ONE)).toBe(true);
      expect(isNumber(POSITIVE_INT_MEDIUM)).toBe(true);
    });

    it('should return true for negative integers', () => {
      expect(isNumber(NEGATIVE_INT_SMALL)).toBe(true);
      expect(isNumber(NEGATIVE_INT_ONE)).toBe(true);
      expect(isNumber(NEGATIVE_INT_MEDIUM)).toBe(true);
    });
  });

  describe('floating-point numbers', () => {
    it('should return true for positive floats', () => {
      expect(isNumber(POSITIVE_FLOAT_TYPICAL)).toBe(true);
      expect(isNumber(POSITIVE_FLOAT_MEDIUM)).toBe(true);
      expect(isNumber(POSITIVE_FLOAT_LARGE)).toBe(true);
    });

    it('should return true for negative floats', () => {
      expect(isNumber(NEGATIVE_FLOAT_MEDIUM)).toBe(true);
      expect(isNumber(NEGATIVE_FLOAT_LARGE)).toBe(true);
      expect(isNumber(NEGATIVE_FLOAT_LARGE)).toBe(true);
    });
  });

  describe('special number values', () => {
    it('should return false for NaN', () => {
      expect(isNumber(NaN)).toBe(false);
    });

    it('should return false for Infinity', () => {
      expect(isNumber(Infinity)).toBe(false);
      expect(isNumber(-Infinity)).toBe(false);
    });
  });

  describe('non-number values', () => {
    it('should return false for strings', () => {
      expect(isNumber('42')).toBe(false);
      expect(isNumber('3.14')).toBe(false);
      expect(isNumber('test')).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isNumber()).toBe(false);
    });

    it('should return false for booleans', () => {
      expect(isNumber(true)).toBe(false);
      expect(isNumber(false)).toBe(false);
    });

    it('should return false for objects and arrays', () => {
      expect(isNumber({})).toBe(false);
      expect(isNumber([])).toBe(false);
      expect(isNumber({ value: 42 })).toBe(false);
    });
  });

  describe('type guard', () => {
    it('should work as type guard', () => {
      const value: unknown = POSITIVE_INT_SMALL;
      if (isNumber(value)) {
        const test: number = value;
        expect(test).toBe(POSITIVE_INT_SMALL);
      }
    });

    it('should narrow union types correctly', () => {
      const values: (string | number)[] = [
        'test',
        POSITIVE_INT_SMALL,
        'hello',
        POSITIVE_FLOAT_TYPICAL,
      ];
      const numbers = values.filter(value => isNumber(value));
      expect(numbers).toStrictEqual([POSITIVE_INT_SMALL, POSITIVE_FLOAT_TYPICAL]);
    });
  });
});
