import type { RemoveIndexSignature } from './remove-index-signature';
import { TEST_TIMEOUT_5000, TEST_HTTP_STATUS_200, TEST_ARRAY_LENGTH_3 } from './test-constants';

interface ApiResponse {
  status: number;
  message: string;
  [key: string]: unknown;
}

function isValidResponse(response: ApiResponse): boolean {
  type KnownFields = RemoveIndexSignature<ApiResponse>;
  const known: KnownFields = {
    status: response.status,
    message: response.message,
  };
  return known.status === TEST_HTTP_STATUS_200;
}

interface DynamicObject {
  id: number;
  name: string;
  type: 'user' | 'admin';
  [key: string]: unknown;
}

function getStaticProps(object: DynamicObject): RemoveIndexSignature<DynamicObject> {
  return {
    id: object.id,
    name: object.name,
    type: object.type,
  };
}

function testStringIndexSignatureRemoval(): void {
  describe('string index signature removal', () => {
    interface Config {
      apiUrl: string;
      timeout: number;
      [key: string]: unknown;
    }

    it('should remove string index signature', () => {
      type StrictConfig = RemoveIndexSignature<Config>;

      const config: StrictConfig = {
        apiUrl: 'https://api.example.com',
        timeout: TEST_TIMEOUT_5000,
      };

      expect(config.apiUrl).toBe('https://api.example.com');
      expect(config.timeout).toBe(TEST_TIMEOUT_5000);
      expectTypeOf<StrictConfig>().toEqualTypeOf<{
        apiUrl: string;
        timeout: number;
      }>();
    });

    it('should extract only named properties', () => {
      type Keys = keyof RemoveIndexSignature<Config>;

      expectTypeOf<Keys>().toEqualTypeOf<'apiUrl' | 'timeout'>();
    });
  });
}

function testApiResponseHandling(): void {
  describe('API response handling', () => {
    interface ApiResponse {
      status: number;
      message: string;
      [key: string]: unknown;
    }

    it('should extract known fields from API response', () => {
      type KnownFields = RemoveIndexSignature<ApiResponse>;

      const response: KnownFields = {
        status: TEST_HTTP_STATUS_200,
        message: 'Success',
      };

      expect(response.status).toBe(TEST_HTTP_STATUS_200);
      expect(response.message).toBe('Success');
    });

    it('should work in validation functions', () => {
      const isResult = isValidResponse({
        status: TEST_HTTP_STATUS_200,
        message: 'OK',
        extraData: 'ignored',
      });

      expect(isResult).toBe(true);
    });
  });
}

function testDynamicObjectProperties(): void {
  describe('dynamic object properties', () => {
    it('should extract static properties', () => {
      type StaticProperties = RemoveIndexSignature<DynamicObject>;

      const object: StaticProperties = {
        id: 1,
        name: 'Alice',
        type: 'user',
      };

      expect(object.id).toBe(1);
      expect(object.name).toBe('Alice');
      expect(object.type).toBe('user');
      expectTypeOf<StaticProperties>().toEqualTypeOf<{
        id: number;
        name: string;
        type: 'user' | 'admin';
      }>();
    });

    it('should work in property extraction functions', () => {
      const result = getStaticProps({
        id: 2,
        name: 'Bob',
        type: 'admin',
        extra: 'ignored',
      });

      expect(result).toStrictEqual({
        id: 2,
        name: 'Bob',
        type: 'admin',
      });
    });
  });
}

function testNumericIndexSignatureRemoval(): void {
  describe('numeric index signature removal', () => {
    interface ArrayLike {
      length: number;
      [index: number]: string;
    }

    it('should remove numeric index signature', () => {
      type ArrayLikeProperties = RemoveIndexSignature<ArrayLike>;

      const properties: ArrayLikeProperties = {
        length: TEST_ARRAY_LENGTH_3,
      };

      expect(properties).toHaveLength(TEST_ARRAY_LENGTH_3);
      expectTypeOf<ArrayLikeProperties>().toEqualTypeOf<{ length: number }>();
    });
  });
}

function testStrictPropertySelection(): void {
  describe('strict property selection', () => {
    interface MixedObject {
      id: number;
      name: string;
      tags: string[];
      [key: string]: unknown;
    }

    it('should enable strict Pick operations', () => {
      type StrictPick<T, K extends keyof RemoveIndexSignature<T>> = Pick<
        RemoveIndexSignature<T>,
        K
      >;

      type NameOnly = StrictPick<MixedObject, 'name'>;
      type IdAndName = StrictPick<MixedObject, 'id' | 'name'>;

      const nameOnly: NameOnly = { name: 'Test' };
      const idAndName: IdAndName = { id: 1, name: 'Test' };

      expect(nameOnly.name).toBe('Test');
      expect(idAndName.id).toBe(1);
      expect(idAndName.name).toBe('Test');
    });
  });
}

describe('RemoveIndexSignature', () => {
  testStringIndexSignatureRemoval();
  testApiResponseHandling();
  testDynamicObjectProperties();
  testNumericIndexSignatureRemoval();
  testStrictPropertySelection();
});

// Edge cases are split into separate files to keep test file under 300 lines
import './remove-index-signature-edge-cases-pt1.spec';
import './remove-index-signature-edge-cases-pt2.spec';
