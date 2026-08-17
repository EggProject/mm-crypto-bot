import type { PropertyKeys } from './property-keys';
import {
  TEST_PRICE_999,
  TEST_COUNT_5,
  TEST_ARRAY_LENGTH_3,
  TEST_FIELD_COUNT_4,
} from './test-constants';

function testBasicUsage(): void {
  describe('basic usage', () => {
    interface User {
      id: number;
      name: string;
      email: string;
      getName(): string;
      setEmail(email: string): void;
    }

    it('should extract only property keys', () => {
      type UserProperties = PropertyKeys<User>;

      const key1: UserProperties = 'id';
      const key2: UserProperties = 'name';
      const key3: UserProperties = 'email';

      expect(key1).toBe('id');
      expect(key2).toBe('name');
      expect(key3).toBe('email');

      expectTypeOf<UserProperties>().toEqualTypeOf<'id' | 'name' | 'email'>();
    });

    it('should exclude function properties', () => {
      type UserProperties = PropertyKeys<User>;

      expectTypeOf<UserProperties>().not.toExtend<'getName'>();
      expectTypeOf<UserProperties>().not.toExtend<'setEmail'>();
    });

    it('should work with Pick utility', () => {
      type UserData = Pick<User, PropertyKeys<User>>;

      const userData: UserData = {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
      };

      expect(userData.id).toBe(1);
      expect(userData.name).toBe('Alice');
      expect(userData.email).toBe('alice@example.com');
    });
  });
}

function testSerialization(): void {
  describe('serialization', () => {
    interface Product {
      id: number;
      title: string;
      price: number;
      getDisplayPrice(): string;
      updatePrice(newPrice: number): void;
    }

    it('should help with object serialization', () => {
      type ProductData = PropertyKeys<Product>;

      function getProperties(object: Product): Pick<Product, ProductData> {
        return {
          id: object.id,
          title: object.title,
          price: object.price,
        };
      }

      const product: Product = {
        id: 1,
        title: 'Laptop',
        price: TEST_PRICE_999,
        getDisplayPrice: () => `$${TEST_PRICE_999}`,
        updatePrice: () => {
          // Empty implementation for test
        },
      };

      const data = getProperties(product);

      expect(data).toStrictEqual({
        id: 1,
        title: 'Laptop',
        price: TEST_PRICE_999,
      });

      expectTypeOf(data).not.toHaveProperty('getDisplayPrice');
      expectTypeOf(data).not.toHaveProperty('updatePrice');
    });

    it('should extract only data for JSON serialization', () => {
      type ProductKeys = PropertyKeys<Product>;

      const keys: ProductKeys[] = ['id', 'title', 'price'];

      expect(keys).toHaveLength(TEST_ARRAY_LENGTH_3);
      expect(keys).not.toContain('getDisplayPrice');
      expect(keys).not.toContain('updatePrice');
    });
  });
}

function testStateManagement(): void {
  describe('state management', () => {
    interface State {
      count: number;
      items: string[];
      timestamp: Date;
      increment(): void;
      reset(): void;
      getItems(): string[];
    }

    it('should extract data properties for cloning', () => {
      type StateData = PropertyKeys<State>;

      expectTypeOf<StateData>().toEqualTypeOf<'count' | 'items' | 'timestamp'>();
    });

    it('should help clone state data only', () => {
      type StateProperties = Pick<State, PropertyKeys<State>>;

      const original: StateProperties = {
        count: TEST_COUNT_5,
        items: ['a', 'b', 'c'],
        timestamp: new Date('2025-01-01'),
      };

      const cloned: StateProperties = {
        count: original.count,
        items: [...original.items],
        timestamp: new Date(original.timestamp),
      };

      expect(cloned.count).toBe(TEST_COUNT_5);
      expect(cloned.items).toStrictEqual(['a', 'b', 'c']);
      expect(cloned.timestamp).toStrictEqual(original.timestamp);
    });
  });
}

function testFormHandling(): void {
  describe('form handling', () => {
    interface FormModel {
      firstName: string;
      lastName: string;
      age: number;
      email: string;
      validate(): boolean;
      submit(): Promise<void>;
      reset(): void;
    }

    it('should extract field names', () => {
      type FormFields = PropertyKeys<FormModel>;

      const fields: FormFields[] = ['firstName', 'lastName', 'age', 'email'];

      expect(fields).toHaveLength(TEST_FIELD_COUNT_4);
      expectTypeOf<FormFields>().toEqualTypeOf<'firstName' | 'lastName' | 'age' | 'email'>();
    });

    it('should iterate over data fields only', () => {
      type FormFields = PropertyKeys<FormModel>;

      const fieldNames: FormFields[] = ['firstName', 'lastName', 'age', 'email'];

      for (const field of fieldNames) {
        expect(['firstName', 'lastName', 'age', 'email']).toContain(field);
      }
    });
  });
}

describe('PropertyKeys', () => {
  testBasicUsage();
  testSerialization();
  testStateManagement();
  testFormHandling();
});

// Edge cases are split into separate files to keep test file under 300 lines
import './property-keys-edge-cases-pt1.spec';
import './property-keys-edge-cases-pt2.spec';
