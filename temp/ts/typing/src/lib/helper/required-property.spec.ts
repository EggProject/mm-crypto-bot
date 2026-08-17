import type { RequiredProperty } from './required-property';
import {
  TEST_VALUE_42,
  TEST_PRICE_999_99,
  TEST_PRICE_25,
  TEST_TIMEOUT_5000,
  TEST_TIMEOUT_3000,
  TEST_RETRIES_3,
  TEST_HTTP_STATUS_200,
  TEST_ARRAY_LENGTH_2,
} from '../test-constants';

const TEST_ID_3 = 3;

describe('RequiredProperty - single and multiple properties', () => {
  describe('single property', () => {
    interface User {
      id: number;
      name?: string;
      email?: string;
      age?: number;
    }

    it('should make a single property required', () => {
      type UserWithRequiredName = RequiredProperty<User, 'name'>;

      const user: UserWithRequiredName = {
        id: 1,
        name: 'Alice',
      };

      expect(user.id).toBe(1);
      expect(user.name).toBe('Alice');
      expectTypeOf(user.name).toEqualTypeOf<string>();
      expectTypeOf(user.name).not.toEqualTypeOf<string | undefined>();
    });

    it('should keep other properties optional', () => {
      type UserWithRequiredEmail = RequiredProperty<User, 'email'>;

      const user: UserWithRequiredEmail = {
        id: 2,
        email: 'test@example.com',
      };

      expect(user.email).toBe('test@example.com');
      expect(user.name).toBeUndefined();
      expectTypeOf<UserWithRequiredEmail>().toHaveProperty('name');
    });

    it('should preserve already required properties', () => {
      type UserWithRequiredId = RequiredProperty<User, 'id'>;

      const user: UserWithRequiredId = {
        id: TEST_ID_3,
      };

      expect(user.id).toBe(TEST_ID_3);
      expectTypeOf(user.id).toEqualTypeOf<number>();
    });
  });

  describe('multiple properties', () => {
    interface Product {
      id: number;
      title?: string;
      description?: string;
      price?: number;
      category?: string;
    }

    it('should make multiple properties required', () => {
      type ProductForm = RequiredProperty<Product, 'title' | 'price'>;

      const product: ProductForm = {
        id: 1,
        title: 'Laptop',
        price: TEST_PRICE_999_99,
      };

      expect(product.title).toBe('Laptop');
      expect(product.price).toBe(TEST_PRICE_999_99);
      expectTypeOf(product.title).toEqualTypeOf<string>();
      expectTypeOf(product.price).toEqualTypeOf<number>();
    });

    it('should keep unspecified properties optional', () => {
      type ProductForm = RequiredProperty<Product, 'title' | 'price'>;

      const product: ProductForm = {
        id: 2,
        title: 'Mouse',
        price: TEST_PRICE_25,
        description: 'Wireless mouse',
      };

      expect(product.description).toBe('Wireless mouse');
      expect(product.category).toBeUndefined();
    });
  });

  describe('function parameters', () => {
    interface Config {
      apiUrl?: string;
      timeout?: number;
      retries?: number;
      debug?: boolean;
    }

    it('should work in function parameter types', () => {
      function initializeApi(config: RequiredProperty<Config, 'apiUrl'>): string {
        return config.apiUrl;
      }

      const result = initializeApi({ apiUrl: 'https://api.example.com' });

      expect(result).toBe('https://api.example.com');
    });

    it('should allow optional properties in function parameters', () => {
      function connect(config: RequiredProperty<Config, 'apiUrl'>): Config {
        return {
          apiUrl: config.apiUrl,
          timeout: config.timeout ?? TEST_TIMEOUT_5000,
          retries: config.retries ?? TEST_RETRIES_3,
          debug: config.debug ?? false,
        };
      }

      const result = connect({
        apiUrl: 'https://api.test.com',
        timeout: TEST_TIMEOUT_3000,
      });

      expect(result.apiUrl).toBe('https://api.test.com');
      expect(result.timeout).toBe(TEST_TIMEOUT_3000);
      expect(result.retries).toBe(TEST_RETRIES_3);
      expect(result.debug).toBe(false);
    });
  });
});

