import type { DeepPartial } from './deep-partial';

const DEFAULT_FONT_SIZE = 14;

function testUpdateFunctions(): void {
  describe('DeepPartial - update functions', () => {
    interface Settings {
      theme: {
        colors: {
          primary: string;
          secondary: string;
        };
        fontSize: number;
      };
      notifications: {
        email: boolean;
        push: boolean;
      };
    }

    it('should work in update functions', () => {
      const currentSettings: Settings = {
        theme: {
          colors: {
            primary: '#fff',
            secondary: '#000',
          },
          fontSize: DEFAULT_FONT_SIZE,
        },
        notifications: {
          email: true,
          push: false,
        },
      };

      function updateSettings(current: Settings, updates: DeepPartial<Settings>): Settings {
        return {
          theme: {
            colors: {
              primary: updates.theme?.colors?.primary ?? current.theme.colors.primary,
              secondary: updates.theme?.colors?.secondary ?? current.theme.colors.secondary,
            },
            fontSize: updates.theme?.fontSize ?? current.theme.fontSize,
          },
          notifications: {
            email: updates.notifications?.email ?? current.notifications.email,
            push: updates.notifications?.push ?? current.notifications.push,
          },
        };
      }

      const result = updateSettings(currentSettings, {
        theme: { colors: { primary: '#f00' } },
      });

      expect(result.theme.colors.primary).toBe('#f00');
      expect(result.theme.colors.secondary).toBe('#000');
      expect(result.theme.fontSize).toBe(DEFAULT_FONT_SIZE);
    });
  });
}

testUpdateFunctions();
