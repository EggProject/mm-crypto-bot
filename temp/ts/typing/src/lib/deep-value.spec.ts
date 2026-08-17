import type { DeepValue } from './deep-value';
import { getDeepValue } from './deep-value';

const AGE_VALUE = 25;
const COUNT_VALUE = 42;

interface TestModel {
  user: {
    profile: {
      email: string;
      age: number;
    };
    name: string;
  };
  active: boolean;
  meta: {
    count: number;
  };
}

describe('DeepValue type', () => {
  it('resolves top-level value type', () => {
    const value: DeepValue<TestModel, 'active'> = true;
    expect(value).toBe(true);
  });

  it('resolves nested value type', () => {
    const value: DeepValue<TestModel, 'user.profile.email'> = 'test@example.com';
    expect(value).toBe('test@example.com');
  });

  it('resolves intermediate object type', () => {
    const value: DeepValue<TestModel, 'user.profile'> = { email: 'a@b.com', age: AGE_VALUE };
    expect(value.email).toBe('a@b.com');
  });
});

describe('getDeepValue', () => {
  const testObject: TestModel = {
    user: {
      profile: {
        email: 'alice@example.com',
        age: AGE_VALUE,
      },
      name: 'Alice',
    },
    active: true,
    meta: { count: COUNT_VALUE },
  };

  it('returns top-level value', () => {
    const isResult = getDeepValue(testObject, 'active');
    expect(isResult).toBe(true);
  });

  it('returns nested value at depth 2', () => {
    const result = getDeepValue(testObject, 'user.name');
    expect(result).toBe('Alice');
  });

  it('returns nested value at depth 3', () => {
    const result = getDeepValue(testObject, 'user.profile.email');
    expect(result).toBe('alice@example.com');
  });

  it('returns number nested value', () => {
    const result = getDeepValue(testObject, 'meta.count');
    expect(result).toBe(COUNT_VALUE);
  });

  it('returns intermediate object', () => {
    const result = getDeepValue(testObject, 'user.profile');
    expect(result).toEqual({ email: 'alice@example.com', age: AGE_VALUE });
  });

  it('returns undefined for missing intermediate path', () => {
    const partial = { user: { name: 'Bob' } } as unknown as TestModel;
    const result = getDeepValue(partial, 'user.profile.email');
    expect(result).toBeUndefined();
  });

  it('returns undefined when intermediate is null', () => {
    const partial = { user: null } as unknown as TestModel;
    const result = getDeepValue(partial, 'user.name');
    expect(result).toBeUndefined();
  });
});
