// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { SecretId } from '../../../../src/shared/types'

// API keys are stored outside config.json, so they are outside the settings
// payload too: the form stages them separately and saves them on their own
// channel. These pin that wiring — the form is the only surface that edits a
// key, and a key it never touched must not be rewritten.

let settingsValue: {
  settings: Record<string, unknown> | null
  apiKeys: Record<string, string> | null
  apiKeyPresence: unknown
  saveChangedSettings: ReturnType<typeof vi.fn>
  saveApiKeys: ReturnType<typeof vi.fn>
  saveBrainstormSettings: ReturnType<typeof vi.fn>
  saveImageBackendDefaults: ReturnType<typeof vi.fn>
  saveNotificationField: ReturnType<typeof vi.fn>
}

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

const storedKeys = (): Record<SecretId, string> => ({
  'gemini.text': 'gemini-text-stored',
  'openai.text': '',
  'openai.image': 'openai-image-stored',
  'gemini.nanobanana': '',
  xai: 'xai-stored',
  bfl: '',
})

function baseConfig(): Record<string, unknown> {
  const backend = (): Record<string, unknown> => ({
    model: 'm',
    default_params: {},
    concurrency: 3,
    timeout_ms: 180000,
  })
  return {
    text_ai: {
      backend: 'gemini',
      gemini: { timeout_ms: 30000, main_model: 'gemini-3.7-flash', light_model: 'gemini-3.5-flash-lite' },
      openai: { endpoint: '', timeout_ms: 60000, main_model: 'm', light_model: 'l' },
    },
    general: {
      ui_font_family: '', auto_preview_idle_seconds: 30, export_dir: '',
      confirm_remove: false, confirm_delete: false, delete_to_trash: true,
      drop_empty_sessions: true, keep_awake_during_work: true, show_status_icon: true,
    },
    notifications: {
      notifications_enabled: true, sounds_enabled: true,
      success_file: '', failure_file: '',
    },
    image_backends: {
      openai: backend(), nanobanana: backend(), grok: backend(), flux: backend(),
      drawthings: { timeout_ms: 1800000, default_params: {}, models_dir: '', check_updates_at_launch: true },
    },
    prompts: { slug: 'slug' },
    brainstorm: {},
  }
}

beforeEach(() => {
  // The form reads the platform to decide whether to draw the Draw Things
  // section; nothing else here touches the bridge.
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = { platform: 'darwin' }
  settingsValue = {
    settings: baseConfig(),
    apiKeys: storedKeys(),
    apiKeyPresence: null,
    saveChangedSettings: vi.fn().mockResolvedValue({}),
    saveApiKeys: vi.fn().mockResolvedValue({}),
    saveBrainstormSettings: vi.fn().mockResolvedValue({}),
    saveImageBackendDefaults: vi.fn().mockResolvedValue({}),
    saveNotificationField: vi.fn().mockResolvedValue({}),
  }
})
afterEach(cleanup)

/** The Text AI tab's Gemini key field — the first password input on that tab. */
function keyFields(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
}

describe('Settings edits API keys by key id, not through the config payload', () => {
  it('shows the stored value of every key', () => {
    render(<SettingsModal onClose={() => {}} />)
    const values = keyFields().map((f) => f.value)
    // Six key fields: two Text AI, four cloud image backends.
    expect(values).toHaveLength(6)
    expect(values).toContain('gemini-text-stored')
    expect(values).toContain('openai-image-stored')
    expect(values).toContain('xai-stored')
  })

  it('sends only the keys the user actually changed', async () => {
    render(<SettingsModal onClose={() => {}} />)
    const gemini = keyFields().find((f) => f.value === 'gemini-text-stored')!
    fireEvent.change(gemini, { target: { value: 'gemini-text-EDITED' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(settingsValue.saveApiKeys).toHaveBeenCalledTimes(1))
    // Exactly one id — an untouched key must never be rewritten, least of all
    // one whose stored value is empty because it comes from the environment.
    expect(settingsValue.saveApiKeys.mock.calls[0][0]).toEqual({
      'gemini.text': 'gemini-text-EDITED',
    })
  })

  it('carries a cleared key through as an empty value rather than dropping it', async () => {
    render(<SettingsModal onClose={() => {}} />)
    const xai = keyFields().find((f) => f.value === 'xai-stored')!
    fireEvent.change(xai, { target: { value: '' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(settingsValue.saveApiKeys).toHaveBeenCalledTimes(1))
    // Blank is a real instruction ("delete this key"), so it must reach the
    // store. Omitting it would silently leave the old key in place.
    expect(settingsValue.saveApiKeys.mock.calls[0][0]).toEqual({ xai: '' })
  })

  it('does not touch the key store when only an ordinary setting changed', async () => {
    render(<SettingsModal onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'General' }))
    fireEvent.click(screen.getByText('Confirm remove'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(settingsValue.saveChangedSettings).toHaveBeenCalledTimes(1))
    expect(settingsValue.saveApiKeys).not.toHaveBeenCalled()
  })

  it('enables Save on a key edit alone', () => {
    render(<SettingsModal onClose={() => {}} />)
    expect(saveButton().disabled).toBe(true)
    const gemini = keyFields().find((f) => f.value === 'gemini-text-stored')!
    fireEvent.change(gemini, { target: { value: 'changed' } })
    expect(saveButton().disabled).toBe(false)
  })
})

describe('Settings status icon preference', () => {
  it('uses the macOS label and stages the preference with General settings', async () => {
    render(<SettingsModal onClose={() => {}} />)
    fireEvent.click(screen.getByText('Show in menu bar'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(settingsValue.saveChangedSettings).toHaveBeenCalledOnce())
    const next = settingsValue.saveChangedSettings.mock.calls[0][1] as Record<string, Record<string, unknown>>
    expect(next.general.show_status_icon).toBe(false)
  })

  it('uses the Windows notification-area label', () => {
    ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = { platform: 'win32' }
    render(<SettingsModal onClose={() => {}} />)
    expect(screen.getByText('Show in notification area')).toBeTruthy()
  })
})

describe('Settings save result', () => {
  it('keeps a failed save in the scrolling body without displacing footer actions', async () => {
    settingsValue.saveChangedSettings.mockRejectedValueOnce(new Error('settings disk unavailable'))
    render(<SettingsModal onClose={() => {}} />)
    fireEvent.click(screen.getByText('Confirm remove'))
    fireEvent.click(saveButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('settings disk unavailable')
    expect(alert.closest('.settings-overlay')).toBeTruthy()
    const footer = document.querySelector('.modal-footer')
    expect(footer).toBeTruthy()
    expect(footer?.querySelector('[role="alert"]') ?? null).toBeNull()
    expect(Array.from(footer?.querySelectorAll('button') ?? []).map((button) => button.textContent)).toEqual([
      'Cancel',
      'Save',
    ])
  })
})
