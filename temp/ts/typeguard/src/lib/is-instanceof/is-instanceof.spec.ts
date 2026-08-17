import { isInstanceof } from './is-instanceof';
import { POSITIVE_INT_SMALL, ARRAY_LENGTH_SINGLE, POSITIVE_INT_MEDIUM } from '../test-constants';

class CustomClass {
  value = 'test';
}

class OtherClass {
  data = POSITIVE_INT_SMALL;
}

class ExtendedClass extends CustomClass {
  extra = 'extended';
}

describe('isInstanceof', () => {
  describe('custom classes', () => {
    it('should return true for instance of the same class', () => {
      const instance = new CustomClass();
      expect(isInstanceof(instance, CustomClass)).toBe(true);
    });

    it('should return false for instance of different class', () => {
      const instance = new CustomClass();
      expect(isInstanceof(instance, OtherClass)).toBe(false);
    });

    it('should return true for instance of parent class', () => {
      const instance = new ExtendedClass();
      expect(isInstanceof(instance, CustomClass)).toBe(true);
    });

    it('should return true for instance of extended class', () => {
      const instance = new ExtendedClass();
      expect(isInstanceof(instance, ExtendedClass)).toBe(true);
    });
  });

  describe('built-in classes', () => {
    it('should return true for Date instances', () => {
      const date = new Date();
      expect(isInstanceof(date, Date)).toBe(true);
    });

    it('should return true for Array instances', () => {
      const array = [POSITIVE_INT_SMALL, 2, POSITIVE_INT_MEDIUM];
      expect(isInstanceof(array, Array)).toBe(true);
    });

    it('should return true for Object instances', () => {
      const object = {};
      expect(isInstanceof(object, Object)).toBe(true);
    });

    it('should return true for Map instances', () => {
      const map = new Map();
      expect(isInstanceof(map, Map)).toBe(true);
    });

    it('should return true for Set instances', () => {
      const set = new Set();
      expect(isInstanceof(set, Set)).toBe(true);
    });

    it('should return true for RegExp instances', () => {
      const regex = /test/;
      expect(isInstanceof(regex, RegExp)).toBe(true);
    });
  });

  describe('primitives', () => {
    it('should return false for primitive strings', () => {
      expect(isInstanceof('string', String)).toBe(false);
    });

    it('should return false for primitive numbers', () => {
      expect(isInstanceof(POSITIVE_INT_SMALL, Number)).toBe(false);
    });

    it('should return false for primitive booleans', () => {
      expect(isInstanceof(true, Boolean)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isInstanceof(undefined, Object)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isInstanceof(undefined, Object)).toBe(false);
    });
  });

  describe('type guard', () => {
    it('should work as type guard', () => {
      const value: unknown = new CustomClass();
      if (isInstanceof(value, CustomClass)) {
        expect(value.value).toBe('test');
      }
    });

    it('should properly narrow types', () => {
      const values: unknown[] = [new Date(), 'string', new CustomClass(), POSITIVE_INT_SMALL];
      const dates = values.filter((v): v is Date => isInstanceof(v, Date));
      expect(dates).toHaveLength(ARRAY_LENGTH_SINGLE);
      expect(dates[0]).toBeInstanceOf(Date);
    });
  });
});
