import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuitQuestion } from '../../src/shared/quit'

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
    isVisible(): boolean { return true }
    isMinimized(): boolean { return false }
    destroy(): void { this.destroyed = true; this.emit('closed') }
    getBounds() { return { x: 0, y: 0, width: 540, height: 240 } }
    setContentSize(): void {}
    center(): void {}
    show(): void {}
    async loadFile(): Promise<void> {}
    async loadURL(): Promise<void> {}
  }
  return { windows, FakeWindow, ipcMain: new EventEmitter(), handlers: new Map<string, (event: { sender: unknown }) => unknown>() }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.FakeWindow,
  ipcMain: Object.assign(mocks.ipcMain, { handle: (channel: string, handler: (event: { sender: unknown }) => unknown) => { mocks.handlers.set(channel, handler) } }),
  screen: {
    getPrimaryDisplay: () => ({ workArea: { width: 1440, height: 900 } }),
    getDisplayMatching: () => ({ workArea: { width: 1440, height: 900 } }),
  },
}))
vi.mock('../../src/main/i18n', () => ({ onLanguageChanged: () => () => {}, mainTranslator: () => ({ t: (key: string) => key }) }))
vi.mock('../../src/main/theme', () => ({ trackThemedWindow: vi.fn(), windowBackground: () => '#ffffff' }))
vi.mock('../../src/main/utils/harden-window', () => ({ hardenWindow: vi.fn() }))

const { showQuitQuestion } = await import('../../src/main/quit-failure-window')
const saveFailed = { kind: 'saveFailed' } as const
type FakeWindow = InstanceType<typeof mocks.FakeWindow>
const lastWindow = (): FakeWindow => mocks.windows.at(-1) as FakeWindow

beforeEach(() => { mocks.windows.length = 0 })
afterEach(() => { mocks.ipcMain.removeAllListeners() })

describe('quit failure question', () => {
  it.each(['query-session-end', 'session-end'])('hands %s to OS takeover without vetoing it', (event) => {
    const onSessionEnd = vi.fn()
    void showQuitQuestion(saveFailed, new AbortController().signal, onSessionEnd)
    const preventDefault = vi.fn()
    lastWindow().emit(event, { preventDefault })
    expect(onSessionEnd).toHaveBeenCalledOnce()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('takeover aborting the question closes it without choosing an action', async () => {
    const controller = new AbortController()
    const choice = showQuitQuestion(saveFailed, controller.signal, vi.fn())
    controller.abort()
    await expect(choice).resolves.toBe('cancel')
    expect(lastWindow().isDestroyed()).toBe(true)
    expect(mocks.ipcMain.listenerCount('quit:choice')).toBe(0)
  })

  it('accepts a choice only from its own page', async () => {
    const choice = showQuitQuestion(saveFailed, new AbortController().signal, vi.fn())
    mocks.ipcMain.emit('quit:choice', { sender: {} }, 'quit')
    mocks.ipcMain.emit('quit:choice', { sender: lastWindow().webContents }, 'retry')
    await expect(choice).resolves.toBe('retry')
  })
})

describe('quit confirmation', () => {
  const confirm: QuitQuestion = { kind: 'confirm', work: { generating: 2, elaborating: false, tools: false, drafts: [] }, platform: 'darwin' }

  it('accepts only Quit or Cancel, and hands its page the question it asks', async () => {
    const choice = showQuitQuestion(confirm, new AbortController().signal, vi.fn())
    const page = lastWindow().webContents
    expect(mocks.handlers.get('quit:question')!({ sender: page })).toEqual(confirm)
    expect(mocks.handlers.get('quit:question')!({ sender: {} })).toBeNull()
    expect(lastWindow().options['title']).toBe('statusIcon.quit')
    mocks.ipcMain.emit('quit:choice', { sender: page }, 'retry')
    mocks.ipcMain.emit('quit:choice', { sender: page }, 'quit')
    await expect(choice).resolves.toBe('quit')
  })

  // Background mode: a question never attaches to, or brings back, a hidden window.
  it('stands alone when its would-be owner is hidden, and attaches to a showing one', () => {
    const hidden = Object.assign(new mocks.FakeWindow({}), { isVisible: () => false })
    void showQuitQuestion(confirm, new AbortController().signal, vi.fn(), hidden as unknown as Electron.BrowserWindow)
    expect(lastWindow().options['parent']).toBeUndefined()
    const showing = new mocks.FakeWindow({})
    void showQuitQuestion(confirm, new AbortController().signal, vi.fn(), showing as unknown as Electron.BrowserWindow)
    expect(lastWindow().options['parent']).toBe(showing)
    expect(lastWindow().options['modal']).toBe(true)
  })
})

