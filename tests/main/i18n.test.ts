import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { header } from './file-header'

// AppKit's own Edit menu items pick up AppleLanguages from this app's own
// defaults domain, never the global one. An unpackaged run shares the
// Electron runtime's own domain with every other app in development, so this
// is only ever written for a packaged app.
const electron = vi.hoisted(() => ({
  defaults: new Map<string, unknown>(),
  calls: [] as string[],
  preferred: ['ja-JP', 'en-US'],
  isPackaged: true,
  sent: [] as Array<[string, unknown]>,
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
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => electron.sent.push([channel, payload]) } }],
  },
}))
vi.mock('../../src/main/config', () => ({ getConfigPath: () => '/tmp/imagequeue-test/config.json' }))

import { readSavedPreference, readSavedTimeZonePreference } from '../../src/main/i18n'
import { FILE_FORMATS } from '../../src/main/store-format'

// Main reads the saved language straight from config.json before anything is
// drawn; anything it cannot use follows the computer.
describe('readSavedPreference', () => {
  const marked = (general: unknown): string => JSON.stringify({ ...header(FILE_FORMATS.config), general })

  it('takes a supported tag from the general section', () => {
    expect(readSavedPreference(marked({ language: 'ja' }))).toBe('ja')
    expect(readSavedPreference(marked({ language: 'zh-Hans' }))).toBe('zh-Hans')
  })

  it('is System for a missing, unreadable, corrupt, or unknown value', () => {
    expect(readSavedPreference(null)).toBe('system')
    expect(readSavedPreference('{ not json')).toBe('system')
    expect(readSavedPreference(JSON.stringify({ ...header(FILE_FORMATS.config) }))).toBe('system')
    expect(readSavedPreference(marked({ language: 'pt' }))).toBe('system')
    expect(readSavedPreference(marked({ language: 'system' }))).toBe('system')
  })

  // The load path sets aside a file without its header and refuses a newer
  // one; neither file's language is ever the interface's.
  it('is System for a file the config store would not use', () => {
    expect(readSavedPreference(JSON.stringify({ general: { language: 'ja' } }))).toBe('system')
    expect(readSavedPreference(JSON.stringify({ ...header(FILE_FORMATS.config, FILE_FORMATS.config.version + 1), general: { language: 'ja' } }))).toBe('system')
    expect(readSavedPreference(JSON.stringify([{ general: { language: 'ja' } }]))).toBe('system')
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
    await i18n.settleLanguage()
    await i18n.applyLanguagePreference('fr')
    expect(electron.calls).toContain('remove')
    expect(electron.calls.indexOf('remove')).toBeLessThan(electron.calls.indexOf('read'))
    expect(electron.defaults.get('AppleLanguages')).toEqual(['fr'])
  })

  it('removes the entry when System is chosen', async () => {
    electron.defaults.set('AppleLanguages', ['fr'])
    const i18n = await load()
    await i18n.settleLanguage()
    await i18n.applyLanguagePreference('fr')
    await i18n.applyLanguagePreference('system')
    expect(electron.defaults.has('AppleLanguages')).toBe(false)
  })

  it('touches no defaults off macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const i18n = await load()
    await i18n.settleLanguage()
    await i18n.applyLanguagePreference('fr')
    expect(electron.calls.filter((call) => call !== 'read')).toEqual([])
  })

  it('touches no defaults on an unpackaged macOS run', async () => {
    electron.isPackaged = false
    const i18n = await load()
    await i18n.settleLanguage()
    await i18n.applyLanguagePreference('fr')
    expect(electron.calls.filter((call) => call !== 'read')).toEqual([])
  })
})

describe('the interface language\'s catalogue', () => {
  beforeEach(() => {
    electron.defaults.clear()
    electron.preferred = ['ja-JP', 'en-US']
  })

  it('is loaded before main draws anything', async () => {
    vi.resetModules()
    const i18n = await import('../../src/main/i18n')
    expect(i18n.mainTranslator().language).toBe('en')
    await i18n.settleLanguage()
    expect(i18n.mainTranslator().language).toBe('ja')
    expect(i18n.mainTranslator().t('nativeMenu.edit')).not.toBe('Edit')
  })

  it('follows the latest saved choice when an earlier one loads later', async () => {
    vi.resetModules()
    const i18n = await import('../../src/main/i18n')
    await i18n.settleLanguage()
    await Promise.all([i18n.applyLanguagePreference('fr'), i18n.applyLanguagePreference('ja')])
    expect(i18n.mainTranslator().language).toBe('ja')
  })
})

// The display zone travels with the language to every window.
describe('the display zone', () => {
  const marked = (general: Record<string, unknown>): string => JSON.stringify({ ...header(FILE_FORMATS.config), general })

  it('reads the saved zone the way it reads the language', () => {
    expect(readSavedTimeZonePreference(marked({ time_zone: 'Europe/Berlin' }))).toBe('Europe/Berlin')
    expect(readSavedTimeZonePreference(marked({ time_zone: 'Mars/Olympus' }))).toBe('system')
    expect(readSavedTimeZonePreference(null)).toBe('system')
  })

  it('hands every window a saved zone with what System resolves to, redrawing no native surface', async () => {
    vi.resetModules()
    electron.sent.splice(0)
    const i18n = await import('../../src/main/i18n')
    await i18n.settleLanguage()
    const native = vi.fn()
    i18n.onLanguageChanged(native)
    const language = i18n.mainTranslator().language
    await i18n.applyLocalePreferences(language, 'Europe/Berlin')
    expect(i18n.mainTranslator().timeZone).toBe('Europe/Berlin')
    expect(electron.sent).toEqual([['language:changed', expect.objectContaining({
      language, timeZone: 'Europe/Berlin', systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })]])
    expect(native).not.toHaveBeenCalled()
    await i18n.applyLocalePreferences(language, 'Europe/Berlin')
    expect(electron.sent).toHaveLength(1)
  })
})

