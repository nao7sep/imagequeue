// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { until } from '../../until'

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
    prompts: { slug: 'slug' },
    brainstorm: {},
  }
}

function renderWith(theme: unknown, onClose: () => void = () => {}): void {
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
  render(<SettingsModal onClose={onClose} />)
}

function themeRadios(): HTMLInputElement[] {
  return within(screen.getByRole('radiogroup', { name: 'Theme' })).getAllByRole('radio') as HTMLInputElement[]
}

beforeEach(() => {
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = { platform: 'darwin' }
})
afterEach(cleanup)

describe('Settings theme choice', () => {
  it('associates each Settings field label with its actual control', () => {
    renderWith('system')
    for (const label of document.querySelectorAll<HTMLLabelElement>('label')) {
      expect(label.control, `label ${label.textContent} has a control`).not.toBeNull()
    }
    const autoPreview = screen.getByLabelText('Auto-preview (s)')
    expect(autoPreview.tagName).toBe('INPUT')
  })
  it('freezes edits and dismissal until a submitted save settles', async () => {
    const close = vi.fn()
    renderWith('system', close)
    let resolve!: () => void
    const save = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    settingsValue.saveChangedSettings = save
    fireEvent.click(themeRadios()[1]!)
    const saveButton = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)
    expect(save).toHaveBeenCalledTimes(1)
    expect(themeRadios().every((radio) => radio.matches(':disabled'))).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(close).not.toHaveBeenCalled()
    await act(async () => resolve())
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('remains busy through the separate API-key write', async () => {
    const close = vi.fn()
    renderWith('system', close)
    let resolveKeys!: () => void
    settingsValue.saveApiKeys = vi.fn(() => new Promise<void>((done) => { resolveKeys = done }))
    fireEvent.click(screen.getByRole('tab', { name: 'Image Backends' }))
    const keyInput = document.querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'test-key' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(settingsValue.saveApiKeys).toHaveBeenCalledTimes(1)
    expect(keyInput.matches(':disabled')).toBe(true)
    expect(close).not.toHaveBeenCalled()
    await act(async () => resolveKeys())
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps the draft and allows another save after failure', async () => {
    const close = vi.fn()
    renderWith('system', close)
    let reject!: (error: Error) => void
    const save = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
    settingsValue.saveChangedSettings = save
    fireEvent.click(themeRadios()[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await act(async () => reject(new Error('save failed')))
    expect(close).not.toHaveBeenCalled()
    expect(themeRadios().find((radio) => radio.checked)?.value).toBe('light')
    expect(themeRadios().every((radio) => !radio.matches(':disabled'))).toBe(true)
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

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
    await until(() => expect(save).toHaveBeenCalledTimes(1))
    expect((save.mock.calls[0]![1] as { general: { theme: string } }).general.theme).toBe('light')
  })
})

it('offers a default-on launch preference and clear manual release outcomes inside Settings', async () => {
  window.electronAPI.checkAppRelease = vi.fn(async () => ({ kind: 'newer' as const, version: 'v1.2.0' }))
  window.electronAPI.viewAppRelease = vi.fn(async () => undefined)
  renderWith('system')
  expect((screen.getByLabelText('Check GitHub for new releases at launch') as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Check GitHub for a New Release' }))
  await until(() => expect(screen.getByText('ImageQueue v1.2.0 is available.')).toBeTruthy())
  expect(window.electronAPI.viewAppRelease).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'View Release on GitHub' }))
  expect(window.electronAPI.viewAppRelease).toHaveBeenCalledOnce()
})
