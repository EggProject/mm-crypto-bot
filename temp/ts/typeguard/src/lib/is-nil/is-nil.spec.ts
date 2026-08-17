import { isNil } from './is-nil';
import {
  POSITIVE_INT_ZERO,
  POSITIVE_INT_SMALL,
  NEGATIVE_INT_ONE,
  POSITIVE_FLOAT_TYPICAL,
} from '../test-constants';

describe('isNil', () => {
  it('should return true for undefined', () => {
    expect(isNil()).toBe(true);
  });

  it('should return true for null', () => {
    const value: string | undefined = undefined;
    expect(isNil(value)).toBe(true);
  });

  it('should return false for zero', () => {
    expect(isNil(POSITIVE_INT_ZERO)).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isNil('')).toBe(false);
  });

  it('should return false for false', () => {
    expect(isNil(false)).toBe(false);
  });

  it('should return false for empty array', () => {
    expect(isNil([])).toBe(false);
  });

  it('should return false for empty object', () => {
    expect(isNil({})).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(isNil(POSITIVE_INT_SMALL)).toBe(false);
    expect(isNil(NEGATIVE_INT_ONE)).toBe(false);
    expect(isNil(POSITIVE_FLOAT_TYPICAL)).toBe(false);
  });

  it('should return false for strings', () => {
    expect(isNil('test')).toBe(false);
    expect(isNil('null')).toBe(false);
    expect(isNil('undefined')).toBe(false);
  });

  it('should return false for booleans', () => {
    expect(isNil(true)).toBe(false);
    expect(isNil(false)).toBe(false);
  });

  it('should return false for objects', () => {
    expect(isNil({ key: 'value' })).toBe(false);
    expect(isNil(new Date())).toBe(false);
  });

  it('should return false for arrays', () => {
    expect(isNil([POSITIVE_INT_SMALL, POSITIVE_INT_SMALL])).toBe(false);
  });

  it('should return false for functions', () => {
    expect(
      isNil(() => {
        /* empty */
      }),
    ).toBe(false);
  });

  it('should work as type guard to narrow null/undefined', () => {
    const value: string | undefined = 'test';
    if (!isNil(value)) {
      const test: string = value;
      expect(test).toBe('test');
    }
  });

  it('should work with filter to remove nil values', () => {
    const values = [
      POSITIVE_INT_SMALL,
      undefined,
      POSITIVE_INT_SMALL,
      undefined,
      POSITIVE_INT_SMALL,
      undefined,
    ];
    const nonNil = values.filter(v => !isNil(v));
    expect(nonNil).toStrictEqual([POSITIVE_INT_SMALL, POSITIVE_INT_SMALL, POSITIVE_INT_SMALL]);
  });
});
