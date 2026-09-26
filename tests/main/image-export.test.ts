import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../src/main/config/types'

// Getting a generated image out of the session folder. Real directories, real
// copies: an export that reports a path the user can open has to have put a
// file there, and a second export of the same image must not overwrite the
// first. Only Electron's dialogs and the session location are substituted.
type Handler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  config: { general: { export_dir: '' } } as AppConfig,
  sessionDir: '',
  desktop: '',
  owner: null as unknown,
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showItemInFolder: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => mocks.desktop) },
  BrowserWindow: { fromWebContents: vi.fn(() => mocks.owner) },
  ClipboardItem: class {},
  clipboard: { readText: vi.fn(async () => ''), write: vi.fn() },
  dialog: { showOpenDialog: mocks.showOpenDialog, showSaveDialog: mocks.showSaveDialog },
  nativeImage: { createFromBuffer: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: mocks.showItemInFolder },
}))
vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../src/main/config', () => ({ loadConfig: () => mocks.config, saveConfig: vi.fn() }))
vi.mock('../../src/main/settings-changes', () => ({ applyChangedFields: vi.fn() }))
vi.mock('../../src/main/session', () => ({ getSessionDir: () => mocks.sessionDir }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => ({ error }) }))

const { registerSettingsIpc } = await import('../../src/main/settings-ipc')

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`${channel} was not registered`)
  return handler({ sender: {} }, ...args)
}

let root: string

beforeEach(() => {
  vi.clearAllMocks()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-export-'))
  mocks.sessionDir = path.join(root, 'session')
  mocks.desktop = path.join(root, 'Desktop')
  fs.mkdirSync(mocks.sessionDir, { recursive: true })
  fs.mkdirSync(mocks.desktop, { recursive: true })
  fs.writeFileSync(path.join(mocks.sessionDir, '20260101-000000-utc-cat-openai.png'), 'image bytes')
  mocks.config = { general: { export_dir: '' } } as AppConfig
  mocks.owner = null
  mocks.handlers.clear()
  registerSettingsIpc()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const BASE = '20260101-000000-utc-cat-openai'

describe('exporting an image', () => {
  it('copies it to the configured folder, creating it if need be', async () => {
    mocks.config.general.export_dir = path.join(root, 'Exports', 'imagequeue')

    const destination = (await invoke('shell:exportImage', BASE, 'png')) as string

    expect(destination).toBe(path.join(root, 'Exports', 'imagequeue', `${BASE}.png`))
    expect(fs.readFileSync(destination, 'utf-8')).toBe('image bytes')
    expect(fs.existsSync(path.join(mocks.sessionDir, `${BASE}.png`)), 'the session keeps its copy').toBe(true)
  })

  it('falls back to the Desktop when no folder is configured', async () => {
    const destination = (await invoke('shell:exportImage', BASE, 'png')) as string

    expect(destination).toBe(path.join(mocks.desktop, `${BASE}.png`))
  })

  it('numbers a second and third export instead of overwriting the first', async () => {
    const first = (await invoke('shell:exportImage', BASE, 'png')) as string
    fs.writeFileSync(path.join(mocks.sessionDir, `${BASE}.png`), 'second version')

    const second = (await invoke('shell:exportImage', BASE, 'png')) as string
    const third = (await invoke('shell:exportImage', BASE, 'png')) as string

    expect([path.basename(second), path.basename(third)]).toEqual([`${BASE}-2.png`, `${BASE}-3.png`])
    expect(fs.readFileSync(first, 'utf-8'), 'the earlier export is untouched').toBe('image bytes')
    expect(fs.readFileSync(second, 'utf-8')).toBe('second version')
  })

  it.each([
    ['a name that climbs out of the session folder', '../../etc/passwd', 'png'],
    ['a name with a separator', 'sub/cat', 'png'],
    ['an extension that is not an image', BASE, 'exe'],
  ])('refuses %s', async (_case, base, ext) => {
    await expect(invoke('shell:exportImage', base, ext)).rejects.toThrow()
    expect(fs.readdirSync(mocks.desktop)).toEqual([])
  })
})

describe('exporting an image to a chosen place', () => {
  it('copies it where the user said, making the folder if it is new', async () => {
    const chosen = path.join(root, 'Chosen', 'cat.png')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: chosen })

    await expect(invoke('shell:exportImageAs', BASE, 'png')).resolves.toBe(chosen)

    expect(fs.readFileSync(chosen, 'utf-8')).toBe('image bytes')
  })

  it('offers only the image’s own format, since the export is a byte copy', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    await invoke('shell:exportImageAs', BASE, 'png')

    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: 'PNG image', extensions: ['png'] }] }),
    )
  })

  it('never writes the image under another format’s extension', async () => {
    const typed = path.join(root, 'poster.jpg')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: typed })

    await expect(invoke('shell:exportImageAs', BASE, 'png')).resolves.toBe(`${typed}.png`)

    expect(fs.existsSync(typed)).toBe(false)
    expect(fs.readFileSync(`${typed}.png`, 'utf-8')).toBe('image bytes')
  })

  it('offers the configured folder and the image’s own name', async () => {
    mocks.config.general.export_dir = path.join(root, 'Exports')
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    await invoke('shell:exportImageAs', BASE, 'png')

    expect(mocks.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: path.join(root, 'Exports', `${BASE}.png`) }),
    )
  })

  it('writes nothing when the user backs out', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: path.join(root, 'cat.png') })

    await expect(invoke('shell:exportImageAs', BASE, 'png')).resolves.toBeNull()

    expect(fs.existsSync(path.join(root, 'cat.png'))).toBe(false)
  })

  it('asks the window that owns the request when there is one', async () => {
    mocks.owner = { id: 1 }
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    await invoke('shell:exportImageAs', BASE, 'png')

    expect(mocks.showSaveDialog).toHaveBeenCalledWith(mocks.owner, expect.anything())
  })
})

describe('revealing an image', () => {
  it('points the file manager at the image in the session folder', () => {
    invoke('shell:revealFile', BASE, 'png')

    expect(mocks.showItemInFolder).toHaveBeenCalledExactlyOnceWith(path.join(mocks.sessionDir, `${BASE}.png`))
  })

  it('refuses a name that is not a plain image basename', () => {
    expect(() => invoke('shell:revealFile', '../secret', 'png')).toThrow()
    expect(mocks.showItemInFolder).not.toHaveBeenCalled()
  })
})

describe('picking a file or a folder', () => {
  it('hands back the chosen file, and null when the user backs out', async () => {
    const filters = [{ name: 'Models', extensions: ['ckpt'] }]
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/downloads/model.ckpt'] })
    await expect(invoke('dialog:openFile', filters)).resolves.toBe('/downloads/model.ckpt')
    expect(mocks.showOpenDialog).toHaveBeenCalledWith({ properties: ['openFile'], filters })

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(invoke('dialog:openFile', filters)).resolves.toBeNull()
  })

  it('hands back the chosen folder, and lets the user make a new one', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/pictures/exports'] })

    await expect(invoke('dialog:openDirectory')).resolves.toBe('/pictures/exports')
    expect(mocks.showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory', 'createDirectory'] })
  })

  it('asks the window that owns the request when there is one', async () => {
    mocks.owner = { id: 2 }
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    await invoke('dialog:openDirectory')

    expect(mocks.showOpenDialog).toHaveBeenCalledWith(mocks.owner, expect.anything())
  })
})
