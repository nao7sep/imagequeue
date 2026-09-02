import { describe, expect, it, vi } from 'vitest'
import { loadMainWindowContent, ownMainWindowContentLoad } from '../../src/main/main-window-content'

describe('main window content load', () => {
  it('returns the production loadFile rejection with its hostile cause intact', async () => {
    const hostile = new Error('EACCES /private/tmp/IMAGEQUEUE_RENDERER_LOAD_SENTINEL')
    const win = {
      loadURL: vi.fn(async () => undefined),
      loadFile: vi.fn(async () => { throw hostile }),
    }

    await expect(loadMainWindowContent(win, undefined, '/app/renderer/index.html')).rejects.toBe(hostile)
    expect(win.loadFile).toHaveBeenCalledWith('/app/renderer/index.html')
    expect(win.loadURL).not.toHaveBeenCalled()
  })

  it('returns the development loadURL rejection instead of erasing it', async () => {
    const hostile = new Error('ERR_CONNECTION_REFUSED IMAGEQUEUE_DEV_LOAD_SENTINEL')
    const win = {
      loadURL: vi.fn(async () => { throw hostile }),
      loadFile: vi.fn(async () => undefined),
    }

    await expect(loadMainWindowContent(win, 'http://127.0.0.1:5173', '/unused')).rejects.toBe(hostile)
    expect(win.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173')
    expect(win.loadFile).not.toHaveBeenCalled()
  })
})

describe('main window content ownership', () => {
  it('hands the original navigation cause to the startup failure owner', async () => {
    const hostile = new Error('EACCES /private/tmp/IMAGEQUEUE_RENDERER_SENTINEL')
    const target = {
      loadURL: vi.fn(async () => { throw hostile }),
      loadFile: vi.fn(async () => undefined),
    }
    const onFailure = vi.fn()

    ownMainWindowContentLoad(target, 'http://localhost:5173', '/renderer/index.html', onFailure)
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledWith(hostile))
  })
})
