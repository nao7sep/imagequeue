// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

// The theme is one Settings › General choice of System, Light, or Dark, staged
// with the rest of the form and applied only by Save (app-chrome conventions).

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

function baseConfig(theme: unknown): Record<string, unknown> {
  const backend = (): Record<string, unknown> => ({ model: 'm', default_params: {}, concurrency: 3, timeout_ms: 180000 })
  return {
    text_ai: {
      backend: 'gemini',
      gemini: { timeout_ms: 30000, main_model: 'gemini-3.7-flash', light_model: 'gemini-3.5-flash-lite' },
      openai: { endpoint: '', timeout_ms: 60000, main_model: 'm', light_model: 'l' },
    },
    general: {
      theme, ui_font_family: '', auto_preview_idle_seconds: 30, export_dir: '',
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

function renderWith(theme: unknown): void {
  settingsValue = {
    settings: baseConfig(theme),
    apiKeys: {},
    apiKeyPresence: null,
    saveChangedSettings: vi.fn().mockResolvedValue({}),
    saveApiKeys: vi.fn().mockResolvedValue({}),
    saveBrainstormSettings: vi.fn().mockResolvedValue({}),
    saveImageBackendDefaults: vi.fn().mockResolvedValue({}),
    saveNotificationField: vi.fn().mockResolvedValue({}),
  }
  render(<SettingsModal onClose={() => {}} />)
}

function themeRadios(): HTMLInputElement[] {
  return within(screen.getByRole('radiogroup', { name: 'Theme' })).getAllByRole('radio') as HTMLInputElement[]
}

beforeEach(() => {
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = { platform: 'darwin' }
})
afterEach(cleanup)

describe('Settings theme choice', () => {
  it('offers System, Light, and Dark as one radio group', () => {
    renderWith('dark')
    const radios = themeRadios()
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1)
    expect(radios.find((radio) => radio.checked)?.value).toBe('dark')
  })

  it('shows System for a missing or unknown stored value', () => {
    renderWith('sepia')
    expect(themeRadios().find((radio) => radio.checked)?.value).toBe('system')
  })

  it('stages the choice and saves it only on Save', async () => {
    renderWith('system')
    fireEvent.click(themeRadios()[1]!)
    expect(settingsValue.saveChangedSettings).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const save = settingsValue.saveChangedSettings as ReturnType<typeof vi.fn>
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect((save.mock.calls[0]![1] as { general: { theme: string } }).general.theme).toBe('light')
  })
})
