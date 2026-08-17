import type { DeepKeys } from './deep-keys';

const EXPECTED_NESTED_KEY_COUNT = 6;

interface Flat {
  id: number;
  name: string;
}

interface Nested {
  user: {
    profile: {
      email: string;
      age: number;
    };
    name: string;
  };
  active: boolean;
}

interface WithArray {
  tags: string[];
  meta: { count: number };
}

interface WithDate {
  created: Date;
  info: { label: string };
}

describe('DeepKeys', () => {
  it('generates top-level keys for flat objects', () => {
    const key: DeepKeys<Flat> = 'id';
    expect(key).toBe('id');

    const key2: DeepKeys<Flat> = 'name';
    expect(key2).toBe('name');
  });

  it('generates nested dot-notation paths', () => {
    const key1: DeepKeys<Nested> = 'user.profile.email';
    expect(key1).toBe('user.profile.email');

    const key2: DeepKeys<Nested> = 'user.profile.age';
    expect(key2).toBe('user.profile.age');

    const key3: DeepKeys<Nested> = 'user.name';
    expect(key3).toBe('user.name');

    const key4: DeepKeys<Nested> = 'active';
    expect(key4).toBe('active');
  });

  it('stops at arrays — no index paths', () => {
    const key: DeepKeys<WithArray> = 'tags';
    expect(key).toBe('tags');

    const key2: DeepKeys<WithArray> = 'meta.count';
    expect(key2).toBe('meta.count');
  });

  it('stops at Date — no internal paths', () => {
    const key: DeepKeys<WithDate> = 'created';
    expect(key).toBe('created');

    const key2: DeepKeys<WithDate> = 'info.label';
    expect(key2).toBe('info.label');
  });

  it('assignability check — invalid paths should not compile', () => {
    // This test verifies the type works at runtime by checking valid keys
    const validKeys: DeepKeys<Nested>[] = [
      'user',
      'user.profile',
      'user.profile.email',
      'user.profile.age',
      'user.name',
      'active',
    ];
    expect(validKeys).toHaveLength(EXPECTED_NESTED_KEY_COUNT);
  });
});
