import { isString } from './is-string';
import { POSITIVE_INT_ZERO, POSITIVE_FLOAT_TYPICAL, MAGIC_NUMBER_123 } from '../test-constants';

describe('isString', () => {
  it('should return true for regular strings', () => {
    expect(isString('hello')).toBe(true);
    expect(isString('test')).toBe(true);
    expect(isString('123')).toBe(true);
  });

  it('should return true for empty string', () => {
    expect(isString('')).toBe(true);
  });

  it('should return true for template literals', () => {
    const name = 'World';
    expect(isString(`Hello ${name}`)).toBe(true);
    expect(isString(`template`)).toBe(true);
  });

  it('should return true for String constructor result', () => {
    expect(isString(String(MAGIC_NUMBER_123))).toBe(true);
    expect(isString(String(true))).toBe(true);
  });

  it('should return false for numbers', () => {
    expect(isString(MAGIC_NUMBER_123)).toBe(false);
    expect(isString(POSITIVE_INT_ZERO)).toBe(false);
    expect(isString(POSITIVE_FLOAT_TYPICAL)).toBe(false);
    expect(isString(NaN)).toBe(false);
  });

  it('should return false for booleans', () => {
    expect(isString(true)).toBe(false);
    expect(isString(false)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isString()).toBe(false);
  });

  it('should return false for objects', () => {
    expect(isString({})).toBe(false);
    expect(isString({ value: 'string' })).toBe(false);
  });

  it('should return false for arrays', () => {
    expect(isString([])).toBe(false);
    expect(isString(['string'])).toBe(false);
  });

  it('should return false for functions', () => {
    expect(isString(() => 'string')).toBe(false);
  });

  it('should return false for symbols', () => {
    expect(isString(Symbol('test'))).toBe(false);
  });

  it('should work as type guard', () => {
    const value: unknown = 'test';
    if (isString(value)) {
      const upperCase = value.toUpperCase();
      expect(upperCase).toBe('TEST');
    }
  });

  it('should work with filter operations', () => {
    const mixed: unknown[] = ['hello', MAGIC_NUMBER_123, 'world', undefined, 'test'];
    const strings = mixed.filter(value => isString(value));
    expect(strings).toStrictEqual(['hello', 'world', 'test']);
  });

  it('should handle unicode strings', () => {
    expect(isString('こんにちは')).toBe(true);
    expect(isString('😀')).toBe(true);
    expect(isString('🌍🌎🌏')).toBe(true);
  });
});
