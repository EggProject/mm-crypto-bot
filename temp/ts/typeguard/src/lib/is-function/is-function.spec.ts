import { isFunction } from './is-function';
import { MAGIC_NUMBER_123, POSITIVE_INT_ZERO } from '../test-constants';

function regularFunction(): string {
  return 'test';
}

const arrowFunction = (): string => 'test';

const anonymousFunction = function (): string {
  return 'test';
};

// eslint-disable-next-line require-await
const asyncFunction = async (): Promise<string> => 'test';

const typeGuardValue: unknown = (): string => 'test';

describe('isFunction', () => {
  it('should return true for regular function', () => {
    expect(isFunction(regularFunction)).toBe(true);
  });

  it('should return true for arrow function', () => {
    expect(isFunction(arrowFunction)).toBe(true);
  });

  it('should return true for anonymous function', () => {
    expect(isFunction(anonymousFunction)).toBe(true);
  });

  it('should return true for async function', () => {
    expect(isFunction(asyncFunction)).toBe(true);
  });

  it('should return true for class constructor', () => {
    class MyClass {}
    expect(isFunction(MyClass)).toBe(true);
  });

  it('should return true for built-in constructors', () => {
    expect(isFunction(Array)).toBe(true);
    expect(isFunction(Object)).toBe(true);
    expect(isFunction(Date)).toBe(true);
    expect(isFunction(String)).toBe(true);
  });

  it('should return false for strings', () => {
    expect(isFunction('string')).toBe(false);
    expect(isFunction('function')).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(isFunction(MAGIC_NUMBER_123)).toBe(false);
    expect(isFunction(POSITIVE_INT_ZERO)).toBe(false);
    expect(isFunction(NaN)).toBe(false);
  });

  it('should return false for booleans', () => {
    expect(isFunction(true)).toBe(false);
    expect(isFunction(false)).toBe(false);
  });

  it('should return false for null and undefined', () => {
    expect(isFunction(undefined)).toBe(false);
    expect(isFunction(null)).toBe(false);
  });

  it('should return false for objects', () => {
    expect(isFunction({})).toBe(false);
    expect(
      isFunction({
        fn: () => {
          /* empty */
        },
      }),
    ).toBe(false);
  });

  it('should return false for arrays', () => {
    expect(isFunction([])).toBe(false);
    expect(
      isFunction([
        () => {
          /* empty */
        },
      ]),
    ).toBe(false);
  });

  it('should work as type guard', () => {
    if (!isFunction(typeGuardValue)) {
      return;
    }

    // Type narrowed to function but as 'never' from unknown, so we need type assertion
    const result = (typeGuardValue as () => string)();
    expect(typeof result).toBe('string');
  });
});
