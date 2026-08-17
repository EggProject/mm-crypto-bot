import type { DeepPartial } from './deep-partial';
import { TEST_ARRAY_LENGTH_3, TEST_VALUE_5, TEST_VALUE_10 } from '../test-constants';

const TRANSFORM_RESULT_11 = 11;

function testArraysAndFunctions(): void {
  describe('DeepPartial - arrays and functions', () => {
    interface Config {
      data: {
        items: string[];
        transform: (x: number) => number;
      };
      enabled: boolean;
    }

    it('should preserve array types', () => {
      const config: DeepPartial<Config> = {
        data: {
          items: ['a', 'b', 'c'],
        },
      };

      expect(config.data?.items).toHaveLength(TEST_ARRAY_LENGTH_3);
      expectTypeOf(config.data?.items).toEqualTypeOf<string[] | undefined>();
    });

    it('should preserve function types', () => {
      const transform = (x: number): number => x * 2;
      const config: DeepPartial<Config> = {
        data: {
          transform,
        },
      };

      expect(config.data?.transform?.(TEST_VALUE_5)).toBe(TEST_VALUE_10);
      expectTypeOf(config.data?.transform).toEqualTypeOf<((x: number) => number) | undefined>();
    });

    it('should handle both arrays and functions together', () => {
      const config: DeepPartial<Config> = {
        data: {
          items: ['x', 'y'],
          transform: n => n + 1,
        },
        enabled: true,
      };

      expect(config.data?.items).toStrictEqual(['x', 'y']);
      expect(config.data?.transform?.(TEST_VALUE_10)).toBe(TRANSFORM_RESULT_11);
      expect(config.enabled).toBe(true);
    });
  });
}

testArraysAndFunctions();
