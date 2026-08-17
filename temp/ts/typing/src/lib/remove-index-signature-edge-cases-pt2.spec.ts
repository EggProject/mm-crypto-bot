import type { RemoveIndexSignature } from './remove-index-signature';
import { TEST_VALUE_5, TEST_VALUE_42 } from './test-constants';

function testEdgeCasesPart2(): void {
  describe('RemoveIndexSignature - edge cases part 2', () => {
    it('should handle complex nested types', () => {
      interface Complex {
        data: {
          value: string;
          nested: {
            count: number;
          };
        };
        items: string[];
        [key: string]: unknown;
      }

      type Result = RemoveIndexSignature<Complex>;

      const object: Result = {
        data: {
          value: 'test',
          nested: {
            count: TEST_VALUE_5,
          },
        },
        items: ['a', 'b'],
      };

      expect(object.data.value).toBe('test');
      expect(object.data.nested.count).toBe(TEST_VALUE_5);
      expect(object.items).toStrictEqual(['a', 'b']);
    });

    it('should work with generic types', () => {
      interface Container<T> {
        value: T;
        metadata: Record<string, string>;
        [key: string]: unknown;
      }

      type StrictContainer<T> = RemoveIndexSignature<Container<T>>;

      const stringContainer: StrictContainer<string> = {
        value: 'hello',
        metadata: { key: 'value' },
      };

      const numberContainer: StrictContainer<number> = {
        value: TEST_VALUE_42,
        metadata: {},
      };

      expect(stringContainer.value).toBe('hello');
      expect(numberContainer.value).toBe(TEST_VALUE_42);
    });

    it('should handle union types', () => {
      interface WithUnion {
        value: string | number;
        [key: string]: unknown;
      }

      type Result = RemoveIndexSignature<WithUnion>;

      const object1: Result = { value: 'string' };
      const object2: Result = { value: TEST_VALUE_42 };

      expect(object1.value).toBe('string');
      expect(object2.value).toBe(TEST_VALUE_42);
    });

    it('should work with key remapping', () => {
      interface FlexibleData {
        version: string;
        timestamp: Date;
        [key: string]: unknown;
      }

      type KnownKeys = keyof RemoveIndexSignature<FlexibleData>;

      const keys: KnownKeys[] = ['version', 'timestamp'];

      expect(keys).toHaveLength(2);
      expect(keys).toContain('version');
      expect(keys).toContain('timestamp');
    });
  });
}

testEdgeCasesPart2();