describe('RequiredProperty - type strengthening and complex types', () => {
  describe('gradual type strengthening', () => {
    interface Draft {
      title?: string;
      content?: string;
      author?: string;
      publishedAt?: Date;
    }

    it('should support progressive type strengthening', () => {
      type ReadyToPublish = RequiredProperty<Draft, 'title' | 'content' | 'author'>;

      const draft: ReadyToPublish = {
        title: 'My Article',
        content: 'Article content',
        author: 'John Doe',
      };

      expect(draft.title).toBe('My Article');
      expect(draft.content).toBe('Article content');
      expect(draft.author).toBe('John Doe');
      expect(draft.publishedAt).toBeUndefined();
    });

    it('should support chained type transformations', () => {
      type ReadyToPublish = RequiredProperty<Draft, 'title' | 'content' | 'author'>;
      type Published = RequiredProperty<ReadyToPublish, 'publishedAt'>;

      const publishedDate = new Date('2025-01-01');
      const article: Published = {
        title: 'Published Article',
        content: 'Content here',
        author: 'Jane Smith',
        publishedAt: publishedDate,
      };

      expect(article.title).toBe('Published Article');
      expect(article.publishedAt).toBe(publishedDate);
      expectTypeOf(article.publishedAt).toEqualTypeOf<Date>();
    });
  });
  describe('complex types', () => {
    it('should work with nested object properties', () => {
      interface Settings {
        theme?: {
          primary: string;
          secondary: string;
        };
        language?: string;
        notifications?: boolean;
      }

      type SettingsWithTheme = RequiredProperty<Settings, 'theme'>;

      const settings: SettingsWithTheme = {
        theme: {
          primary: '#000',
          secondary: '#fff',
        },
      };

      expect(settings.theme.primary).toBe('#000');
      expectTypeOf(settings.theme).not.toBeUndefined();
    });

    it('should work with array properties', () => {
      interface Collection {
        id: number;
        items?: string[];
        tags?: string[];
      }

      type CollectionWithItems = RequiredProperty<Collection, 'items'>;

      const collection: CollectionWithItems = {
        id: 1,
        items: ['item1', 'item2'],
      };

      expect(collection.items).toHaveLength(TEST_ARRAY_LENGTH_2);
      expectTypeOf(collection.items).toEqualTypeOf<string[]>();
    });

    it('should work with union type properties', () => {
      interface Response {
        status: number;
        data?: string | number | object;
        error?: string;
      }

      type ResponseWithData = RequiredProperty<Response, 'data'>;

      const stringResponse: ResponseWithData = {
        status: TEST_HTTP_STATUS_200,
        data: 'success',
      };

      const numberResponse: ResponseWithData = {
        status: TEST_HTTP_STATUS_200,
        data: TEST_VALUE_42,
      };

      expect(stringResponse.data).toBe('success');
      expect(numberResponse.data).toBe(TEST_VALUE_42);
    });
  });
});

describe('RequiredProperty - edge cases', () => {
  it('should handle empty objects', () => {
    interface Empty {
      value?: string;
    }

    type EmptyWithValue = RequiredProperty<Empty, 'value'>;

    const object: EmptyWithValue = {
      value: 'test',
    };

    expect(object.value).toBe('test');
  });

  it('should work with all properties required', () => {
    interface Partial {
      a?: string;
      b?: number;
      c?: boolean;
    }

    type AllRequired = RequiredProperty<Partial, 'a' | 'b' | 'c'>;

    const object: AllRequired = {
      a: 'test',
      b: TEST_VALUE_42,
      c: true,
    };

    expect(object.a).toBe('test');
    expect(object.b).toBe(TEST_VALUE_42);
    expect(object.c).toBe(true);
  });

  it('should preserve readonly modifiers', () => {
    interface ReadonlyProperties {
      readonly id: number;
      name?: string;
    }

    type WithRequiredName = RequiredProperty<ReadonlyProperties, 'name'>;

    const object: WithRequiredName = {
      id: 1,
      name: 'test',
    };

    expect(object.id).toBe(1);
    expect(object.name).toBe('test');
  });

  it('should work with generic types', () => {
    interface Container<T> {
      value?: T;
      metadata?: Record<string, unknown>;
    }

    type ContainerWithValue<T> = RequiredProperty<Container<T>, 'value'>;

    const stringContainer: ContainerWithValue<string> = {
      value: 'hello',
    };

    const numberContainer: ContainerWithValue<number> = {
      value: TEST_VALUE_42,
    };

    expect(stringContainer.value).toBe('hello');
    expect(numberContainer.value).toBe(TEST_VALUE_42);
  });
});
