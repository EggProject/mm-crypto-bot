import type { DeepPartial } from './deep-partial';

function testNestedObjects(): void {
  describe('DeepPartial - nested objects', () => {
    interface Company {
      name: string;
      address: {
        street: string;
        city: string;
        country: {
          code: string;
          name: string;
        };
      };
      employees: number;
    }

    it('should make nested properties optional', () => {
      const company1: DeepPartial<Company> = {
        name: 'Acme Corp',
        address: {
          city: 'New York',
        },
      };

      const company2: DeepPartial<Company> = {
        address: {
          country: {
            code: 'US',
          },
        },
      };

      expect(company1.name).toBe('Acme Corp');
      expect(company1.address?.city).toBe('New York');
      expect(company1.address?.street).toBeUndefined();

      expect(company2.address?.country?.code).toBe('US');
      expect(company2.address?.country?.name).toBeUndefined();
    });

    it('should allow deeply nested empty objects', () => {
      const company: DeepPartial<Company> = {
        address: {},
      };

      expect(company.address).toBeDefined();
      expect(company.address?.city).toBeUndefined();
    });

    it('should handle three levels of nesting', () => {
      const company: DeepPartial<Company> = {
        address: {
          country: {
            code: 'UK',
            name: 'United Kingdom',
          },
        },
      };

      expect(company.address?.country?.code).toBe('UK');
      expect(company.address?.country?.name).toBe('United Kingdom');
    });
  });
}

testNestedObjects();
