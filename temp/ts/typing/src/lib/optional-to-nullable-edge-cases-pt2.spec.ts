import type { OptionalToNullable } from './optional-to-nullable';
import { TEST_VALUE_42 } from './test-constants';

const NULL_VALUE: null = JSON.parse('null');

function testEdgeCasesPart2(): void {
  describe('OptionalToNullable - edge cases part 2', () => {
    it('should handle boolean optional fields', () => {
      interface Config {
        enabled?: boolean;
        debug?: boolean;
        name: string;
      }

      type NullableConfig = OptionalToNullable<Config>;

      const config: NullableConfig = {
        enabled: true,
        debug: NULL_VALUE,
        name: 'test',
      };

      expect(config.enabled).toBe(true);
      expect(config.debug).toBeNull();
    });

    it('should handle union types', () => {
      interface WithUnion {
        value?: string | number;
        flag: boolean;
      }

      type NullableWithUnion = OptionalToNullable<WithUnion>;

      const object1: NullableWithUnion = {
        value: 'string',
        flag: true,
      };

      const object2: NullableWithUnion = {
        value: TEST_VALUE_42,
        flag: false,
      };

      const object3: NullableWithUnion = {
        value: NULL_VALUE,
        flag: true,
      };

      expect(object1.value).toBe('string');
      expect(object2.value).toBe(TEST_VALUE_42);
      expect(object3.value).toBeNull();
    });
  });
}

testEdgeCasesPart2();
