// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider, useSettings } from '../../../../src/renderer/src/context/SettingsContext'
import { UiStateProvider, useUiState } from '../../../../src/renderer/src/context/UiStateContext'
import type { SettingsCredentials } from '../../../../src/shared/types'
import { defaultUiState, type UiState } from '../../../../src/shared/ui-state'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((fulfill, fail) => { resolve = fulfill; reject = fail })
  return { promise, resolve, reject }
}

const settingsSnapshot = { theme: 'dark', language: 'ja', startupMarker: 'saved settings' }
const credentialsSnapshot: SettingsCredentials = {
  presence: { image: { openai: true, nanobanana: false, grok: true, flux: false }, geminiText: true, openaiText: false },
  keys: { 'gemini.text': 'stored-gemini', 'openai.text': '', 'openai.image': 'stored-openai', 'gemini.nanobanana': '', xai: 'stored-xai', bfl: '' },
}
const uiSnapshot: UiState = { ...defaultUiState(), columnWidth: 420, recordsListWidth: 360 }

function SettingsChild(): React.JSX.Element {
  const { settings, apiKeyPresence, apiKeys } = useSettings()
  return <button aria-label="Startup child">{JSON.stringify({ settings, apiKeyPresence, apiKeys })}</button>
}

function UiStateChild(): React.JSX.Element {
  const { uiState } = useUiState()
  return <button aria-label="Startup child">{JSON.stringify(uiState)}</button>
}

function expectChildAbsent(): void {
  expect(screen.queryByRole('button', { name: 'Startup child' })).toBeNull()
}

function expectSettingsSnapshot(): void {
  expect(JSON.parse(screen.getByRole('button', { name: 'Startup child' }).textContent!)).toEqual({
    settings: settingsSnapshot, apiKeyPresence: credentialsSnapshot.presence, apiKeys: credentialsSnapshot.keys,
  })
}

function startupError(): Error {
  return Object.assign(new TypeError('EACCES /private/startup-store HYDRATION_DIAGNOSTIC'), {
    code: 'EACCES', cause: new Error('original read failure'),
  })
}

function expectDiagnostic(appLog: ReturnType<typeof vi.fn>, operation: string, error: Error): void {
  expect(appLog).toHaveBeenCalledExactlyOnceWith('error', operation, {
    error: expect.objectContaining({
      name: 'TypeError', message: error.message, code: 'EACCES', stack: error.stack,
      cause: expect.objectContaining({ name: 'Error', message: 'original read failure' }),
    }),
  })
  expect(document.body.textContent).not.toContain('HYDRATION_DIAGNOSTIC')
  expect(document.body.textContent).not.toContain('/private/startup-store')
  expect(document.body.textContent).not.toContain('EACCES')
  expect(document.body.textContent).not.toContain('TypeError')
}

let originalApi: typeof window.electronAPI
beforeEach(() => { originalApi = window.electronAPI })
afterEach(() => { cleanup(); window.electronAPI = originalApi })

