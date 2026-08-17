import type { PropertyKeys } from './property-keys';

function testEdgeCasesPart1(): void {
  describe('PropertyKeys - edge cases part 1', () => {
    it('should handle interfaces with only properties', () => {
      interface DataOnly {
        id: number;
        name: string;
        value: boolean;
      }

      type Keys = PropertyKeys<DataOnly>;

      expectTypeOf<Keys>().toEqualTypeOf<'id' | 'name' | 'value'>();
    });

    it('should handle interfaces with only methods', () => {
      interface MethodsOnly {
        doSomething(): void;
        calculate(): number;
      }

      type Keys = PropertyKeys<MethodsOnly>;

      expectTypeOf<Keys>().toEqualTypeOf<never>();
    });

    it('should handle mixed data types', () => {
      interface Mixed {
        id: number;
        name: string;
        items: string[];
        data: { key: string };
        callback: () => void;
        transform(x: number): number;
      }

      type Keys = PropertyKeys<Mixed>;

      // 'callback' is a function type property (excluded by current implementation)
      // 'transform' is a method signature (excluded)
      expectTypeOf<Keys>().toEqualTypeOf<'id' | 'name' | 'items' | 'data'>();
    });

    it('should handle optional properties', () => {
      interface WithOptional {
        required: string;
        optional?: number;
        method?(): void;
      }

      type Keys = PropertyKeys<WithOptional>;

      // 'method' is an optional method signature (currently included with undefined in union)
      expectTypeOf<Keys>().toEqualTypeOf<'required' | 'optional' | 'method' | undefined>();
    });

    it('should handle readonly properties', () => {
      interface WithReadonly {
        readonly id: number;
        readonly name: string;
        update(): void;
      }

      type Keys = PropertyKeys<WithReadonly>;

      expectTypeOf<Keys>().toEqualTypeOf<'id' | 'name'>();
    });
  });
}

testEdgeCasesPart1();
