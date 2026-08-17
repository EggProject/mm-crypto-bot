import { isInt } from './is-int';
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
  NEGATIVE_FLOAT_MEDIUM,
  POSITIVE_FLOAT_LARGE,
} from '../test-constants';

describe('isInt', () => {
  it('should return true for positive integers', () => {
    expect(isInt(POSITIVE_INT_SMALL)).toBe(true);
    expect(isInt(POSITIVE_INT_ZERO)).toBe(true);
    expect(isInt(POSITIVE_INT_ONE)).toBe(true);
    expect(isInt(POSITIVE_INT_MEDIUM)).toBe(true);
  });

  it('should return true for negative integers', () => {
    expect(isInt(NEGATIVE_INT_SMALL)).toBe(true);
    expect(isInt(NEGATIVE_INT_ONE)).toBe(true);
    expect(isInt(NEGATIVE_INT_MEDIUM)).toBe(true);
  });

  it('should return true for zero', () => {
    expect(isInt(POSITIVE_INT_ZERO)).toBe(true);
    expect(isInt(-POSITIVE_INT_ZERO)).toBe(true);
  });

  it('should return false for floating-point numbers', () => {
    expect(isInt(POSITIVE_FLOAT_TYPICAL)).toBe(false);
    expect(isInt(POSITIVE_FLOAT_MEDIUM)).toBe(false);
    expect(isInt(NEGATIVE_FLOAT_MEDIUM)).toBe(false);
    expect(isInt(POSITIVE_FLOAT_LARGE)).toBe(false);
  });

  it('should return false for strings', () => {
    expect(isInt('42')).toBe(false);
    expect(isInt('3.14')).toBe(false);
    expect(isInt('test')).toBe(false);
  });

  it('should return false for NaN', () => {
    expect(isInt(NaN)).toBe(false);
  });

  it('should return false for Infinity', () => {
    expect(isInt(Infinity)).toBe(false);
    expect(isInt(-Infinity)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isInt()).toBe(false);
  });

  it('should return false for booleans', () => {
    expect(isInt(true)).toBe(false);
    expect(isInt(false)).toBe(false);
  });

  it('should return false for objects and arrays', () => {
    expect(isInt({})).toBe(false);
    expect(isInt([])).toBe(false);
    expect(isInt({ value: 42 })).toBe(false);
  });

  it('should work as type guard', () => {
    const value: unknown = POSITIVE_INT_SMALL;
    if (isInt(value)) {
      const test: number = value;
      expect(test).toBe(POSITIVE_INT_SMALL);
    }
  });

  it('should handle large integers', () => {
    expect(isInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isInt(Number.MIN_SAFE_INTEGER)).toBe(true);
  });
});
