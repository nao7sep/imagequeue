// The interface language, owned by the main process (fleet localization). Main
// resolves the saved choice against the computer's language, draws its own
// native surfaces (menus, tray, dialogs, the toast, the startup-failure window)
// from the shared catalogues, and hands every window the language it settled
// on, so both processes always agree.
//
// The computer's languages are read once, at launch; System resolves against
// that reading for the whole session. The display zone (shared/time-zone)
// travels with the language: the same environment hands every window both, so
// every time on screen is formatted in one zone.

import fs from 'fs'
import { app, BrowserWindow, systemPreferences } from 'electron'
import {
  effectiveLanguage,
  formattingLocale,
  normalizeLanguagePreference,
  systemLanguage as resolveSystemLanguage,
  type Language,
  type LanguageEnvironment,
  type LanguagePreference,
} from '../shared/i18n/languages'
import { createTranslator, loadTranslator, type Translator } from '../shared/i18n/translate'
import {
  normalizeTimeZonePreference,
  resolveDisplayZone,
  systemTimeZone,
  type TimeZonePreference,
} from '../shared/time-zone'
import { ENGLISH } from '../shared/i18n/catalogues'
import { getConfigPath } from './config'
import { handle } from './ipc-boundary'
import { log, serializeError } from './logger'
import { checkFormat, FORMAT_VERSIONS } from './store-format'

export const LANGUAGE_CHANGED_CHANNEL = 'language:changed'

interface LanguageState {
  systemLanguage: Language
  systemLocale: string | null
  systemZone: string | undefined
  preference: LanguagePreference
  zonePreference: TimeZonePreference
  translator: Translator
}

let state: LanguageState | null = null
// The latest preference applied; a load for an older one is dropped.
let latestApply = 0
const listeners = new Set<(translator: Translator) => void>()

/**
 * The saved choice, read straight from config.json without the store, as the
 * theme's first paint is: a missing, unreadable, or corrupt file is System, and
 * recovering a corrupt one stays with the load path. A file without this
 * build's format version is one the load path sets aside or refuses, so its
 * language is never used either.
 */
