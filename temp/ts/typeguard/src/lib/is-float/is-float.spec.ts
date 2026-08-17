import { isFloat } from './is-float';
import {
  POSITIVE_INT_ZERO,
  POSITIVE_INT_SMALL,
  POSITIVE_FLOAT_TINY,
  POSITIVE_FLOAT_SMALL,
  POSITIVE_FLOAT_MEDIUM,
  POSITIVE_FLOAT_TYPICAL,
  POSITIVE_FLOAT_LARGE,
  NEGATIVE_INT_SMALL,
  NEGATIVE_FLOAT_SMALL,
  NEGATIVE_FLOAT_LARGE,
} from '../test-constants';

describe('isFloat', () => {
  it('should return true for positive floating-point numbers', () => {
    expect(isFloat(POSITIVE_FLOAT_TYPICAL)).toBe(true);
    expect(isFloat(POSITIVE_FLOAT_MEDIUM)).toBe(true);
    expect(isFloat(POSITIVE_FLOAT_LARGE)).toBe(true);
    expect(isFloat(POSITIVE_FLOAT_SMALL)).toBe(true);
  });

  it('should return true for negative floating-point numbers', () => {
    expect(isFloat(NEGATIVE_FLOAT_LARGE)).toBe(true);
    expect(isFloat(NEGATIVE_FLOAT_SMALL)).toBe(true);
    expect(isFloat(NEGATIVE_FLOAT_LARGE)).toBe(true);
  });

  it('should return false for integers', () => {
    expect(isFloat(POSITIVE_INT_SMALL)).toBe(false);
    expect(isFloat(POSITIVE_INT_ZERO)).toBe(false);
    expect(isFloat(NEGATIVE_INT_SMALL)).toBe(false);
  });

  it('should return false for strings', () => {
    expect(isFloat('3.14')).toBe(false);
    expect(isFloat('0.5')).toBe(false);
    expect(isFloat('42')).toBe(false);
  });

  it('should return false for NaN', () => {
    expect(isFloat(NaN)).toBe(false);
  });

  it('should return false for Infinity', () => {
    expect(isFloat(Infinity)).toBe(false);
    expect(isFloat(-Infinity)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isFloat()).toBe(false);
  });

  it('should return false for booleans', () => {
    expect(isFloat(true)).toBe(false);
    expect(isFloat(false)).toBe(false);
  });

  it('should return false for objects and arrays', () => {
    expect(isFloat({})).toBe(false);
    expect(isFloat([])).toBe(false);
    expect(isFloat({ value: Math.PI })).toBe(false);
  });

  it('should work as type guard', () => {
    const value: unknown = POSITIVE_FLOAT_TYPICAL;
    if (isFloat(value)) {
      const test: number = value;
      expect(test).toBe(POSITIVE_FLOAT_TYPICAL);
    }
  });

  it('should handle edge cases with very small decimals', () => {
    expect(isFloat(POSITIVE_FLOAT_TINY)).toBe(true);
    expect(isFloat(Number.EPSILON)).toBe(true);
  });
});
