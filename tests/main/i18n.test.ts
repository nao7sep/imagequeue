import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// AppKit's own Edit menu items pick up AppleLanguages from this app's own
// defaults domain, never the global one. An unpackaged run shares the
// Electron runtime's own domain with every other app in development, so this
// is only ever written for a packaged app.
const electron = vi.hoisted(() => ({
  defaults: new Map<string, unknown>(),
  calls: [] as string[],
  preferred: ['ja-JP', 'en-US'],
  isPackaged: true,
}))

vi.mock('electron', () => ({
  app: {
    getPreferredSystemLanguages: () => {
      electron.calls.push('read')
      return (electron.defaults.get('AppleLanguages') as string[] | undefined) ?? electron.preferred
    },
    getSystemLocale: () => 'ja-JP',
    get isPackaged() {
      return electron.isPackaged
    },
  },
  systemPreferences: {
    setUserDefault: (key: string, _type: string, value: unknown) => {
      electron.calls.push(`set ${JSON.stringify(value)}`)
      electron.defaults.set(key, value)
    },
    removeUserDefault: (key: string) => {
      electron.calls.push('remove')
      electron.defaults.delete(key)
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../../src/main/config', () => ({ getConfigPath: () => '/tmp/imagequeue-test/config.json' }))

import { readSavedPreference } from '../../src/main/i18n'

// Main reads the saved language straight from config.json before anything is
// drawn; anything it cannot use follows the computer.
describe('readSavedPreference', () => {
  it('takes a supported tag from the general section', () => {
    expect(readSavedPreference(JSON.stringify({ general: { language: 'ja' } }))).toBe('ja')
    expect(readSavedPreference(JSON.stringify({ general: { language: 'zh-Hans' } }))).toBe('zh-Hans')
  })

  it('is System for a missing, unreadable, corrupt, or unknown value', () => {
    expect(readSavedPreference(null)).toBe('system')
    expect(readSavedPreference('{ not json')).toBe('system')
    expect(readSavedPreference(JSON.stringify({}))).toBe('system')
    expect(readSavedPreference(JSON.stringify({ general: { language: 'pt' } }))).toBe('system')
    expect(readSavedPreference(JSON.stringify({ general: { language: 'system' } }))).toBe('system')
  })
})

describe('AppKit language alignment', () => {
  const originalPlatform = process.platform
  beforeEach(() => {
    electron.defaults.clear()
    electron.calls.splice(0)
    electron.preferred = ['ja-JP', 'en-US']
    electron.isPackaged = true
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  async function load() {
    vi.resetModules()
    return import('../../src/main/i18n')
  }

  it('clears its own entry before reading the computer, then writes the saved choice', async () => {
    const i18n = await load()
    i18n.settleLanguage()
    i18n.applyLanguagePreference('fr')
    expect(electron.calls).toContain('remove')
    expect(electron.calls.indexOf('remove')).toBeLessThan(electron.calls.indexOf('read'))
    expect(electron.defaults.get('AppleLanguages')).toEqual(['fr'])
  })

  it('removes the entry when System is chosen', async () => {
    electron.defaults.set('AppleLanguages', ['fr'])
    const i18n = await load()
    i18n.settleLanguage()
    i18n.applyLanguagePreference('fr')
    i18n.applyLanguagePreference('system')
    expect(electron.defaults.has('AppleLanguages')).toBe(false)
  })

  it('touches no defaults off macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const i18n = await load()
    i18n.settleLanguage()
    i18n.applyLanguagePreference('fr')
    expect(electron.calls.filter((call) => call !== 'read')).toEqual([])
  })

  it('touches no defaults on an unpackaged macOS run', async () => {
    electron.isPackaged = false
    const i18n = await load()
    i18n.settleLanguage()
    i18n.applyLanguagePreference('fr')
    expect(electron.calls.filter((call) => call !== 'read')).toEqual([])
  })
})
