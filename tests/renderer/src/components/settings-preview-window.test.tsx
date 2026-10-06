// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { until } from '../../until'

// "Also show in a separate window" is one Settings › General choice beside
// Auto-preview, off by default, staged with the rest of the form and applied by
// Save; the main process opens or closes the preview window to match.

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

function baseConfig(previewWindow: boolean | undefined): Record<string, unknown> {
  const backend = (): Record<string, unknown> => ({ model: 'm', default_params: {}, concurrency: 3, timeout_ms: 180000 })
  return {
    provider: 'gemini',
    gemini: { endpoint: 'https://generativelanguage.googleapis.com', elaboration: 'gemini-3.8-flash', slug: 'gemini-3.5-flash-lite', thinking: { elaboration: '', slug: '' }, timeout_ms: 30000 },
    openai: { endpoint: 'https://api.openai.com/v1', elaboration: 'gpt-5.6-terra', slug: 'gpt-6-luna', thinking: { elaboration: '', slug: '' }, timeout_ms: 60000 },
    general: {
      theme: 'system', ui_font_family: '', auto_preview_idle_seconds: 30, export_dir: '',
      confirm_remove: false, confirm_delete: false, delete_to_trash: true,
      drop_empty_sessions: true, keep_awake_during_work: true, show_status_icon: true,
      ...(previewWindow === undefined ? {} : { show_preview_window: previewWindow }),
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

function renderWith(previewWindow: boolean | undefined): void {
  settingsValue = {
    settings: baseConfig(previewWindow),
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

function checkbox(): HTMLInputElement {
  return screen.getByRole('checkbox', { name: /Also show in a separate window/ }) as HTMLInputElement
}

beforeEach(() => {
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = { platform: 'darwin' }
})
afterEach(cleanup)

describe('Settings preview window choice', () => {
  it('sits under its own Preview heading and is off when the config has no value', () => {
    renderWith(undefined)
    expect(checkbox().checked).toBe(false)
    expect(checkbox().closest('.settings-option-panel')?.querySelector('.settings-option-title')?.textContent).toBe('Preview')
  })

  it('stages the choice and saves it only on Save', async () => {
    renderWith(false)
    fireEvent.click(checkbox())
    expect(settingsValue.saveChangedSettings).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const save = settingsValue.saveChangedSettings as ReturnType<typeof vi.fn>
    await until(() => expect(save).toHaveBeenCalledTimes(1))
    expect((save.mock.calls[0]![1] as { general: { show_preview_window: boolean } }).general.show_preview_window).toBe(true)
  })
})
