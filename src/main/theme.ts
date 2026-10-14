import { execFile } from 'child_process'
import { BrowserWindow, nativeTheme, systemPreferences } from 'electron'
import { normalizeThemePreference } from '../shared/theme'
import { mainWindowBackground } from './window-options'

// Electron's nativeTheme.themeSource is ImageQueue's one theme authority
// (app-chrome conventions, Theme): it paints the native title bar, menus, and
// dialogs, and it decides `prefers-color-scheme` in every renderer and in the
// toast window, which is what their stylesheets follow. No renderer resolves
// System itself.

// Only windows painted with the app surface follow the theme's background: the
// fullscreen view stays black behind its image and the toast window stays
// transparent.
const themedWindows = new Set<BrowserWindow>()

export function windowBackground(dark: boolean = nativeTheme.shouldUseDarkColors): string {
  return mainWindowBackground(dark)
}

function syncWindowBackgrounds(): void {
  const color = windowBackground()
  for (const window of themedWindows) {
    if (!window.isDestroyed()) window.setBackgroundColor(color)
  }
}

/** Keeps a window's background on the resolved theme's app surface. */
export function trackThemedWindow(window: BrowserWindow): void {
  themedWindows.add(window)
  window.once('closed', () => themedWindows.delete(window))
}

/** Applies a saved choice to the whole app; System follows the OS. */
export function applyThemePreference(value: unknown): void {
  nativeTheme.themeSource = normalizeThemePreference(value)
  syncWindowBackgrounds()
}

/** Keeps window backgrounds in step when the OS appearance changes under System. */
export function followOsThemeChanges(): void {
  nativeTheme.on('updated', syncWindowBackgrounds)
}

export type Appearance = 'light' | 'dark'

// While Light or Dark is chosen, nativeTheme reports the choice, not the OS, so
// what System would resolve to is read from the OS itself: macOS keeps it in the
// global AppleInterfaceStyle default, Windows in the AppsUseLightTheme value.
const WINDOWS_PERSONALIZE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'

/** Windows reports dark apps as AppsUseLightTheme 0; anything else is light. */
export function appearanceFromRegistry(output: string): Appearance {
  return /AppsUseLightTheme\s+REG_DWORD\s+0x0+\b/i.test(output) ? 'dark' : 'light'
}

/** What the System theme resolves to now, for its Settings label
 *  (app-chrome-conventions, Theme). */
export async function systemAppearance(platform: NodeJS.Platform = process.platform): Promise<Appearance> {
  if (nativeTheme.themeSource === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  if (platform === 'darwin') {
    return systemPreferences.getUserDefault('AppleInterfaceStyle', 'string') === 'Dark' ? 'dark' : 'light'
  }
  if (platform === 'win32') {
    return new Promise((resolve) => {
      execFile('reg', ['query', WINDOWS_PERSONALIZE, '/v', 'AppsUseLightTheme'], { timeout: 2_000, windowsHide: true },
        (error, stdout) => resolve(error ? 'light' : appearanceFromRegistry(stdout)))
    })
  }
  return 'light'
}

