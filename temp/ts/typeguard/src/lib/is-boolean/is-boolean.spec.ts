import { isBoolean } from './is-boolean';
import { POSITIVE_INT_ZERO, POSITIVE_INT_ONE, POSITIVE_INT_SMALL } from '../test-constants';

describe('isBoolean', () => {
  it('should return true for boolean true', () => {
    expect(isBoolean(true)).toBe(true);
  });

  it('should return true for boolean false', () => {
    expect(isBoolean(false)).toBe(true);
  });

  it('should return false for number', () => {
    expect(isBoolean(POSITIVE_INT_ONE)).toBe(false);
    expect(isBoolean(POSITIVE_INT_ZERO)).toBe(false);
    expect(isBoolean(POSITIVE_INT_SMALL)).toBe(false);
  });

  it('should return false for string', () => {
    expect(isBoolean('true')).toBe(false);
    expect(isBoolean('false')).toBe(false);
    expect(isBoolean('test')).toBe(false);
    expect(isBoolean('')).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isBoolean()).toBe(false);
  });

  it('should return false for objects and arrays', () => {
    expect(isBoolean({})).toBe(false);
    expect(isBoolean([])).toBe(false);
    expect(isBoolean({ value: true })).toBe(false);
    expect(isBoolean([true])).toBe(false);
  });

  it('should return false for functions', () => {
    expect(isBoolean(() => true)).toBe(false);
    expect(isBoolean(() => false)).toBe(false);
  });

  it('should return false for symbols', () => {
    expect(isBoolean(Symbol('test'))).toBe(false);
  });

  it('should work as type guard', () => {
    const value: unknown = true;
    if (isBoolean(value)) {
      const isTest: boolean = value;
      expect(isTest).toBe(true);
    }
  });
});
