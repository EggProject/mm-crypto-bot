import type { RemoveIndexSignature } from './remove-index-signature';
import { TEST_VALUE_42 } from './test-constants';

function testEdgeCasesPart1(): void {
  describe('RemoveIndexSignature - edge cases part 1', () => {
    it('should handle types without index signatures', () => {
      interface Simple {
        a: string;
        b: number;
      }

      type Result = RemoveIndexSignature<Simple>;

      const object: Result = { a: 'test', b: TEST_VALUE_42 };

      expectTypeOf<Result>().toEqualTypeOf<Simple>();
      expect(object.a).toBe('test');
      expect(object.b).toBe(TEST_VALUE_42);
    });

    it('should handle empty interfaces with index signature', () => {
      interface OnlyIndex {
        [key: string]: unknown;
      }

      type Result = RemoveIndexSignature<OnlyIndex>;

      const object: Result = {};

      // When removing index signature from an interface with only index signature,
      // we get an empty object type
      expect(Object.keys(object)).toHaveLength(0);
    });

    it('should handle mixed string and number index signatures', () => {
      interface Mixed {
        name: string;
        [key: string]: unknown;
        [index: number]: unknown;
      }

      type Result = RemoveIndexSignature<Mixed>;

      const object: Result = { name: 'test' };

      expectTypeOf<Result>().toEqualTypeOf<{ name: string }>();
      expect(object.name).toBe('test');
    });

    it('should preserve optional properties', () => {
      interface WithOptional {
        required: string;
        optional?: number;
        [key: string]: unknown;
      }

      type Result = RemoveIndexSignature<WithOptional>;

      const object1: Result = { required: 'test' };
      const object2: Result = { required: 'test', optional: TEST_VALUE_42 };

      expect(object1.required).toBe('test');
      expect(object1.optional).toBeUndefined();
      expect(object2.optional).toBe(TEST_VALUE_42);
    });

    it('should preserve readonly properties', () => {
      interface WithReadonly {
        readonly id: number;
        name: string;
        [key: string]: unknown;
      }

      type Result = RemoveIndexSignature<WithReadonly>;

      const object: Result = { id: 1, name: 'test' };

      expect(object.id).toBe(1);
      expect(object.name).toBe('test');
    });

    it('should work with Record types', () => {
      type RecordType = Record<string, unknown> & {
        id: number;
        name: string;
      };

      type Result = RemoveIndexSignature<RecordType>;

      const object: Result = { id: 1, name: 'test' };

      expectTypeOf<Result>().toEqualTypeOf<{ id: number; name: string }>();
      expect(object.id).toBe(1);
    });
  });
}

testEdgeCasesPart1();
