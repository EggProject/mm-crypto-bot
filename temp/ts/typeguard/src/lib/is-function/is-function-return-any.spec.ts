import { isFunctionReturnAny } from './is-function-return-any';
import { MAGIC_NUMBER_123 } from '../test-constants';

function returnsAnything(): unknown {
  return JSON.parse('0');
}

function regularFunction(): string {
  return 'test';
}

const arrowFunction = (): string => 'test';

// eslint-disable-next-line require-await
const asyncFunction = async (): Promise<string> => 'test';

const typeGuardValue = (): { data: string } => ({ data: 'test' });

describe('isFunctionReturnAny', () => {
  it('should return true for function returning any type', () => {
    expect(isFunctionReturnAny(returnsAnything)).toBe(true);
  });

  it('should return true for regular function', () => {
    expect(isFunctionReturnAny(regularFunction)).toBe(true);
  });

  it('should return true for arrow function', () => {
    expect(isFunctionReturnAny(arrowFunction)).toBe(true);
  });

  it('should return true for async function', () => {
    expect(isFunctionReturnAny(asyncFunction)).toBe(true);
  });

  it('should return true for class constructor', () => {
    class MyClass {}
    expect(isFunctionReturnAny(MyClass)).toBe(true);
  });

  it('should return false for strings', () => {
    expect(isFunctionReturnAny('string')).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(isFunctionReturnAny(MAGIC_NUMBER_123)).toBe(false);
  });

  it('should return false for objects', () => {
    expect(isFunctionReturnAny({})).toBe(false);
  });

  it('should return false for arrays', () => {
    expect(isFunctionReturnAny([])).toBe(false);
  });

  it('should return false for null and undefined', () => {
    expect(isFunctionReturnAny(undefined)).toBe(false);
    expect(isFunctionReturnAny(null)).toBe(false);
  });

  it('should work as type guard with any return type', () => {
    if (!isFunctionReturnAny(typeGuardValue)) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const result = typeGuardValue();
    expect(result).toBeDefined();
  });
});
