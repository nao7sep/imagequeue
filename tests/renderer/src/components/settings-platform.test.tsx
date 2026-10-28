// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { settingsEnvironment } from './settings-environment'

// Settings offers only what the platform has: the status icon lives in the
// menu bar on macOS and the notification area on Windows, and exists nowhere
// else; the Draw Things section is macOS-only.

let settingsValue: Record<string, unknown>

vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => settingsValue,
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => async () => true,
}))
vi.mock('../../../../src/renderer/src/context/UiStateContext', () => ({
  useUiState: () => ({ uiState: { columnWidth: null }, patchUiState: vi.fn() }),
}))

const { SettingsModal } = await import('../../../../src/renderer/src/components/SettingsModal')

function baseConfig(): Record<string, unknown> {
  const backend = (): Record<string, unknown> => ({ model: 'm', default_params: {}, concurrency: 3, timeout_ms: 180000 })
  return {
    provider: 'gemini',
    gemini: { endpoint: 'https://generativelanguage.googleapis.com', elaboration: 'gemini-3.8-flash', slug: 'gemini-3.5-flash-lite', thinking: { elaboration: '', slug: '' }, timeout_ms: 30000 },
    openai: { endpoint: 'https://api.openai.com/v1', elaboration: 'gpt-5.6-terra', slug: 'gpt-6-luna', thinking: { elaboration: '', slug: '' }, timeout_ms: 60000 },
    general: {
      theme: 'system', ui_font_family: '', auto_preview_idle_seconds: 30, export_dir: '',
      confirm_remove: false, confirm_delete: false, delete_to_trash: true,
      drop_empty_sessions: true, keep_awake_during_work: true, show_status_icon: true,
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

function renderOn(platform: string): void {
  Object.assign(window, { electronAPI: { platform, ...settingsEnvironment } })
  settingsValue = {
    settings: baseConfig(),
    apiKeys: {},
    apiKeyPresence: null,
    saveChangedSettings: vi.fn().mockResolvedValue({}),
    saveBrainstormSettings: vi.fn().mockResolvedValue({}),
    saveImageBackendDefaults: vi.fn().mockResolvedValue({}),
    saveNotificationField: vi.fn().mockResolvedValue({}),
  }
  render(<SettingsModal onClose={() => {}} />)
}

// Tab panels other than the active one are hidden, so queries opt in to them.
const drawThingsHeading = (): HTMLElement | null => screen.queryByRole('heading', { name: 'Draw Things', hidden: true })

afterEach(cleanup)

describe('Settings status icon', () => {
  it('calls it the menu bar icon on macOS', () => {
    renderOn('darwin')
    expect(screen.getByText('Show in menu bar')).not.toBeNull()
    expect(screen.queryByText('Show in notification area')).toBeNull()
  })

  it('calls it the notification area icon on Windows', () => {
    renderOn('win32')
    expect(screen.getByText('Show in notification area')).not.toBeNull()
    expect(screen.queryByText('Show in menu bar')).toBeNull()
  })

  it('offers no status icon setting on another platform', () => {
    renderOn('linux')
    expect(screen.queryByText('Background access')).toBeNull()
    expect(screen.queryByText('Show in menu bar')).toBeNull()
    expect(screen.queryByText('Show in notification area')).toBeNull()
  })
})

describe('Settings Draw Things section', () => {
  it('is present on macOS', () => {
    renderOn('darwin')
    expect(drawThingsHeading()).not.toBeNull()
    expect(screen.getByLabelText('Models Directory')).not.toBeNull()
  })

  it('is absent on Windows', () => {
    renderOn('win32')
    expect(drawThingsHeading()).toBeNull()
    expect(screen.queryByLabelText('Models Directory')).toBeNull()
  })
})
