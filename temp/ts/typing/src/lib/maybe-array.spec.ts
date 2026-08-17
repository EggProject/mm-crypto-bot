import type { MaybeArray } from './maybe-array';
import { TEST_VALUE_42, TEST_VALUE_5, TEST_VALUE_10, TEST_ARRAY_LENGTH_2 } from './test-constants';

const NEGATIVE_5 = -5;
const NEGATIVE_3 = -3;
const ARRAY_ITEM_3 = 3;
const ARRAY_ITEM_4 = 4;
const ARRAY_ITEM_6 = 6;

describe('MaybeArray', () => {
  describe('type validation', () => {
    it('should accept single values', () => {
      const single: MaybeArray<number> = TEST_VALUE_42;

      expect(single).toBe(TEST_VALUE_42);
      expectTypeOf(single).toExtend<number | number[]>();
    });

    it('should accept arrays', () => {
      const array: MaybeArray<number> = [1, 2, ARRAY_ITEM_3];

      expect(array).toStrictEqual([1, 2, ARRAY_ITEM_3]);
      expectTypeOf(array).toExtend<number | number[]>();
    });

    it('should work with different types', () => {
      const stringValue: MaybeArray<string> = 'hello';
      const stringArray: MaybeArray<string> = ['a', 'b', 'c'];
      const boolValue: MaybeArray<boolean> = true;
      const boolArray: MaybeArray<boolean> = [true, false];

      expect(stringValue).toBe('hello');
      expect(stringArray).toStrictEqual(['a', 'b', 'c']);
      expect(boolValue).toBe(true);
      expect(boolArray).toStrictEqual([true, false]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty arrays', () => {
      const empty: MaybeArray<string> = [];

      expect(empty).toStrictEqual([]);
      expect(Array.isArray(empty)).toBe(true);
    });

    it('should work with complex object types', () => {
      interface Item {
        id: number;
        name: string;
      }

      const single: MaybeArray<Item> = { id: 1, name: 'Item1' };
      const multiple: MaybeArray<Item> = [
        { id: 1, name: 'Item1' },
        { id: 2, name: 'Item2' },
      ];

      expect(single.id).toBe(1);
      expect(multiple).toHaveLength(TEST_ARRAY_LENGTH_2);
    });

    it('should work with nested arrays', () => {
      type NestedArray = MaybeArray<number[]>;

      const single: NestedArray = [1, 2, ARRAY_ITEM_3];
      const multiple: NestedArray = [
        [1, 2],
        [ARRAY_ITEM_3, ARRAY_ITEM_4],
      ];

      expect(single).toStrictEqual([1, 2, ARRAY_ITEM_3]);
      expect(multiple).toHaveLength(TEST_ARRAY_LENGTH_2);
    });

    it('should handle null and undefined correctly', () => {
      type NullableMaybeArray = MaybeArray<string | undefined>;

      const value1: NullableMaybeArray = undefined;
      const value2: NullableMaybeArray = [undefined, 'test'];
      const value3: NullableMaybeArray = 'test';

      expect(value1).toBeUndefined();
      expect(value2).toStrictEqual([undefined, 'test']);
      expect(value3).toBe('test');
    });

    it('should work with union types', () => {
      const value1: MaybeArray<string | number> = 'text';
      const value2: MaybeArray<string | number> = TEST_VALUE_42;
      const value3: MaybeArray<string | number> = ['text', TEST_VALUE_42];

      expect(value1).toBe('text');
      expect(value2).toBe(TEST_VALUE_42);
      expect(value3).toStrictEqual(['text', TEST_VALUE_42]);
    });

    it('should work with generic functions', () => {
      function process<T>(value: MaybeArray<T>, function_: (item: T) => T): T[] {
        const array = Array.isArray(value) ? value : [value];
        return array.map(item => function_(item));
      }

      expect(process(TEST_VALUE_5, x => x * 2)).toStrictEqual([TEST_VALUE_10]);
      expect(process([1, 2, ARRAY_ITEM_3], x => x * 2)).toStrictEqual([
        2,
        ARRAY_ITEM_4,
        ARRAY_ITEM_6,
      ]);
      expect(process('hello', x => x.toUpperCase())).toStrictEqual(['HELLO']);
    });

    it('should work with reduce operations', () => {
      function sum(values: MaybeArray<number>): number {
        const array = Array.isArray(values) ? values : [values];

        return array.reduce((accumulator, value) => accumulator + value, 0);
      }

      expect(sum(TEST_VALUE_10)).toBe(TEST_VALUE_10);
      expect(sum([1, 2, ARRAY_ITEM_3, ARRAY_ITEM_4])).toBe(TEST_VALUE_10);
    });

    it('should work with filter operations', () => {
      function filterPositive(values: MaybeArray<number>): number[] {
        const array = Array.isArray(values) ? values : [values];

        return array.filter(v => v > 0);
      }

      expect(filterPositive(TEST_VALUE_5)).toStrictEqual([TEST_VALUE_5]);
      expect(filterPositive([-1, 2, NEGATIVE_3, ARRAY_ITEM_4])).toStrictEqual([2, ARRAY_ITEM_4]);
      expect(filterPositive(NEGATIVE_5)).toStrictEqual([]);
    });

    it('should handle readonly arrays', () => {
      const readonly: MaybeArray<number> = [1, 2, ARRAY_ITEM_3] as const;

      expect(readonly).toStrictEqual([1, 2, ARRAY_ITEM_3]);
    });
  });
});
