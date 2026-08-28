import { describe, expect, it, vi } from 'vitest'

import { hardenWindow } from '../../src/main/utils/harden-window'

describe('hardenWindow', () => {
  it('denies window creation and every renderer-initiated top-level navigation', () => {
    let navigate: ((event: { preventDefault(): void }) => void) | undefined
    const setWindowOpenHandler = vi.fn()
    const win = {
      webContents: {
        setWindowOpenHandler,
        on: (_name: string, listener: typeof navigate) => { navigate = listener },
      },
    }
    hardenWindow(win as never)

    expect(setWindowOpenHandler.mock.calls[0][0]({})).toEqual({ action: 'deny' })
    const event = { preventDefault: vi.fn() }
    navigate?.(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})
