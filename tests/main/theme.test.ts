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
  return { listeners, nativeTheme }
})

vi.mock('electron', () => ({ BrowserWindow: class {}, nativeTheme: electron.nativeTheme }))

import { applyThemePreference, followOsThemeChanges, trackThemedWindow, windowBackground } from '../../src/main/theme'
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
