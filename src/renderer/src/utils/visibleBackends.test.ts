import { afterEach, describe, expect, it, vi } from 'vitest'
import { getVisibleBackends } from './visibleBackends'
import { BACKEND_IDS_IN_UI_ORDER } from '../../../shared/types'

// getVisibleBackends reads window.electronAPI?.platform. The vitest node env has
// no window, so we stub it per-case. Draw Things must only appear on macOS — an
// off-mac column index must never resolve to the hidden backend.
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getVisibleBackends', () => {
  it('shows every backend, including Draw Things, on macOS', () => {
    vi.stubGlobal('window', { electronAPI: { platform: 'darwin' } })
    expect(getVisibleBackends()).toEqual(BACKEND_IDS_IN_UI_ORDER)
    expect(getVisibleBackends()).toContain('drawthings')
  })

  it('hides Draw Things on non-macOS platforms', () => {
    vi.stubGlobal('window', { electronAPI: { platform: 'win32' } })
    expect(getVisibleBackends()).not.toContain('drawthings')
    expect(getVisibleBackends()).toEqual(BACKEND_IDS_IN_UI_ORDER.filter((b) => b !== 'drawthings'))
  })

  it('hides Draw Things when the platform is unknown', () => {
    vi.stubGlobal('window', {})
    expect(getVisibleBackends()).not.toContain('drawthings')
  })
})
