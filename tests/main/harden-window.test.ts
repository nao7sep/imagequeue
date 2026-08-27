import { describe, expect, it, vi } from 'vitest'

import { hardenWindow, isAllowedTopLevelNavigation } from '../../src/main/utils/harden-window'

describe('hardenWindow', () => {
  it('allows only an exact current-URL reload', () => {
    expect(isAllowedTopLevelNavigation('file:///app/index.html', 'file:///app/index.html')).toBe(true)
    expect(isAllowedTopLevelNavigation('file:///tmp/dropped.png', 'file:///app/index.html')).toBe(false)
    expect(isAllowedTopLevelNavigation('https://example.com/', 'file:///app/index.html')).toBe(false)
  })

  it('denies window creation and a dropped same-origin file URL', () => {
    let navigate: ((event: { preventDefault(): void }, url: string) => void) | undefined
    const setWindowOpenHandler = vi.fn()
    const win = {
      webContents: {
        setWindowOpenHandler,
        getURL: () => 'file:///app/index.html',
        on: (_name: string, listener: typeof navigate) => { navigate = listener },
      },
    }
    hardenWindow(win as never)

    expect(setWindowOpenHandler.mock.calls[0][0]({})).toEqual({ action: 'deny' })
    const event = { preventDefault: vi.fn() }
    navigate?.(event, 'file:///tmp/dropped.png')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})
