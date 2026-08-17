import { isObject } from './is-object';
import { POSITIVE_INT_ZERO, POSITIVE_INT_SMALL, POSITIVE_FLOAT_TYPICAL } from '../test-constants';

describe('isObject', () => {
  describe('plain objects', () => {
    it('should return true for empty object', () => {
      expect(isObject({})).toBe(true);
    });

    it('should return true for objects with properties', () => {
      expect(isObject({ key: 'value' })).toBe(true);
      expect(isObject({ a: 1, b: 2 })).toBe(true);
    });

    it('should return true for nested objects', () => {
      expect(isObject({ nested: { key: 'value' } })).toBe(true);
    });
  });

  describe('special objects', () => {
    it('should return true for Date objects', () => {
      expect(isObject(new Date())).toBe(true);
    });

    it('should return true for Map objects', () => {
      expect(isObject(new Map())).toBe(true);
    });

    it('should return true for Set objects', () => {
      expect(isObject(new Set())).toBe(true);
    });

    it('should return true for RegExp objects', () => {
      expect(isObject(/test/)).toBe(true);
    });

    it('should return true for Error objects', () => {
      expect(isObject(new Error('test error'))).toBe(true);
    });

    it('should return true for custom class instances', () => {
      class CustomClass {}
      expect(isObject(new CustomClass())).toBe(true);
    });
  });

  describe('arrays', () => {
    it('should return false for empty array', () => {
      expect(isObject([])).toBe(false);
    });

    it('should return false for arrays with elements', () => {
      expect(isObject([POSITIVE_INT_SMALL])).toBe(false);
      expect(isObject(['a', 'b'])).toBe(false);
    });
  });

  describe('null', () => {
    it('should return false for null', () => {
      expect(isObject()).toBe(false);
    });
  });

  describe('primitives', () => {
    it('should return false for strings', () => {
      expect(isObject('string')).toBe(false);
      expect(isObject('')).toBe(false);
    });

    it('should return false for numbers', () => {
      expect(isObject(POSITIVE_INT_SMALL)).toBe(false);
      expect(isObject(POSITIVE_INT_ZERO)).toBe(false);
      expect(isObject(POSITIVE_FLOAT_TYPICAL)).toBe(false);
    });

    it('should return false for booleans', () => {
      expect(isObject(true)).toBe(false);
      expect(isObject(false)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isObject()).toBe(false);
    });

    it('should return false for symbols', () => {
      expect(isObject(Symbol('test'))).toBe(false);
    });
  });

  describe('functions', () => {
    it('should return false for regular functions', () => {
      expect(
        isObject((): void => {
          /* empty */
        }),
      ).toBe(false);
      expect(
        isObject((): void => {
          /* empty */
        }),
      ).toBe(false);
    });

    it('should return false for class constructors', () => {
      class MyClass {}
      expect(isObject(MyClass)).toBe(false);
    });
  });

  describe('type guard', () => {
    it('should work as type guard', () => {
      const value: unknown = { key: 'value' };
      if (isObject(value)) {
        const object: object = value;
        expect(object).toStrictEqual({ key: 'value' });
      }
    });

    it('should filter objects from mixed array', () => {
      const mixed: unknown[] = [{}, 'string', POSITIVE_INT_SMALL, { a: 1 }, undefined, []];
      const objects = mixed.filter(value => isObject(value));
      expect(objects).toStrictEqual([{}, { a: 1 }]);
    });
  });

  describe('edge cases', () => {
    it('should return true for Object.create(null)', () => {
      expect(isObject(Object.create(null))).toBe(true);
    });

    it('should return true for objects created with new Object()', () => {
      expect(isObject(new Object())).toBe(true);
    });
  });
});