describe('required settings startup gate', () => {
  it.each(['settings', 'credentials'] as const)('waits for %s after the other required read fulfills', async (pending) => {
    const settings = deferred<Record<string, unknown>>()
    const credentials = deferred<SettingsCredentials>()
    window.electronAPI = {
      getSettings: vi.fn(() => settings.promise), getCredentials: vi.fn(() => credentials.promise),
      getBackendParams: vi.fn(async () => ({})),
      onSettingsChanged: vi.fn(() => () => {}),
    } as unknown as typeof window.electronAPI
    render(<SettingsProvider><SettingsChild /></SettingsProvider>)
    expectChildAbsent()

    await act(async () => {
      if (pending === 'settings') credentials.resolve(credentialsSnapshot)
      else settings.resolve(settingsSnapshot)
    })
    expectChildAbsent()
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => {
      if (pending === 'settings') settings.resolve(settingsSnapshot)
      else credentials.resolve(credentialsSnapshot)
    })
    expectSettingsSnapshot()
  })

  it.each(['settings', 'credentials'] as const)('keeps the child gated after %s rejects, retries, and ignores the old pending response', async (failedSource) => {
    const initialSettings = deferred<Record<string, unknown>>()
    const initialCredentials = deferred<SettingsCredentials>()
    const retrySettings = deferred<Record<string, unknown>>()
    const retryCredentials = deferred<SettingsCredentials>()
    const getSettings = vi.fn().mockReturnValueOnce(initialSettings.promise).mockReturnValueOnce(retrySettings.promise)
    const getCredentials = vi.fn().mockReturnValueOnce(initialCredentials.promise).mockReturnValueOnce(retryCredentials.promise)
    const appLog = vi.fn().mockResolvedValue(undefined)
    window.electronAPI = { getSettings, getCredentials, getBackendParams: vi.fn(async () => ({})), appLog, onSettingsChanged: vi.fn(() => () => {}) } as unknown as typeof window.electronAPI
    render(<SettingsProvider><SettingsChild /></SettingsProvider>)
    expectChildAbsent()

    const error = startupError()
    await act(async () => {
      if (failedSource === 'settings') initialSettings.reject(error)
      else initialCredentials.reject(error)
    })
    expect(screen.getByRole('dialog', { name: 'Settings could not be loaded' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Required settings could not be loaded. Nothing was changed; try again.')
    expectChildAbsent()
    expectDiagnostic(appLog, 'Failed to hydrate required settings', error)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(getCredentials).toHaveBeenCalledTimes(2)
    expectChildAbsent()
    await act(async () => { retrySettings.resolve(settingsSnapshot) })
    expectChildAbsent()
    await act(async () => { retryCredentials.resolve(credentialsSnapshot) })
    expectSettingsSnapshot()
    expect(screen.queryByRole('dialog')).toBeNull()

    // The other initial read outlives Promise.all's rejection and the retry.
    await act(async () => {
      if (failedSource === 'settings') {
        initialCredentials.resolve({ ...credentialsSnapshot, presence: { ...credentialsSnapshot.presence, geminiText: false }, keys: { ...credentialsSnapshot.keys, 'gemini.text': 'obsolete' } })
      } else initialSettings.resolve({ theme: 'light', startupMarker: 'obsolete' })
    })
    expectSettingsSnapshot()
    expect(appLog).toHaveBeenCalledTimes(1)
  })
})

describe('required window preferences startup gate', () => {
  it('withholds the child until the stored UI state fulfills', async () => {
    const initial = deferred<UiState>()
    window.electronAPI = { getUiState: vi.fn(() => initial.promise) } as unknown as typeof window.electronAPI
    render(<UiStateProvider><UiStateChild /></UiStateProvider>)
    expectChildAbsent()
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => { initial.resolve(uiSnapshot) })
    expect(JSON.parse(screen.getByRole('button', { name: 'Startup child' }).textContent!)).toEqual(uiSnapshot)
  })

  it('presents a logged failure with Retry and keeps the child gated until the retry fulfills', async () => {
    const initial = deferred<UiState>()
    const retry = deferred<UiState>()
    const getUiState = vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(retry.promise)
    const appLog = vi.fn().mockResolvedValue(undefined)
    window.electronAPI = { getUiState, appLog } as unknown as typeof window.electronAPI
    render(<UiStateProvider><UiStateChild /></UiStateProvider>)
    expectChildAbsent()

    const error = startupError()
    await act(async () => { initial.reject(error) })
    expect(screen.getByRole('dialog', { name: 'Window preferences could not be loaded' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Window preferences could not be loaded. Nothing was changed; try again.')
    expectChildAbsent()
    expectDiagnostic(appLog, 'Failed to load UI state', error)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(getUiState).toHaveBeenCalledTimes(2)
    expectChildAbsent()
    await act(async () => { retry.resolve(uiSnapshot) })
    expect(JSON.parse(screen.getByRole('button', { name: 'Startup child' }).textContent!)).toEqual(uiSnapshot)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(appLog).toHaveBeenCalledTimes(1)
  })
})
