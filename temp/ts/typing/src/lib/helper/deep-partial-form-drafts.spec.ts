import type { DeepPartial } from './deep-partial';

function testFormDrafts(): void {
  describe('DeepPartial - form drafts', () => {
    interface FormData {
      personal: {
        firstName: string;
        lastName: string;
        dateOfBirth: Date;
      };
      contact: {
        email: string;
        phone: string;
      };
    }

    it('should support incremental form filling', () => {
      let draft: DeepPartial<FormData> = { personal: { firstName: 'John' } };
      expect(draft.personal?.firstName).toBe('John');

      draft = {
        ...draft,
        personal: { ...draft.personal, lastName: 'Doe' },
      };
      expect(draft.personal?.firstName).toBe('John');
      expect(draft.personal?.lastName).toBe('Doe');

      const birthDate = new Date('1990-01-01');
      draft = {
        ...draft,
        personal: { ...draft.personal, dateOfBirth: birthDate },
      };
      expect(draft.personal?.dateOfBirth).toBe(birthDate);
    });

    it('should allow partial form sections', () => {
      const draft: DeepPartial<FormData> = {
        contact: {
          email: 'john@example.com',
        },
      };

      expect(draft.contact?.email).toBe('john@example.com');
      expect(draft.contact?.phone).toBeUndefined();
      expect(draft.personal).toBeUndefined();
    });
  });
}

testFormDrafts();
