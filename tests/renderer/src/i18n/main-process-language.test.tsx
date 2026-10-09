// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MainProcessLanguage, useI18n } from '../../../../src/renderer/src/i18n/I18nContext'
import { loadTranslator } from '../../../../src/shared/i18n/translate'
import type { LanguageEnvironment } from '../../../../src/shared/i18n/languages'

vi.mock('../../../../src/shared/i18n/translate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/shared/i18n/translate')>()
  return { ...actual, loadTranslator: vi.fn(actual.loadTranslator) }
})

afterEach(() => { cleanup(); vi.mocked(loadTranslator).mockClear() })

function Probe(): React.JSX.Element {
  return <p>{useI18n().t('settings.language')}</p>
}

describe('MainProcessLanguage', () => {
  it('shows bundled English and logs a rejected initial catalogue', async () => {
    const error = new Error('catalogue unavailable')
    vi.mocked(loadTranslator).mockRejectedValueOnce(error)
    const appLog = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      onLanguageChanged: () => () => {},
      getLanguageEnvironment: async () => ({ language: 'ja', locale: 'ja' }),
      appLog,
    }
    render(<MainProcessLanguage><Probe /></MainProcessLanguage>)
    expect(await screen.findByText('Language')).toBeTruthy()
    expect(appLog).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({
      language: 'ja', error: expect.objectContaining({ message: error.message }),
    }))
  })

  it('keeps the working language when a later catalogue fails', async () => {
    let change!: (environment: LanguageEnvironment) => void
    ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      onLanguageChanged: (listener: typeof change) => { change = listener; return () => {} },
      getLanguageEnvironment: async () => ({ language: 'ja', locale: 'ja' }),
      appLog: vi.fn().mockResolvedValue(undefined),
    }
    const expected = (await loadTranslator('ja')).t('settings.language')
    render(<MainProcessLanguage><Probe /></MainProcessLanguage>)
    expect(await screen.findByText(expected)).toBeTruthy()
    vi.mocked(loadTranslator).mockRejectedValueOnce(new Error('missing German'))
    await act(async () => change({ language: 'de', locale: 'de' }))
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('ignores an older rejection after a newer language loads', async () => {
    let reject!: (error: Error) => void
    let change!: (environment: LanguageEnvironment) => void
    vi.mocked(loadTranslator).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      onLanguageChanged: (listener: typeof change) => { change = listener; return () => {} },
      getLanguageEnvironment: async () => ({ language: 'de', locale: 'de' }),
      appLog: vi.fn().mockResolvedValue(undefined),
    }
    render(<MainProcessLanguage><Probe /></MainProcessLanguage>)
    await act(async () => {})
    await act(async () => change({ language: 'ja', locale: 'ja' }))
    const expected = (await loadTranslator('ja')).t('settings.language')
    expect(await screen.findByText(expected)).toBeTruthy()
    await act(async () => reject(new Error('older catalogue failed')))
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('renders nothing until the interface language is loaded, so the first words are in it', async () => {
    let resolve!: (environment: LanguageEnvironment) => void
    ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      onLanguageChanged: () => () => {},
      getLanguageEnvironment: () => new Promise<LanguageEnvironment>((r) => { resolve = r }),
    }
    const { container } = render(<MainProcessLanguage><Probe /></MainProcessLanguage>)
    expect(container.textContent).toBe('')

    await act(async () => resolve({ language: 'ja', locale: 'ja' }))
    const expected = (await loadTranslator('ja')).t('settings.language')
    expect(await screen.findByText(expected)).toBeTruthy()
  })
})
