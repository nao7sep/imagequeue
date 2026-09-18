import { BrowserWindow, nativeTheme } from 'electron'
import { normalizeThemePreference } from '../shared/theme'
import { mainWindowBackground } from './window-options'

// Electron's nativeTheme.themeSource is ImageQueue's one theme authority
// (app-chrome conventions, Theme): it paints the native title bar, menus, and
// dialogs, and it decides `prefers-color-scheme` in every renderer and in the
// toast window, which is what their stylesheets follow. No renderer resolves
// System itself.

// Only windows painted with the app surface follow the theme's background: the
// viewer stays black behind its image and the toast window stays transparent.
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
