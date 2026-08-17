import type {
  StringResolver,
  NumberResolver,
  IntResolver,
  FloatResolver,
  BooleanResolver,
} from './primitive.resolver';
import {
  TEST_USER_AGE_30,
  TEST_USER_AGE_20,
  TEST_USER_AGE_16,
  TEST_USER_AGE_18,
  TEST_VALUE_42,
  TEST_VALUE_5,
  TEST_VALUE_10,
  TEST_PRICE_100,
  TEST_PRICE_99_99,
  TEST_PRICE_49_5,
  TEST_RESULT_110,
  TEST_TAX_10,
  TEST_MULTIPLIER_1_2,
  TEST_RESULT_120,
  TEST_DIVISOR_3,
  TEST_RESULT_3_333,
  TEST_DECIMAL_3_14,
  TEST_PRECISION_2,
  TEST_PRECISION_3,
  TEST_BALANCE_1234_56,
  TEST_COUNT_5,
  TEST_PRICE_FORMAT_99_99,
  TEST_PRICE_FORMAT_49_50,
  TEST_RESULT_NO_ITEMS,
  TEST_RESULT_1_ITEM,
  TEST_RESULT_3_ITEMS,
} from '../test-constants';

// Local type guard to avoid circular dependency with @streamnet/ts-typeguard
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

// Helper functions moved to outer scope
function getLabel<T>(item: T, resolver: StringResolver<T>): string {
  return isFunction(resolver) ? resolver(item) : resolver;
}

function getValue<T>(item: T, resolver: NumberResolver<T>): number {
  return isFunction(resolver) ? resolver(item) : resolver;
}

function formatPrice<T>(item: T, resolver: FloatResolver<T>): string {
  const value = isFunction(resolver) ? resolver(item) : resolver;
  return `$${value.toFixed(2)}`;
}

function isEnabled<T>(item: T, resolver: BooleanResolver<T>): boolean {
  return isFunction(resolver) ? resolver(item) : resolver;
}

// Test resolvers moved to outer scope
const nameResolver: StringResolver<{ name: string }> = item => item.name;
const fullNameResolver: StringResolver<{
  firstName: string;
  lastName: string;
}> = item => `${item.firstName} ${item.lastName}`;
const ageResolver: NumberResolver<{ age: number }> = item => item.age;
const priceWithTaxResolver: NumberResolver<{ price: number; tax: number }> = item =>
  item.price + item.tax;
const arrayLengthResolver: IntResolver<{ items: unknown[] }> = item => item.items.length;
const mathFloorResolver: IntResolver<{ value: number }> = item => Math.floor(item.value);
const textLengthResolver: IntResolver<{ text: string }> = item => item.text.length;
const priceMultiplierResolver: FloatResolver<{ price: number }> = item =>
  item.price * TEST_MULTIPLIER_1_2;
const divisionResolver: FloatResolver<{ value: number }> = item => item.value / TEST_DIVISOR_3;
const activeResolver: BooleanResolver<{ active: boolean }> = item => item.active;
const ageCheckResolver: BooleanResolver<{ age: number }> = item => item.age >= TEST_USER_AGE_18;
const complexStringResolver: StringResolver<{ items: string[] }> = item => {
  if (item.items.length === 0) {
    return 'No items';
  }
  if (item.items.length === 1) {
    return '1 item';
  }
  return `${item.items.length} items`;
};
const nanHandlingResolver: NumberResolver<{ value?: number }> = item => item.value ?? 0;
const nullishCoalescingResolver: BooleanResolver<{ enabled?: boolean }> = item =>
  item.enabled ?? false;
const labelResolver: StringResolver<{ label: string; count: number }> = d => d.label;
const countResolver: NumberResolver<{ label: string; count: number }> = d => d.count;

