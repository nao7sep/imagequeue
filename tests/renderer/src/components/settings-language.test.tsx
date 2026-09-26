// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { I18nProvider } from '../../../../src/renderer/src/i18n/I18nContext'
import type { Language } from '../../../../src/shared/i18n/languages'

// The interface language is one Settings › General choice: System first, then
// each language by its own name, staged with the rest of the form and applied
// only by Save (localization-conventions, Choosing the language).

let settingsValue: Record<string, unknown>

vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => settingsValue,
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => async () => true,
}))
vi.mock('../../../../src/renderer/src/context/UiStateContext', () => ({
  useUiState: () => ({ uiState: { columnWidth: null, notificationVolume: 0.7 }, patchUiState: vi.fn() }),
}))

const { SettingsModal } = await import('../../../../src/renderer/src/components/SettingsModal')

function baseConfig(language: unknown): Record<string, unknown> {
  const backend = (): Record<string, unknown> => ({ model: 'm', default_params: {}, concurrency: 3, timeout_ms: 180000 })
  return {
    text_ai: {
      backend: 'gemini',
      gemini: { timeout_ms: 30000, main_model: 'gemini-3.7-flash', light_model: 'gemini-3.5-flash-lite' },
      openai: { endpoint: '', timeout_ms: 60000, main_model: 'm', light_model: 'l' },
    },
    general: {
      theme: 'system', language, ui_font_family: '', auto_preview_idle_seconds: 30, export_dir: '',
      confirm_remove: false, confirm_delete: false, delete_to_trash: true,
      drop_empty_sessions: true, keep_awake_during_work: true, show_status_icon: true,
    },
    notifications: { notifications_enabled: true, sounds_enabled: true, success_file: '', failure_file: '' },
    image_backends: {
      openai: backend(), nanobanana: backend(), grok: backend(), flux: backend(),
      drawthings: { timeout_ms: 1800000, default_params: {}, models_dir: '', check_updates_at_launch: true },
    },
    prompts: { slug: 'slug' },
    brainstorm: {},
  }
}

function renderWith(language: unknown, interfaceLanguage: Language = 'en'): void {
  settingsValue = {
    settings: baseConfig(language),
    apiKeys: {},
    apiKeyPresence: null,
    saveChangedSettings: vi.fn().mockResolvedValue({}),
    saveApiKeys: vi.fn().mockResolvedValue({}),
    saveBrainstormSettings: vi.fn().mockResolvedValue({}),
    saveImageBackendDefaults: vi.fn().mockResolvedValue({}),
    saveNotificationField: vi.fn().mockResolvedValue({}),
  }
  render(
    <I18nProvider language={interfaceLanguage} locale={interfaceLanguage}>
      <SettingsModal onClose={() => {}} />
    </I18nProvider>,
  )
}

function languageSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: /Language|言語/ }) as HTMLSelectElement
}

beforeEach(() => {
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = { platform: 'darwin' }
})
afterEach(cleanup)

describe('Settings language choice', () => {
  it('lists System, then each language in its own name and script', () => {
    renderWith('system')
    const options = within(languageSelect()).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((option) => option.value)).toEqual(['system', 'en', 'de', 'es', 'fr', 'it', 'pt-BR', 'ru', 'ja', 'ko', 'zh-Hans'])
    expect(options.map((option) => option.textContent)).toEqual([
      'System', 'English', 'Deutsch', 'Español', 'Français', 'Italiano', 'Português', 'Русский', '日本語', '한국어', '中文',
    ])
    expect(options.slice(1).map((option) => option.lang)).toEqual(['en', 'de', 'es', 'fr', 'it', 'pt-BR', 'ru', 'ja', 'ko', 'zh-Hans'])
  })

  it('keeps each language in its own name whatever language is showing', () => {
    renderWith('ja', 'ja')
    const options = within(languageSelect()).getAllByRole('option') as HTMLOptionElement[]
    expect(options[0]!.textContent).not.toBe('System')
    expect(options.map((option) => option.textContent).slice(1)).toContain('Deutsch')
    expect(languageSelect().value).toBe('ja')
  })

  it('shows System for a missing or unknown stored value', () => {
    renderWith('klingon')
    expect(languageSelect().value).toBe('system')
  })

  it('stages the choice and saves it only on Save', async () => {
    renderWith('system')
    fireEvent.change(languageSelect(), { target: { value: 'ru' } })
    expect(settingsValue.saveChangedSettings).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const save = settingsValue.saveChangedSettings as ReturnType<typeof vi.fn>
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect((save.mock.calls[0]![1] as { general: { language: string } }).general.language).toBe('ru')
  })
})
