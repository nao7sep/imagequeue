import { describe, expect, it, vi } from 'vitest'
import { restoreOrCreateMainWindow } from '../../src/main/main-window-lifecycle'

function makeWindow(options: { destroyed?: boolean; minimized?: boolean } = {}) {
  return {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
}

describe('restoreOrCreateMainWindow', () => {
  it('restores and focuses the existing minimized window', () => {
    const win = makeWindow({ minimized: true })
    const createWindow = vi.fn()

    restoreOrCreateMainWindow(win, true, createWindow)

    expect(win.restore).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('does not create a competing window while startup is incomplete', () => {
    const createWindow = vi.fn()

    restoreOrCreateMainWindow(null, false, createWindow)

    expect(createWindow).not.toHaveBeenCalled()
  })

  it.each([null, makeWindow({ destroyed: true })])(
    'creates a window after startup when no live main window remains',
    (win) => {
      const createWindow = vi.fn()

      restoreOrCreateMainWindow(win, true, createWindow)

      expect(createWindow).toHaveBeenCalledOnce()
    },
  )
})
