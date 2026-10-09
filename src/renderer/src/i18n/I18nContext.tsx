import { createContext, Fragment, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LanguageEnvironment } from '../../../shared/i18n/languages'
import { createTranslator, loadTranslator, type Translator as BaseTranslator } from '../../../shared/i18n/translate'
import { ENGLISH, type MessageKey } from '../../../shared/i18n/catalogues'
import { serializeError } from '../../../shared/serialize-error'

export type Translator = BaseTranslator & {
  // Like t, but a placeholder may be filled with markup (a <code> path, say).
  rich: (key: MessageKey, values: Record<string, ReactNode>) => ReactNode
}

function rendererTranslator(base: BaseTranslator): Translator {
  return {
    ...base,
    rich: (key, values) =>
      base.parts(key).map((part, index) =>
        index % 2 === 0
          ? part
          : createElement(Fragment, { key: index }, part in values ? values[part] : `{${part}}`),
      ),
  }
}

// English until a provider says otherwise, so a component rendered on its own
// (in a test, say) still has text.
const englishTranslator = rendererTranslator(createTranslator('en', ENGLISH))
const I18nContext = createContext<Translator>(englishTranslator)

// The translator of the last language a provider declared, for the
// last-resort error boundary outside the provider.
let declaredTranslator: Translator = englishTranslator

export function I18nProvider({
  translator: base,
  children,
}: {
  translator: BaseTranslator
  children: ReactNode
}): React.JSX.Element {
  const translator = useMemo(() => rendererTranslator(base), [base])
  const language = translator.language

  // <html lang> picks the right glyphs for Chinese, Japanese and Korean text and
  // tells the last-resort error boundary, which sits outside this provider,
  // which language to speak.
  useEffect(() => {
    document.documentElement.lang = language
    declaredTranslator = translator
  }, [language, translator])

  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>
}

/**
 * The language the main process settled on, followed live: main resolves the
 * saved choice and the computer's language, and tells every window when a
 * saved change moves it. Nothing renders until the language and its catalogue
 * are loaded, so the first words on screen are already in it.
 */
export function MainProcessLanguage({ children }: { children: ReactNode }): React.JSX.Element | null {
  const [translator, setTranslator] = useState<BaseTranslator | null>(null)

  useEffect(() => {
    let cancelled = false
    // Each environment loads its catalogue; only the latest one applies, and a
    // change overrides the first read even when the read lands later.
    let latest = 0
    let changed = false
    const apply = (environment: LanguageEnvironment, fromChange: boolean): void => {
      if (!fromChange && changed) return
      if (fromChange) changed = true
      const request = ++latest
      void loadTranslator(environment.language, environment.locale).then((next) => {
        if (!cancelled && request === latest) setTranslator(next)
      }).catch((error: unknown) => {
        // A missing catalogue must not strand a window at its blank launch
        // gate. Keep readable words, and never let an older request undo a
        // more recent choice, even when that older request failed.
        if (!cancelled && request === latest) {
          setTranslator((current) => current ?? englishTranslator)
        }
        void window.electronAPI.appLog('warn', 'Interface catalogue could not be loaded', {
          language: environment.language,
          error: serializeError(error),
        }).catch((logError) => console.error('Failed to record catalogue diagnostic', logError))
      })
    }
    const unsubscribe = window.electronAPI.onLanguageChanged((next) => apply(next, true))
    void window.electronAPI.getLanguageEnvironment()
      .then((next) => apply(next, false))
      // A failed read leaves English in its own format rather than no window.
      .catch(() => apply({ language: 'en', locale: 'en' }, false))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (!translator) return null
  return <I18nProvider translator={translator}>{children}</I18nProvider>
}

export function useI18n(): Translator {
  return useContext(I18nContext)
}

// For surfaces outside the provider: the language a provider last declared.
export function documentTranslator(): Translator {
  return declaredTranslator
}