describe('Primitive Resolvers', () => {
  describe('StringResolver', () => {
    it('should accept static string values', () => {
      const staticValue: StringResolver<unknown> = 'Hello World';

      expect(staticValue).toBe('Hello World');
      expectTypeOf(staticValue).toExtend<string | ((item: never) => string)>();
    });

    it('should accept resolver functions', () => {
      const result = nameResolver({ name: 'Alice' });

      expect(result).toBe('Alice');
    });

    it('should work in utility functions', () => {
      const staticResult = getLabel({ name: 'Bob' }, 'Static Label');
      const dynamicResult = getLabel({ name: 'Charlie' }, item => item.name);

      expect(staticResult).toBe('Static Label');
      expect(dynamicResult).toBe('Charlie');
    });

    it('should work with template strings in functions', () => {
      const result = fullNameResolver({ firstName: 'John', lastName: 'Doe' });

      expect(result).toBe('John Doe');
    });
  });

  describe('NumberResolver', () => {
    it('should accept static number values', () => {
      const staticValue: NumberResolver<unknown> = TEST_VALUE_42;

      expect(staticValue).toBe(TEST_VALUE_42);
      expectTypeOf(staticValue).toExtend<number | ((item: never) => number)>();
    });

    it('should accept resolver functions', () => {
      const result = ageResolver({ age: TEST_USER_AGE_30 });

      expect(result).toBe(TEST_USER_AGE_30);
    });

    it('should work with calculations', () => {
      const result = priceWithTaxResolver({
        price: TEST_PRICE_100,
        tax: TEST_TAX_10,
      });

      expect(result).toBe(TEST_RESULT_110);
    });

    it('should work in utility functions', () => {
      expect(getValue({}, TEST_PRICE_100)).toBe(TEST_PRICE_100);
      expect(getValue({ count: TEST_VALUE_5 }, item => item.count * 2)).toBe(TEST_VALUE_10);
    });
  });

  describe('IntResolver', () => {
    it('should accept static integer values', () => {
      const staticValue: IntResolver<unknown> = TEST_VALUE_10;

      expect(staticValue).toBe(TEST_VALUE_10);
      expectTypeOf(staticValue).toExtend<number | ((item: never) => number)>();
    });

    it('should accept resolver functions returning integers', () => {
      const ARRAY_ITEM_4 = 4;
      const result = arrayLengthResolver({
        items: [1, 2, TEST_DIVISOR_3, ARRAY_ITEM_4, TEST_VALUE_5],
      });

      expect(result).toBe(TEST_VALUE_5);
    });

    it('should work with Math.floor operations', () => {
      const result = mathFloorResolver({ value: TEST_DECIMAL_3_14 });

      expect(result).toBe(TEST_DIVISOR_3);
    });

    it('should work with counters', () => {
      expect(textLengthResolver({ text: 'hello' })).toBe(TEST_VALUE_5);
    });
  });

  describe('FloatResolver', () => {
    it('should accept static float values', () => {
      const staticValue: FloatResolver<unknown> = TEST_PRICE_99_99;

      expect(staticValue).toBe(TEST_PRICE_99_99);
      expectTypeOf(staticValue).toExtend<number | ((item: never) => number)>();
    });

    it('should accept resolver functions returning floats', () => {
      const result = priceMultiplierResolver({ price: TEST_PRICE_100 });

      expect(result).toBeCloseTo(TEST_RESULT_120, TEST_PRECISION_2);
    });

    it('should work with decimal calculations', () => {
      const result = divisionResolver({ value: TEST_VALUE_10 });

      expect(result).toBeCloseTo(TEST_RESULT_3_333, TEST_PRECISION_3);
    });

    it('should work in price formatting', () => {
      expect(formatPrice({ price: TEST_PRICE_99_99 }, item => item.price)).toBe(
        TEST_PRICE_FORMAT_99_99,
      );
      expect(formatPrice({}, TEST_PRICE_49_5)).toBe(TEST_PRICE_FORMAT_49_50);
    });
  });

  describe('BooleanResolver', () => {
    it('should accept static boolean values', () => {
      const staticTrue: BooleanResolver<unknown> = true;
      const staticFalse: BooleanResolver<unknown> = false;

      expect(staticTrue).toBe(true);
      expect(staticFalse).toBe(false);
      expectTypeOf(staticTrue).toExtend<boolean | ((item: never) => boolean)>();
    });

    it('should accept resolver functions', () => {
      expect(activeResolver({ active: true })).toBe(true);
      expect(activeResolver({ active: false })).toBe(false);
    });

    it('should work with conditional logic', () => {
      expect(ageCheckResolver({ age: TEST_USER_AGE_20 })).toBe(true);
      expect(ageCheckResolver({ age: TEST_USER_AGE_16 })).toBe(false);
    });

    it('should work in utility functions', () => {
      expect(isEnabled({}, true)).toBe(true);
      expect(isEnabled({ enabled: false }, item => item.enabled)).toBe(false);
    });
  });
});

