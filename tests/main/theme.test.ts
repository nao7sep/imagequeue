import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const listeners: Record<string, () => void> = {}
  const nativeTheme = {
    themeSource: 'system' as string,
    shouldUseDarkColors: false,
    on: vi.fn((event: string, listener: () => void) => {
      listeners[event] = listener
    }),
  }
  return { listeners, nativeTheme, interfaceStyle: '' as string, registry: '' as string }
})

vi.mock('electron', () => ({
  BrowserWindow: class {},
  nativeTheme: electron.nativeTheme,
  systemPreferences: { getUserDefault: (key: string) => (key === 'AppleInterfaceStyle' ? electron.interfaceStyle : undefined) },
}))
vi.mock('child_process', () => ({
  execFile: (_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) =>
    callback(null, electron.registry),
}))

import { appearanceFromRegistry, applyThemePreference, followOsThemeChanges, systemAppearance, trackThemedWindow, windowBackground } from '../../src/main/theme'
import { normalizeThemePreference } from '../../src/shared/theme'

function fakeWindow() {
  const closed: Array<() => void> = []
  return {
    setBackgroundColor: vi.fn(),
    isDestroyed: () => false,
    once: (_event: string, listener: () => void) => closed.push(listener),
    close: () => closed.forEach((listener) => listener()),
  }
}

beforeEach(() => {
  electron.nativeTheme.themeSource = 'system'
  electron.nativeTheme.shouldUseDarkColors = false
})

describe('theme', () => {
  it('resolves a missing or unknown stored value to System', () => {
    expect(normalizeThemePreference('light')).toBe('light')
    expect(normalizeThemePreference('dark')).toBe('dark')
    expect(normalizeThemePreference(undefined)).toBe('system')
    expect(normalizeThemePreference('sepia')).toBe('system')
  })

  it('hands the saved choice to Electron as the one theme authority', () => {
    applyThemePreference('dark')
    expect(electron.nativeTheme.themeSource).toBe('dark')
    applyThemePreference('sepia')
    expect(electron.nativeTheme.themeSource).toBe('system')
  })

  it('repaints tracked windows on Save and on an OS change, and forgets closed ones', () => {
    const window = fakeWindow()
    trackThemedWindow(window as never)
    electron.nativeTheme.shouldUseDarkColors = true
    applyThemePreference('dark')
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith(windowBackground(true))

    followOsThemeChanges()
    electron.nativeTheme.shouldUseDarkColors = false
    electron.listeners.updated?.()
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith(windowBackground(false))

    window.close()
    window.setBackgroundColor.mockClear()
    electron.listeners.updated?.()
    expect(window.setBackgroundColor).not.toHaveBeenCalled()
  })
})

// The System choice's label shows the OS appearance even while Light or Dark
// is chosen (app-chrome-conventions, Theme).
describe('what System resolves to', () => {
  it('follows nativeTheme while System is chosen', async () => {
    electron.nativeTheme.shouldUseDarkColors = true
    await expect(systemAppearance('darwin')).resolves.toBe('dark')
  })

  it('reads macOS\'s own appearance while Light or Dark is chosen', async () => {
    electron.nativeTheme.themeSource = 'light'
    electron.interfaceStyle = 'Dark'
    await expect(systemAppearance('darwin')).resolves.toBe('dark')
    electron.interfaceStyle = ''
    await expect(systemAppearance('darwin')).resolves.toBe('light')
  })

  it('reads Windows\' app appearance while Light or Dark is chosen', async () => {
    electron.nativeTheme.themeSource = 'dark'
    electron.registry = '    AppsUseLightTheme    REG_DWORD    0x1\r\n'
    await expect(systemAppearance('win32')).resolves.toBe('light')
    electron.registry = '    AppsUseLightTheme    REG_DWORD    0x0\r\n'
    await expect(systemAppearance('win32')).resolves.toBe('dark')
  })

  it('parses the Windows value, reading a missing one as light', () => {
    expect(appearanceFromRegistry('HKEY_CURRENT_USER\\...\r\n    AppsUseLightTheme    REG_DWORD    0x0\r\n')).toBe('dark')
    expect(appearanceFromRegistry('    AppsUseLightTheme    REG_DWORD    0x1')).toBe('light')
    expect(appearanceFromRegistry('')).toBe('light')
  })
})

