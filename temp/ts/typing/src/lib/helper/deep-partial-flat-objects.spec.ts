import type { DeepPartial } from './deep-partial';

function testFlatObjects(): void {
  describe('DeepPartial - flat objects', () => {
    interface User {
      id: number;
      name: string;
      email: string;
    }

    it('should make all properties optional', () => {
      const user1: DeepPartial<User> = { name: 'Alice' };
      const user2: DeepPartial<User> = { id: 1 };
      const user3: DeepPartial<User> = {};

      expect(user1.name).toBe('Alice');
      expect(user1.id).toBeUndefined();
      expect(user2.id).toBe(1);
      expect(Object.keys(user3)).toHaveLength(0);
    });

    it('should allow all properties to be present', () => {
      const user: DeepPartial<User> = {
        id: 1,
        name: 'Bob',
        email: 'bob@example.com',
      };

      expect(user.id).toBe(1);
      expect(user.name).toBe('Bob');
      expect(user.email).toBe('bob@example.com');
    });
  });
}

testFlatObjects();
