import type { DeepPartial } from './deep-partial';
import { TEST_VALUE_42 } from '../test-constants';

function testEdgeCases(): void {
  describe('DeepPartial - edge cases', () => {
    it('should handle empty objects', () => {
      type Empty = Record<string, never>;
      const object: DeepPartial<Empty> = {};

      expect(object).toBeDefined();
    });

    it('should work with single property interfaces', () => {
      interface Single {
        value: string;
      }

      const object: DeepPartial<Single> = {};

      expect(object.value).toBeUndefined();
    });

    it('should handle mixed primitive and object types', () => {
      interface Mixed {
        id: number;
        nested: {
          value: string;
        };
        flag: boolean;
      }

      const object: DeepPartial<Mixed> = {
        id: 1,
        nested: {},
      };

      expect(object.id).toBe(1);
      expect(object.nested).toBeDefined();
      expect(object.nested?.value).toBeUndefined();
      expect(object.flag).toBeUndefined();
    });

    it('should work with Date objects', () => {
      interface WithDate {
        timestamp: Date;
        nested: {
          created: Date;
        };
      }

      const now = new Date();
      const object: DeepPartial<WithDate> = {
        timestamp: now,
      };

      expect(object.timestamp).toBe(now);
      expect(object.nested).toBeUndefined();
    });

    it('should handle union types', () => {
      interface WithUnion {
        value: string | number;
        nested: {
          data: boolean | string;
        };
      }

      const object1: DeepPartial<WithUnion> = {
        value: 'string',
      };

      const object2: DeepPartial<WithUnion> = {
        value: TEST_VALUE_42,
        nested: {
          data: true,
        },
      };

      expect(object1.value).toBe('string');
      expect(object2.value).toBe(TEST_VALUE_42);
      expect(object2.nested?.data).toBe(true);
    });

    it('should work with generic types', () => {
      interface Container<T> {
        value: T;
        metadata: {
          created: Date;
          updated: Date;
        };
      }

      const stringContainer: DeepPartial<Container<string>> = {
        value: 'hello',
        metadata: {
          created: new Date(),
        },
      };

      const numberContainer: DeepPartial<Container<number>> = {
        value: TEST_VALUE_42,
      };

      expect(stringContainer.value).toBe('hello');
      expect(numberContainer.value).toBe(TEST_VALUE_42);
    });

    it('should preserve readonly properties', () => {
      interface ReadonlyProperties {
        readonly id: number;
        data: {
          readonly value: string;
        };
      }

      const object: DeepPartial<ReadonlyProperties> = {
        id: 1,
        data: {
          value: 'test',
        },
      };

      expect(object.id).toBe(1);
      expect(object.data?.value).toBe('test');
    });

    it('should handle very deeply nested structures', () => {
      interface VeryDeep {
        level1: {
          level2: {
            level3: {
              level4: {
                value: string;
              };
            };
          };
        };
      }

      const object: DeepPartial<VeryDeep> = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep',
              },
            },
          },
        },
      };

      expect(object.level1?.level2?.level3?.level4?.value).toBe('deep');
    });
  });
}

testEdgeCases();
