// The app theme (app-chrome conventions, Theme): System follows the OS
// appearance; Light and Dark force a theme. config.json stores the choice
// verbatim like any other setting, so a missing or unrecognized value resolves
// to System here, at the point of use.
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

export function normalizeThemePreference(value: unknown): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : 'system'
}