function savedGeneral(configText: string | null): { language?: unknown; time_zone?: unknown } | undefined {
  if (configText === null) return undefined
  try {
    const parsed: unknown = JSON.parse(configText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const stored = checkFormat(parsed as Record<string, unknown>, FORMAT_VERSIONS.config, 'config.json') as {
      general?: { language?: unknown; time_zone?: unknown }
    }
    return stored.general
  } catch {
    return undefined
  }
}

export function readSavedPreference(configText: string | null): LanguagePreference {
  return normalizeLanguagePreference(savedGeneral(configText)?.language)
}

/** The saved display zone, read the same way as the language. */
export function readSavedTimeZonePreference(configText: string | null): TimeZonePreference {
  return normalizeTimeZonePreference(savedGeneral(configText)?.time_zone)
}

function readConfigText(): string | null {
  try {
    return fs.readFileSync(getConfigPath(), 'utf8')
  } catch {
    return null
  }
}

// macOS draws some Edit menu items itself (Emoji & Symbols, Start Dictation,
// AutoFill, Writing Tools, Services) in the language AppKit settles on before
// any JavaScript runs, from AppleLanguages. Electron offers no volatile argument
// domain, so ImageQueue keeps the interface language in its own defaults domain
// (never the global one): AppKit, and Chromium's own strings, pick it up at the
// next launch, as the conventions allow for a language saved mid-session.
// System removes the entry, so the computer's own list applies again. Only the
// packaged app does this: an unpackaged run shares the Electron runtime's own
// domain with every other app in development.
const APPLE_LANGUAGES = 'AppleLanguages'

function ownsAppKitLanguages(): boolean {
  return process.platform === 'darwin' && app.isPackaged
}

function computerLanguages(): string[] {
  if (ownsAppKitLanguages()) {
    // The entry this app wrote shadows the computer's list; clear it first so
    // System reads what the computer prefers, then write it back below.
    systemPreferences.removeUserDefault(APPLE_LANGUAGES)
  }
  return app.getPreferredSystemLanguages()
}

function alignAppKit(preference: LanguagePreference): void {
  if (!ownsAppKitLanguages()) return
  try {
    if (preference === 'system') systemPreferences.removeUserDefault(APPLE_LANGUAGES)
    else systemPreferences.setUserDefault(APPLE_LANGUAGES, 'array', [preference])
  } catch (err) {
    log('warn', 'AppKit language could not be aligned with the interface language', {
      preference,
      error: serializeError(err),
    })
  }
}

type Computer = Pick<LanguageState, 'systemLanguage' | 'systemLocale' | 'systemZone'>

async function build(computer: Computer, preference: LanguagePreference, zonePreference: TimeZonePreference): Promise<LanguageState> {
  const language = effectiveLanguage(preference, computer.systemLanguage)
  const zone = resolveDisplayZone(zonePreference, computer.systemZone)
  return {
    ...computer,
    preference,
    zonePreference,
    translator: await loadTranslator(language, formattingLocale(language, computer.systemLocale), zone),
  }
}

/** Settles the language and display zone once the app is ready, before any
 *  window or native menu exists. The computer's zone is read on every launch. */
export async function settleLanguage(): Promise<void> {
  const text = readConfigText()
  const preference = readSavedPreference(text)
  state = await build({
    systemLanguage: resolveSystemLanguage(computerLanguages()),
    systemLocale: app.getSystemLocale() || null,
    systemZone: systemTimeZone(),
  }, preference, readSavedTimeZonePreference(text))
  alignAppKit(preference)
}

/** The translator main draws its own surfaces with. English before settling. */
export function mainTranslator(): Translator {
  return state?.translator ?? createTranslator('en', ENGLISH)
}

export function languageEnvironment(): LanguageEnvironment {
  const translator = mainTranslator()
  const systemZone = state?.systemZone
  return {
    language: translator.language,
    locale: translator.locale,
    timeZone: translator.timeZone ?? resolveDisplayZone('system', systemZone),
    systemLanguage: state?.systemLanguage ?? 'en',
    systemTimeZone: resolveDisplayZone('system', systemZone),
  }
}

/** Native surfaces that hold words register here and redraw on a change. */
export function onLanguageChanged(listener: (translator: Translator) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Applies a saved language: every window and native surface follows at once. */
export async function applyLanguagePreference(value: unknown): Promise<void> {
  if (!state) return
  await applyPreferences(normalizeLanguagePreference(value), state.zonePreference)
}

/** Applies a saved language and display zone together, as Settings saves
 *  them: every window and native surface follows at once. */
export async function applyLocalePreferences(language: unknown, timeZone: unknown): Promise<void> {
  await applyPreferences(normalizeLanguagePreference(language), normalizeTimeZonePreference(timeZone))
}

async function applyPreferences(preference: LanguagePreference, zonePreference: TimeZonePreference): Promise<void> {
  const applying = ++latestApply
  if (!state) return
  if (preference === state.preference && zonePreference === state.zonePreference) return
  const next = await build(state, preference, zonePreference)
  if (applying !== latestApply) return
  const previous = state.translator
  state = next
  alignAppKit(preference)
  if (state.translator.language === previous.language && state.translator.timeZone === previous.timeZone) return
  const translator = state.translator
  // Native surfaces hold words, not times; they redraw only for a new language.
  for (const listener of state.translator.language === previous.language ? [] : listeners) {
    try {
      listener(translator)
    } catch (err) {
      log('error', 'A native surface failed to follow the language change', { error: serializeError(err) })
    }
  }
  const environment = languageEnvironment()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(LANGUAGE_CHANGED_CHANNEL, environment)
  }
}

export function registerLanguageIpc(): void {
  handle('language:environment', () => languageEnvironment())
}
