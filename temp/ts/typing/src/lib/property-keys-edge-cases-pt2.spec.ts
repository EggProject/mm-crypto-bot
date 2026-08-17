import type { PropertyKeys } from './property-keys';

function testEdgeCasesPart2(): void {
  describe('PropertyKeys - edge cases part 2', () => {
    it('should work with class instances', () => {
      class Entity {
        id: number;
        name: string;

        constructor(id: number, name: string) {
          this.id = id;
          this.name = name;
        }

        save(): void {
          // save logic
        }

        delete(): void {
          // delete logic
        }
      }

      type EntityProperties = PropertyKeys<Entity>;

      expectTypeOf<EntityProperties>().toEqualTypeOf<'id' | 'name'>();
    });

    it('should handle generic types', () => {
      interface Container<T> {
        value: T;
        metadata: Record<string, unknown>;
        getValue(): T;
        setValue(value: T): void;
      }

      type ContainerProperties<T> = PropertyKeys<Container<T>>;

      expectTypeOf<ContainerProperties<string>>().toEqualTypeOf<'value' | 'metadata'>();
      expectTypeOf<ContainerProperties<number>>().toEqualTypeOf<'value' | 'metadata'>();
    });

    it('should handle union types in properties', () => {
      interface WithUnion {
        value: string | number;
        flag: boolean;
        process(x: unknown): void;
      }

      type Keys = PropertyKeys<WithUnion>;

      expectTypeOf<Keys>().toEqualTypeOf<'value' | 'flag'>();
    });

    it('should handle Date and complex types', () => {
      interface ComplexProperties {
        timestamp: Date;
        data: Map<string, number>;
        items: Set<string>;
        transform(): void;
      }

      type Keys = PropertyKeys<ComplexProperties>;

      expectTypeOf<Keys>().toEqualTypeOf<'timestamp' | 'data' | 'items'>();
    });

    it('should exclude arrow function properties', () => {
      interface WithArrowFunctions {
        name: string;
        onClick: () => void;
        onSubmit: (data: unknown) => Promise<void>;
      }

      type Keys = PropertyKeys<WithArrowFunctions>;

      // Arrow functions stored as properties are still functions
      expectTypeOf<Keys>().toEqualTypeOf<'name'>();
    });
  });
}

testEdgeCasesPart2();
