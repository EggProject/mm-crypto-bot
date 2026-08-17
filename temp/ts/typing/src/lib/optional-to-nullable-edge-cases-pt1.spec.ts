import type { OptionalToNullable } from './optional-to-nullable';
import { TEST_VALUE_42, TEST_VALUE_10 } from './test-constants';

const NULL_VALUE: null = JSON.parse('null');

function testEdgeCasesPart1(): void {
  describe('OptionalToNullable - edge cases part 1', () => {
    it('should handle empty interfaces', () => {
      interface Empty {
        value?: string;
      }

      type NullableEmpty = OptionalToNullable<Empty>;

      const object: NullableEmpty = {
        value: NULL_VALUE,
      };

      expect(object.value).toBeNull();
    });

    it('should handle all required properties', () => {
      interface AllRequired {
        a: string;
        b: number;
        c: boolean;
      }

      type Nullable = OptionalToNullable<AllRequired>;

      const object: Nullable = {
        a: 'test',
        b: TEST_VALUE_42,
        c: true,
      };

      expectTypeOf(object.a).toEqualTypeOf<string | null>();
      expectTypeOf(object.b).toEqualTypeOf<number | null>();
      expectTypeOf(object.c).toEqualTypeOf<boolean | null>();
    });

    it('should handle mixed required and optional', () => {
      interface Mixed {
        required1: string;
        optional1?: string;
        required2: number;
        optional2?: number;
      }

      type NullableMixed = OptionalToNullable<Mixed>;

      const object: NullableMixed = {
        required1: 'test',
        optional1: NULL_VALUE,
        required2: TEST_VALUE_42,
        optional2: TEST_VALUE_10,
      };

      expect(object.required1).toBe('test');
      expect(object.optional1).toBeNull();
      expect(object.required2).toBe(TEST_VALUE_42);
      expect(object.optional2).toBe(TEST_VALUE_10);
    });

    it('should handle complex nested types', () => {
      interface Complex {
        id: number;
        data?: {
          value: string;
        };
      }

      type NullableComplex = OptionalToNullable<Complex>;

      const object1: NullableComplex = {
        id: 1,
        data: { value: 'test' },
      };

      const object2: NullableComplex = {
        id: 2,
        data: NULL_VALUE,
      };

      expect(object1.data?.value).toBe('test');
      expect(object2.data).toBeNull();
    });

    it('should work with generic types', () => {
      interface Container<T> {
        value: T;
        metadata?: Record<string, string>;
      }

      type NullableContainer<T> = OptionalToNullable<Container<T>>;

      const stringContainer: NullableContainer<string> = {
        value: 'hello',
        metadata: NULL_VALUE,
      };

      const numberContainer: NullableContainer<number> = {
        value: TEST_VALUE_42,
        metadata: { key: 'value' },
      };

      expect(stringContainer.value).toBe('hello');
      expect(stringContainer.metadata).toBeNull();
      expect(numberContainer.metadata).toStrictEqual({ key: 'value' });
    });
  });
}

testEdgeCasesPart1();
