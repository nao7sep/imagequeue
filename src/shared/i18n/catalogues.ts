import en from './locales/en.json'
import type { Language } from './languages'

// English defines the key set; every other catalogue carries every key, with
// plural entries keyed by the language's own CLDR categories. The catalogue
// gate (tests/i18n/catalogues.test.ts) checks keys, placeholders, plural forms,
// and untranslated English.
export type MessageKey = keyof typeof en

export type CatalogueEntry = string | Readonly<Record<string, string>>

export type Catalogue = Readonly<Record<MessageKey, CatalogueEntry>>

export const ENGLISH: Catalogue = en

// One dynamic import per catalogue, so the bundler splits each language into
// its own chunk and a process loads only the interface language and English
// (localization-stack-conventions). Each is typed as a Catalogue, so a missing
// key fails the type check.
const LOADERS: Readonly<Record<Exclude<Language, 'en'>, () => Promise<Catalogue>>> = {
  de: () => import('./locales/de.json').then((m) => m.default),
  es: () => import('./locales/es.json').then((m) => m.default),
  fr: () => import('./locales/fr.json').then((m) => m.default),
  it: () => import('./locales/it.json').then((m) => m.default),
  'pt-BR': () => import('./locales/pt-BR.json').then((m) => m.default),
  ru: () => import('./locales/ru.json').then((m) => m.default),
  ja: () => import('./locales/ja.json').then((m) => m.default),
  ko: () => import('./locales/ko.json').then((m) => m.default),
  'zh-Hans': () => import('./locales/zh-Hans.json').then((m) => m.default),
}

export function loadCatalogue(language: Language): Promise<Catalogue> {
  return language === 'en' ? Promise.resolve(ENGLISH) : LOADERS[language]()
}
