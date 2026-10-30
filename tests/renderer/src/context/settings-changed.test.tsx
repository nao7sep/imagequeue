// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider, useSettings } from '../../../../src/renderer/src/context/SettingsContext'
import { until } from '../../until'

// Closing the preview window turns its setting off in the main process, which
// tells the main window; its settings are read again so Settings shows it off.

function Probe(): React.JSX.Element {
  const { settings } = useSettings()
  const on = (settings?.general as { show_preview_window?: boolean } | undefined)?.show_preview_window
  return <p>{on === undefined ? 'loading' : on ? 'on' : 'off'}</p>
}

afterEach(cleanup)

describe('settings changed by the main process', () => {
  it('reads the settings again when the main process says they changed', async () => {
    let changed: () => void = () => {}
    let stored = true
    window.electronAPI = {
      getSettings: vi.fn(async () => ({ general: { show_preview_window: stored } })),
      getCredentials: vi.fn(async () => ({ presence: {}, keys: {} })),
      getImageBackendDefaults: vi.fn(async () => ({})),
      onSettingsChanged: vi.fn((callback: () => void) => { changed = callback; return () => {} }),
      appLog: vi.fn(async () => undefined),
    } as unknown as typeof window.electronAPI
    render(<SettingsProvider><Probe /></SettingsProvider>)
    expect(await until(() => screen.getByText('on'))).toBeTruthy()

    stored = false
    act(() => changed())
    await until(() => expect(screen.getByText('off')).toBeTruthy())
  })
})
