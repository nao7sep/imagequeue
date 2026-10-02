// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MainProcessLanguage, useI18n } from '../../../../src/renderer/src/i18n/I18nContext'
import { loadTranslator } from '../../../../src/shared/i18n/translate'
import type { LanguageEnvironment } from '../../../../src/shared/i18n/languages'

afterEach(cleanup)

function Probe(): React.JSX.Element {
  return <p>{useI18n().t('settings.language')}</p>
}

describe('MainProcessLanguage', () => {
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
