import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The standalone quit question can be the only window left when Windows logs
// off; its session events must hand quit to OS takeover rather than wait.
const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const windows: unknown[] = []
  class FakeWindow extends EventEmitter {
    destroyed = false
    webContents = new EventEmitter()
    constructor(readonly options: Record<string, unknown>) {
      super()
      windows.push(this)
    }
    isDestroyed(): boolean { return this.destroyed }
    destroy(): void { this.destroyed = true; this.emit('closed') }
    getBounds() { return { x: 0, y: 0, width: 540, height: 240 } }
    setContentSize(): void {}
    center(): void {}
    show(): void {}
    async loadFile(): Promise<void> {}
    async loadURL(): Promise<void> {}
  }
  return { windows, FakeWindow, ipcMain: new EventEmitter() }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.FakeWindow,
  ipcMain: mocks.ipcMain,
  screen: {
    getPrimaryDisplay: () => ({ workArea: { width: 1440, height: 900 } }),
    getDisplayMatching: () => ({ workArea: { width: 1440, height: 900 } }),
  },
}))
vi.mock('../../src/main/i18n', () => ({ mainTranslator: () => ({ t: (key: string) => key }) }))
vi.mock('../../src/main/theme', () => ({ trackThemedWindow: vi.fn(), windowBackground: () => '#ffffff' }))
vi.mock('../../src/main/utils/harden-window', () => ({ hardenWindow: vi.fn() }))

const { showQuitFailure } = await import('../../src/main/quit-failure-window')
type FakeWindow = InstanceType<typeof mocks.FakeWindow>
const lastWindow = (): FakeWindow => mocks.windows.at(-1) as FakeWindow

beforeEach(() => { mocks.windows.length = 0 })
afterEach(() => { mocks.ipcMain.removeAllListeners() })

describe('quit failure question', () => {
  it.each(['query-session-end', 'session-end'])('hands %s to OS takeover without vetoing it', (event) => {
    const onSessionEnd = vi.fn()
    void showQuitFailure(new AbortController().signal, onSessionEnd)
    const preventDefault = vi.fn()
    lastWindow().emit(event, { preventDefault })
    expect(onSessionEnd).toHaveBeenCalledOnce()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('takeover aborting the question closes it without choosing an action', async () => {
    const controller = new AbortController()
    const choice = showQuitFailure(controller.signal, vi.fn())
    controller.abort()
    await expect(choice).resolves.toBe('cancel')
    expect(lastWindow().isDestroyed()).toBe(true)
    expect(mocks.ipcMain.listenerCount('quit:choice')).toBe(0)
  })

  it('accepts a choice only from its own page', async () => {
    const choice = showQuitFailure(new AbortController().signal, vi.fn())
    mocks.ipcMain.emit('quit:choice', { sender: {} }, 'quit')
    mocks.ipcMain.emit('quit:choice', { sender: lastWindow().webContents }, 'retry')
    await expect(choice).resolves.toBe('retry')
  })
})
