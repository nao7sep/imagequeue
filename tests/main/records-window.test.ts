import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECORDS_WINDOW_MIN_HEIGHT, RECORDS_WINDOW_MIN_WIDTH } from '../../src/shared/records-layout'

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const state = {
    windows: [] as unknown[],
    loadError: null as Error | null,
    recovered: vi.fn(),
    minimum: vi.fn(),
  }
  class FakeWindow extends EventEmitter {
    options: Record<string, unknown>
    destroyed = false
    minimized = false
    shown = 0
    focused = 0
    restored = 0
    sent: string[] = []
    loaded: unknown[] = []
    webContents = Object.assign(new EventEmitter(), {
      send: (channel: string) => { this.sent.push(channel) },
      setWindowOpenHandler: vi.fn(),
      replaceMisspelling: vi.fn(),
    })
    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      state.windows.push(this)
    }
    isDestroyed(): boolean { return this.destroyed }
    isMinimized(): boolean { return this.minimized }
    restore(): void { this.restored++ }
    show(): void { this.shown++ }
    focus(): void { this.focused++ }
    destroy(): void {
      this.destroyed = true
      this.emit('closed')
    }
    async loadURL(url: string): Promise<void> {
      this.loaded.push(url)
      if (state.loadError) throw state.loadError
    }
    async loadFile(file: string, options: unknown): Promise<void> {
      this.loaded.push([file, options])
      if (state.loadError) throw state.loadError
    }
  }
  return Object.assign(state, { FakeWindow })
})

type FakeWindow = InstanceType<typeof mocks.FakeWindow>

vi.mock('electron', () => ({ BrowserWindow: mocks.FakeWindow, Menu: { buildFromTemplate: vi.fn() } }))
vi.mock('../../src/main/i18n', () => ({ mainTranslator: () => ({ t: (key: string) => (key === 'records.title' ? 'Records' : key) }) }))
vi.mock('../../src/main/theme', () => ({ trackThemedWindow: vi.fn(), windowBackground: () => '#e9eef7' }))
vi.mock('../../src/main/window-minimum', () => ({ configureWindowMinimum: mocks.minimum }))
vi.mock('../../src/main/window-state-recovery', () => ({
  createWindowWithUsablePersistedBounds: (name: string, create: () => unknown) => {
    mocks.recovered(name)
    return create()
  },
}))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => error }))

import {
  RECORDS_CHANGED_CHANNEL,
  buildRecordsWindowOptions,
  closeRecordsWindow,
  notifyRecordsChanged,
  openRecordsWindow,
} from '../../src/main/records-window'

const opened = (): FakeWindow[] => mocks.windows as FakeWindow[]

beforeEach(() => {
  mocks.windows.length = 0
  mocks.loadError = null
  mocks.recovered.mockClear()
  mocks.minimum.mockClear()
  vi.stubEnv('ELECTRON_RENDERER_URL', undefined)
})

afterEach(() => {
  closeRecordsWindow()
  vi.unstubAllEnvs()
})

describe('records window options', () => {
  it('is a durable window with its own placement, the derived minimum, and no Spaces fullscreen', () => {
    const options = buildRecordsWindowOptions('Records')
    expect(options).toMatchObject({
      name: 'records',
      title: 'Records',
      windowStatePersistence: { bounds: true, displayMode: process.platform === 'win32' },
      minWidth: RECORDS_WINDOW_MIN_WIDTH,
      minHeight: RECORDS_WINDOW_MIN_HEIGHT,
      fullscreenable: false,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    expect(options.width).toBeGreaterThanOrEqual(RECORDS_WINDOW_MIN_WIDTH)
    expect(options.height).toBeGreaterThanOrEqual(RECORDS_WINDOW_MIN_HEIGHT)
  })
})

describe('openRecordsWindow', () => {
  it('opens one window, recovered from unusable placement, on the records surface, shown once ready', async () => {
    await openRecordsWindow()
    const [win] = opened()
    expect(opened()).toHaveLength(1)
    expect(mocks.recovered).toHaveBeenCalledWith('records')
    expect(mocks.minimum).toHaveBeenCalledOnce()
    expect(win!.options).toMatchObject({ name: 'records', title: 'Records', backgroundColor: '#e9eef7' })
    expect(win!.loaded).toEqual([[expect.stringMatching(/renderer[/\\]index\.html$/), { query: { surface: 'records' } }]])
    expect(win!.shown).toBe(0)
    win!.emit('ready-to-show')
    expect(win!.shown).toBe(1)
  })

  it('loads the development renderer with the records surface', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:20641')
    await openRecordsWindow()
    expect(opened()[0]!.loaded).toEqual(['http://127.0.0.1:20641/?surface=records'])
  })

  it('brings the open window forward instead of opening another', async () => {
    await openRecordsWindow()
    const [win] = opened()
    win!.minimized = true
    await openRecordsWindow()
    expect(opened()).toHaveLength(1)
    expect(win!.restored).toBe(1)
    expect(win!.shown).toBe(1)
    expect(win!.focused).toBe(1)
  })

  it('opens a new window once the last one has closed', async () => {
    await openRecordsWindow()
    opened()[0]!.destroy()
    await openRecordsWindow()
    expect(opened()).toHaveLength(2)
  })

  it('removes a window whose page could not load, and reports the failure', async () => {
    mocks.loadError = new Error('ERR_FILE_NOT_FOUND')
    await expect(openRecordsWindow()).rejects.toThrow('ERR_FILE_NOT_FOUND')
    expect(opened()[0]!.destroyed).toBe(true)
    mocks.loadError = null
    await openRecordsWindow()
    expect(opened()).toHaveLength(2)
  })
})

describe('notifyRecordsChanged', () => {
  it('tells only an open window that a record was stored', async () => {
    notifyRecordsChanged()
    await openRecordsWindow()
    notifyRecordsChanged()
    expect(opened()[0]!.sent).toEqual([RECORDS_CHANGED_CHANNEL])
    closeRecordsWindow()
    notifyRecordsChanged()
    expect(opened()[0]!.sent).toEqual([RECORDS_CHANGED_CHANNEL])
  })
})