describe('Primitive Resolvers - combined and edge cases', () => {
  describe('combined usage', () => {
    interface User {
      name: string;
      age: number;
      isActive: boolean;
      balance: number;
    }

    it('should work with multiple resolvers in a configuration object', () => {
      const config = {
        nameResolver: ((user: User) => user.name) as StringResolver<User>,
        ageResolver: ((user: User) => user.age) as NumberResolver<User>,
        activeResolver: ((user: User) => user.isActive) as BooleanResolver<User>,
        balanceResolver: ((user: User) => user.balance) as FloatResolver<User>,
      };

      const user: User = {
        name: 'Alice',
        age: TEST_USER_AGE_30,
        isActive: true,
        balance: TEST_BALANCE_1234_56,
      };

      expect(
        isFunction(config.nameResolver) ? config.nameResolver(user) : config.nameResolver,
      ).toBe('Alice');
      expect(isFunction(config.ageResolver) ? config.ageResolver(user) : config.ageResolver).toBe(
        TEST_USER_AGE_30,
      );
      expect(
        isFunction(config.activeResolver) ? config.activeResolver(user) : config.activeResolver,
      ).toBe(true);
      expect(
        isFunction(config.balanceResolver) ? config.balanceResolver(user) : config.balanceResolver,
      ).toBe(TEST_BALANCE_1234_56);
    });

    it('should work in table column configurations', () => {
      interface Column<T> {
        label: StringResolver<T>;
        value: StringResolver<T> | NumberResolver<T>;
        visible: BooleanResolver<T>;
      }

      const columns: Column<User>[] = [
        {
          label: 'Name',
          value: user => user.name,
          visible: true,
        },
        {
          label: 'Age',
          value: user => user.age,
          visible: user => user.isActive,
        },
      ];

      expect(columns).toHaveLength(2);
      expect(columns[0].label).toBe('Name');
    });
  });

  describe('edge cases', () => {
    it('should handle resolver functions with complex logic', () => {
      expect(complexStringResolver({ items: [] })).toBe(TEST_RESULT_NO_ITEMS);
      expect(complexStringResolver({ items: ['a'] })).toBe(TEST_RESULT_1_ITEM);
      expect(complexStringResolver({ items: ['a', 'b', 'c'] })).toBe(TEST_RESULT_3_ITEMS);
    });

    it('should handle number resolver with NaN handling', () => {
      expect(nanHandlingResolver({ value: TEST_VALUE_42 })).toBe(TEST_VALUE_42);
      expect(nanHandlingResolver({ value: undefined })).toBe(0);
      expect(nanHandlingResolver({})).toBe(0);
    });

    it('should handle boolean resolver with nullish coalescing', () => {
      expect(nullishCoalescingResolver({ enabled: true })).toBe(true);
      expect(nullishCoalescingResolver({ enabled: false })).toBe(false);
      expect(nullishCoalescingResolver({})).toBe(false);
    });

    it('should work with arrow functions and type inference', () => {
      const data = { label: 'Test', count: TEST_COUNT_5 };

      expect(labelResolver(data)).toBe('Test');
      expect(countResolver(data)).toBe(TEST_COUNT_5);
    });
  });
});
