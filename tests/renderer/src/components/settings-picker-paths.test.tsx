// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { until } from '../../until'
import { settingsEnvironment } from './settings-environment'

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
    notifications: { notifications_enabled: true, success_file: '', failure_file: '' },
    image_backends: {
      openai: backend(), nanobanana: backend(), grok: backend(), flux: backend(),
      drawthings: { timeout_ms: 1800000, default_params: {}, models_dir: '', check_updates_at_launch: true },
    },
    prompts: { slug: 'slug' },
    brainstorm: {},
  }
}

function renderWith(previewWindow: boolean | undefined): RenderResult {
  settingsValue = {
    settings: baseConfig(previewWindow),
    apiKeys: {},
    apiKeyPresence: null,
    saveChangedSettings: vi.fn().mockResolvedValue({}),
    saveBrainstormSettings: vi.fn().mockResolvedValue({}),
    saveImageBackendDefaults: vi.fn().mockResolvedValue({}),
    saveNotificationField: vi.fn().mockResolvedValue({}),
  }
  return render(<SettingsModal onClose={() => {}} />)
}

beforeEach(() => {
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = { platform: 'darwin', ...settingsEnvironment, openDirectoryDialog: vi.fn(async () => null), openFileDialog: vi.fn(async () => null) }
})
afterEach(cleanup)

describe('Settings Browse context', () => {
  it('uses the export draft and a literal repeated pick, leaving cancellation unchanged', async () => {
    renderWith(undefined)
    const input = document.getElementById('settings-exportFolder') as HTMLInputElement
    const browse = within(input.parentElement!).getByRole('button', { name: 'Browse' })
    fireEvent.click(browse)
    await until(() => expect(window.electronAPI.openDirectoryDialog).toHaveBeenLastCalledWith('', false))
    fireEvent.change(input, { target: { value: '~/draft' } })
    const picked = '/chosen/ $HOME%EXPORT% '
    vi.mocked(window.electronAPI.openDirectoryDialog).mockResolvedValueOnce(picked)
    fireEvent.click(browse)
    await until(() => expect(input.value).toBe(picked))
    expect(window.electronAPI.openDirectoryDialog).toHaveBeenLastCalledWith('~/draft', true)
    fireEvent.click(browse)
    await until(() => expect(window.electronAPI.openDirectoryDialog).toHaveBeenLastCalledWith(picked, false))
    expect(input.value).toBe(picked)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await until(() => expect(settingsValue.saveChangedSettings).toHaveBeenLastCalledWith(
      expect.any(Object), expect.any(Object), {}, [],
    ))
  })

  it('marks typed absolute expressions for expansion on Save', async () => {
    renderWith(undefined)
    const input = document.getElementById('settings-exportFolder') as HTMLInputElement
    fireEvent.change(input, { target: { value: '/exports/$HOME' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await until(() => expect(settingsValue.saveChangedSettings).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Object), {}, ['export_dir'],
    ))
  })

  it.each([['successSound', 'success_file'], ['failureSound', 'failure_file']])('marks the typed %s expression on Save', async (id, field) => {
    renderWith(undefined)
    fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }))
    const input = document.getElementById('settings-' + id) as HTMLInputElement
    fireEvent.change(input, { target: { value: '/sounds/%SOUND%.wav' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await until(() => expect(settingsValue.saveChangedSettings).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Object), {}, [field],
    ))
  })

  it.each(['successSound', 'failureSound'])('uses the current %s draft, preserving a literal pick and Cancel', async (id) => {
    renderWith(undefined)
    fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }))
    const input = document.getElementById('settings-' + id) as HTMLInputElement
    const browse = within(input.parentElement!).getByRole('button', { name: 'Browse' })
    fireEvent.change(input, { target: { value: '~/sounds/draft.wav' } })
    const picked = '/sounds/ $HOME%SOUND%.wav '
    vi.mocked(window.electronAPI.openFileDialog).mockResolvedValueOnce(picked)
    fireEvent.click(browse)
    await until(() => expect(input.value).toBe(picked))
    expect(window.electronAPI.openFileDialog).toHaveBeenLastCalledWith(expect.any(Array), '~/sounds/draft.wav', undefined, true)
    fireEvent.click(browse)
    await until(() => expect(window.electronAPI.openFileDialog).toHaveBeenLastCalledWith(expect.any(Array), picked, undefined, false))
    expect(input.value).toBe(picked)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await until(() => expect(settingsValue.saveChangedSettings).toHaveBeenLastCalledWith(
      expect.any(Object), expect.any(Object), {}, [],
    ))
  })
})
