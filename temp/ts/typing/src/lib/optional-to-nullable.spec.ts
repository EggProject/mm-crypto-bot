import type { OptionalToNullable } from './optional-to-nullable';
import {
  TEST_USER_AGE_30,
  TEST_USER_AGE_25,
  TEST_USER_AGE_35,
  TEST_USER_AGE_40,
  TEST_USER_ID_123,
  TEST_USER_ID_456,
  TEST_LIMIT_10,
} from './test-constants';

const NULL_VALUE: null = JSON.parse('null');
const TEST_ID_3 = 3;
const TEST_ID_4 = 4;

function testBasicConversion(): void {
  describe('basic conversion', () => {
    interface User {
      id: number;
      name?: string;
      email?: string;
      age: number;
    }

    it('should convert optional properties to nullable', () => {
      type NullableUser = OptionalToNullable<User>;

      const user: NullableUser = {
        id: 1,
        name: 'Alice',
        email: NULL_VALUE,
        age: TEST_USER_AGE_30,
      };

      expect(user.id).toBe(1);
      expect(user.name).toBe('Alice');
      expect(user.email).toBeNull();
      expect(user.age).toBe(TEST_USER_AGE_30);
    });

    it('should require all properties to be present', () => {
      type NullableUser = OptionalToNullable<User>;

      const user: NullableUser = {
        id: 2,
        name: NULL_VALUE,
        email: NULL_VALUE,
        age: TEST_USER_AGE_25,
      };

      expect(user.name).toBeNull();
      expect(user.email).toBeNull();
    });

    it('should not allow undefined', () => {
      type NullableUser = OptionalToNullable<User>;

      const user: NullableUser = {
        id: TEST_ID_3,
        name: 'Bob',
        email: NULL_VALUE,
        age: TEST_USER_AGE_35,
      };

      expectTypeOf(user.name).not.toExtend<string | undefined>();
      expectTypeOf(user.email).toEqualTypeOf<string | null>();
    });

    it('should preserve required properties', () => {
      type NullableUser = OptionalToNullable<User>;

      const user: NullableUser = {
        id: TEST_ID_4,
        name: NULL_VALUE,
        email: NULL_VALUE,
        age: TEST_USER_AGE_40,
      };

      expectTypeOf(user.id).toEqualTypeOf<number | null>();
      expectTypeOf(user.age).toEqualTypeOf<number | null>();
    });
  });
}

function testApiRequestResponse(): void {
  describe('API request/response', () => {
    interface ApiRequest {
      userId: number;
      filter?: string;
      sortBy?: string;
      limit?: number;
    }

    it('should work with API request types', () => {
      type NullableApiRequest = OptionalToNullable<ApiRequest>;

      const request: NullableApiRequest = {
        userId: TEST_USER_ID_123,
        filter: NULL_VALUE,
        sortBy: 'name',
        limit: NULL_VALUE,
      };

      expect(request.userId).toBe(TEST_USER_ID_123);
      expect(request.filter).toBeNull();
      expect(request.sortBy).toBe('name');
      expect(request.limit).toBeNull();
    });

    it('should serialize to JSON correctly', () => {
      type NullableApiRequest = OptionalToNullable<ApiRequest>;

      const request: NullableApiRequest = {
        userId: TEST_USER_ID_456,
        filter: 'active',
        sortBy: NULL_VALUE,
        limit: TEST_LIMIT_10,
      };

      const json = JSON.stringify(request);
      const parsed = JSON.parse(json);

      expect(parsed.filter).toBe('active');
      expect(parsed.sortBy).toBeNull();
      expect(parsed.limit).toBe(TEST_LIMIT_10);
    });
  });
}

function testDatabaseModels(): void {
  describe('database models', () => {
    interface UserInput {
      username: string;
      bio?: string;
      website?: string;
      company?: string;
    }

    type UserRecord = OptionalToNullable<UserInput>;

    function createUser(input: UserInput): UserRecord {
      return {
        username: input.username,
        bio: input.bio ?? NULL_VALUE,
        website: input.website ?? NULL_VALUE,
        company: input.company ?? NULL_VALUE,
      };
    }

    it('should convert input to database record', () => {
      const result = createUser({
        username: 'john_doe',
        bio: 'Developer',
      });

      expect(result.username).toBe('john_doe');
      expect(result.bio).toBe('Developer');
      expect(result.website).toBeNull();
      expect(result.company).toBeNull();
    });

    it('should handle all optional fields as undefined', () => {
      const result = createUser({ username: 'jane_doe' });

      expect(result.bio).toBeNull();
      expect(result.website).toBeNull();
      expect(result.company).toBeNull();
    });
  });
}

function testFormDataNormalization(): void {
  describe('form data normalization', () => {
    interface FormData {
      title: string;
      description?: string;
      tags?: string[];
      publishedAt?: Date;
    }

    it('should normalize form data', () => {
      type NormalizedForm = OptionalToNullable<FormData>;

      function normalizeForm(data: FormData): NormalizedForm {
        return {
          title: data.title,
          description: data.description ?? NULL_VALUE,
          tags: data.tags ?? NULL_VALUE,
          publishedAt: data.publishedAt ?? NULL_VALUE,
        };
      }

      const result = normalizeForm({
        title: 'Test Article',
        description: 'A test description',
      });

      expect(result.title).toBe('Test Article');
      expect(result.description).toBe('A test description');
      expect(result.tags).toBeNull();
      expect(result.publishedAt).toBeNull();
    });

    it('should handle array properties', () => {
      type NormalizedForm = OptionalToNullable<FormData>;

      const form: NormalizedForm = {
        title: 'Post',
        description: NULL_VALUE,
        tags: ['tech', 'coding'],
        publishedAt: NULL_VALUE,
      };

      expect(form.tags).toStrictEqual(['tech', 'coding']);
      expectTypeOf(form.tags).toEqualTypeOf<string[] | null>();
    });

    it('should handle Date properties', () => {
      type NormalizedForm = OptionalToNullable<FormData>;

      const date = new Date('2025-01-01');
      const form: NormalizedForm = {
        title: 'Article',
        description: NULL_VALUE,
        tags: NULL_VALUE,
        publishedAt: date,
      };

      expect(form.publishedAt).toBe(date);
      expectTypeOf(form.publishedAt).toEqualTypeOf<Date | null>();
    });
  });
}

describe('OptionalToNullable', () => {
  testBasicConversion();
  testApiRequestResponse();
  testDatabaseModels();
  testFormDataNormalization();
});

// Edge cases are split into separate files to keep test file under 300 lines
import './optional-to-nullable-edge-cases-pt1.spec';
import './optional-to-nullable-edge-cases-pt2.spec';
