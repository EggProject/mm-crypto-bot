import type { NonEmptyArray } from './non-empty-array';
import {
  TEST_ARRAY_LENGTH_3,
  TEST_VALUE_10,
  TEST_REDUCE_SUM_15,
  TEST_REDUCE_SUM_10,
  TEST_VALUE_5,
} from './test-constants';

const TEST_ELEMENT_3 = 3;
const TEST_ELEMENT_4 = 4;
const TEST_ELEMENT_6 = 6;
const TEST_ELEMENT_8 = 8;
const TEST_ELEMENT_20 = 20;
const TEST_ELEMENT_30 = 30;

describe('NonEmptyArray', () => {
  describe('type validation', () => {
    it('should accept arrays with at least one element', () => {
      const singleElement: NonEmptyArray<number> = [1];
      const multipleElements: NonEmptyArray<string> = ['a', 'b', 'c'];
      const mixedTypes: NonEmptyArray<string | number> = [1, 'a', 2];

      expect(singleElement).toHaveLength(1);
      expect(multipleElements).toHaveLength(TEST_ARRAY_LENGTH_3);
      expect(mixedTypes).toHaveLength(TEST_ARRAY_LENGTH_3);
    });

    it('should infer correct element type', () => {
      const numbers: NonEmptyArray<number> = [1, 2, TEST_ELEMENT_3];
      const strings: NonEmptyArray<string> = ['hello', 'world'];

      expectTypeOf(numbers[0]).toEqualTypeOf<number>();
      expectTypeOf(strings[0]).toEqualTypeOf<string>();
    });

    it('should be compatible with array methods', () => {
      const array: NonEmptyArray<number> = [1, 2, TEST_ELEMENT_3, TEST_ELEMENT_4, TEST_VALUE_5];

      const mapped = array.map(x => x * 2);
      const filtered = array.filter(x => x > 2);
      const reduced = array.reduce((accumulator, x) => accumulator + x, 0);

      expect(mapped).toStrictEqual([
        2,
        TEST_ELEMENT_4,
        TEST_ELEMENT_6,
        TEST_ELEMENT_8,
        TEST_VALUE_10,
      ]);
      expect(filtered).toStrictEqual([TEST_ELEMENT_3, TEST_ELEMENT_4, TEST_VALUE_5]);
      expect(reduced).toBe(TEST_REDUCE_SUM_15);
    });

    it('should guarantee first element access is safe', () => {
      const array: NonEmptyArray<string> = ['first', 'second', 'third'];

      const firstElement = array[0];

      expect(firstElement).toBe('first');
      expectTypeOf(firstElement).toEqualTypeOf<string>();
      expectTypeOf(firstElement).not.toEqualTypeOf<string | undefined>();
    });
  });

  describe('function usage', () => {
    it('should work as function parameter type', () => {
      function getFirst<T>(array: NonEmptyArray<T>): T {
        return array[0];
      }

      const result = getFirst([TEST_VALUE_10, TEST_ELEMENT_20, TEST_ELEMENT_30]);
      expect(result).toBe(TEST_VALUE_10);
    });

    it('should work with reduce without initial value', () => {
      function sum(numbers: NonEmptyArray<number>): number {
        return numbers.reduce((a, b) => a + b);
      }

      const result = sum([1, 2, TEST_ELEMENT_3, TEST_ELEMENT_4]);
      expect(result).toBe(TEST_REDUCE_SUM_10);
    });

    it('should work as return type', () => {
      function createNonEmpty<T>(first: T, ...rest: T[]): NonEmptyArray<T> {
        return [first, ...rest];
      }

      const result = createNonEmpty('a', 'b', 'c');
      expect(result).toStrictEqual(['a', 'b', 'c']);
      expectTypeOf(result).toEqualTypeOf<NonEmptyArray<string>>();
    });
  });

  describe('edge cases', () => {
    it('should handle single element array', () => {
      const single: NonEmptyArray<boolean> = [true];

      expect(single).toHaveLength(1);
      expect(single[0]).toBe(true);
    });

    it('should handle complex object types', () => {
      interface User {
        id: number;
        name: string;
      }

      const users: NonEmptyArray<User> = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];

      expect(users[0].name).toBe('Alice');
      expectTypeOf(users[0]).toEqualTypeOf<User>();
    });

    it('should work with nested arrays', () => {
      const nested: NonEmptyArray<number[]> = [
        [1, 2],
        [TEST_ELEMENT_3, TEST_ELEMENT_4],
        [TEST_VALUE_5],
      ];

      expect(nested).toHaveLength(TEST_ARRAY_LENGTH_3);
      expect(nested[0]).toStrictEqual([1, 2]);
    });

    it('should support readonly arrays', () => {
      const readonlyArray: Readonly<NonEmptyArray<number>> = [1, 2, TEST_ELEMENT_3];

      expect(readonlyArray[0]).toBe(1);
      expectTypeOf(readonlyArray[0]).toEqualTypeOf<number>();
    });
  });
});
