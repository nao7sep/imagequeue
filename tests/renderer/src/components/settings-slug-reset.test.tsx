// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { until } from '../../until'

// Reset slug template fills the draft with the shipped template and stores
// nothing of its own: Save sends the draft like any other edit, and main removes
// the key because it equals the built-in; Cancel discards it.

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
    provider: 'gemini',
    gemini: { endpoint: 'https://generativelanguage.googleapis.com', elaboration: 'gemini-3.8-flash', slug: 'gemini-3.5-flash-lite', thinking: { elaboration: '', slug: '' }, timeout_ms: 30000 },
    openai: { endpoint: 'https://api.openai.com/v1', elaboration: 'gpt-5.6-terra', slug: 'gpt-6-luna', thinking: { elaboration: '', slug: '' }, timeout_ms: 60000 },
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
    prompts: { slug: 'my slug' },
    brainstorm: {},
  }
}

function renderWith(theme: unknown, onClose = vi.fn()): void {
  settingsValue = {
    settings: baseConfig(theme),
    apiKeys: {},
    apiKeyPresence: null,
    saveChangedSettings: vi.fn().mockResolvedValue({}),
    saveBrainstormSettings: vi.fn().mockResolvedValue({}),
    saveImageBackendDefaults: vi.fn().mockResolvedValue({}),
    saveNotificationField: vi.fn().mockResolvedValue({}),
  }
  render(<SettingsModal onClose={onClose} />)
}

beforeEach(() => {
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
    platform: 'darwin', promptsGetDefaultSlug: vi.fn().mockResolvedValue('shipped slug'),
  }
})
afterEach(cleanup)

async function resetSlug(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Reset slug template', hidden: true }))
  await until(() => expect(screen.getByDisplayValue('shipped slug')).toBeTruthy())
}

describe('Reset slug template', () => {
  it('fills the draft, and Save sends it as an ordinary edit', async () => {
    renderWith('system')
    await resetSlug()
    expect(settingsValue.saveChangedSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const save = settingsValue.saveChangedSettings as ReturnType<typeof vi.fn>
    await until(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![2]).toEqual({})
    expect((save.mock.calls[0]![1] as { prompts: { slug: string } }).prompts.slug).toBe('shipped slug')
  })

  it('writes nothing when followed by Cancel', async () => {
    const onClose = vi.fn()
    renderWith('system', onClose)
    await resetSlug()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await until(() => expect(onClose).toHaveBeenCalled())
    expect(settingsValue.saveChangedSettings).not.toHaveBeenCalled()
  })
})
