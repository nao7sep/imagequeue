// The interface language, owned by the main process (fleet localization). Main
// resolves the saved choice against the computer's language, draws its own
// native surfaces (menus, tray, dialogs, the toast, the startup-failure window)
// from the shared catalogues, and hands every window the language it settled
// on, so both processes always agree.
//
// The computer's languages are read once, at launch; System resolves against
// that reading for the whole session.

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
import { createTranslator, type Translator } from '../shared/i18n/translate'
import { getConfigPath } from './config'
import { handle } from './ipc-boundary'
import { log, serializeError } from './logger'

export const LANGUAGE_CHANGED_CHANNEL = 'language:changed'

interface LanguageState {
  systemLanguage: Language
  systemLocale: string | null
  preference: LanguagePreference
  translator: Translator
}

let state: LanguageState | null = null
const listeners = new Set<(translator: Translator) => void>()

/**
 * The saved choice, read straight from config.json without the store, as the
 * theme's first paint is: a missing, unreadable, or corrupt file is System, and
 * recovering a corrupt one stays with the load path.
 */
export function readSavedPreference(configText: string | null): LanguagePreference {
  if (configText === null) return 'system'
  try {
    const parsed = JSON.parse(configText) as { general?: { language?: unknown } }
    return normalizeLanguagePreference(parsed?.general?.language)
  } catch {
    return 'system'
  }
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
// System removes the entry, so the computer's own list applies again.
const APPLE_LANGUAGES = 'AppleLanguages'

function computerLanguages(): string[] {
  if (process.platform === 'darwin') {
    // The entry this app wrote shadows the computer's list; clear it first so
    // System reads what the computer prefers, then write it back below.
    systemPreferences.removeUserDefault(APPLE_LANGUAGES)
  }
  return app.getPreferredSystemLanguages()
}

function alignAppKit(preference: LanguagePreference): void {
  if (process.platform !== 'darwin') return
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

function build(systemLanguage: Language, systemLocale: string | null, preference: LanguagePreference): LanguageState {
  const language = effectiveLanguage(preference, systemLanguage)
  return {
    systemLanguage,
    systemLocale,
    preference,
    translator: createTranslator(language, formattingLocale(language, systemLocale)),
  }
}

/** Settles the language once the app is ready, before any window or native menu exists. */
export function settleLanguage(): void {
  const systemLanguage = resolveSystemLanguage(computerLanguages())
  const preference = readSavedPreference(readConfigText())
  state = build(systemLanguage, app.getSystemLocale() || null, preference)
  alignAppKit(preference)
}

/** The translator main draws its own surfaces with. English before settling. */
export function mainTranslator(): Translator {
  return state?.translator ?? createTranslator('en')
}

export function languageEnvironment(): LanguageEnvironment {
  const translator = mainTranslator()
  return { language: translator.language, locale: translator.locale }
}

/** Native surfaces that hold words register here and redraw on a change. */
export function onLanguageChanged(listener: (translator: Translator) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Applies a saved choice: every window and native surface follows at once. */
export function applyLanguagePreference(value: unknown): void {
  if (!state) return
  const preference = normalizeLanguagePreference(value)
  if (preference === state.preference) return
  const previous = state.translator.language
  state = build(state.systemLanguage, state.systemLocale, preference)
  alignAppKit(preference)
  if (state.translator.language === previous) return
  const translator = state.translator
  for (const listener of listeners) {
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
