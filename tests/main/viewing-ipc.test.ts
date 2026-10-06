import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  fullscreenContents: null as unknown,
  previewContents: null as unknown,
}))

vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, fn: Handler) => { mocks.handlers.set(channel, fn) },
}))
vi.mock('../../src/main/fullscreen-view', () => ({
  initFullscreenView: vi.fn(),
  openFullscreenView: vi.fn(),
  closeFullscreenView: vi.fn(),
  fullscreenViewPainted: vi.fn(),
  fullscreenViewContents: () => mocks.fullscreenContents,
}))
vi.mock('../../src/main/preview-window', () => ({
  initPreviewWindow: vi.fn(),
  previewWindowContents: () => mocks.previewContents,
}))

function contents() {
  const sent: Array<[string, unknown]> = []
  return { sent, send: (channel: string, payload: unknown) => { sent.push([channel, payload]) }, isDestroyed: () => false }
}

let main: ReturnType<typeof contents>
let snapshots: typeof import('../../src/main/selection-snapshot')
let confirms: typeof import('../../src/main/surface-confirm')

const call = (channel: string, sender: unknown, ...args: unknown[]) => mocks.handlers.get(channel)!({ sender }, ...args)

beforeEach(async () => {
  vi.resetModules()
  mocks.handlers.clear()
  mocks.fullscreenContents = null
  mocks.previewContents = null
  main = contents()
  const { registerViewingIpc } = await import('../../src/main/viewing-ipc')
  snapshots = await import('../../src/main/selection-snapshot')
  confirms = await import('../../src/main/surface-confirm')
  registerViewingIpc(() => ({ webContents: main, isDestroyed: () => false }) as unknown as Electron.BrowserWindow)
})

describe('selection', () => {
  it('takes the selection from the main window alone and stamps each snapshot with a rising version', async () => {
    const view = contents()
    await call('selection:publish', main, { taskId: 'a' })
    await call('selection:publish', view, { taskId: 'b' })
    await call('selection:publish', main, null)
    expect(await call('selection:latest', view)).toEqual({ version: 2, task: null })
    expect(snapshots.latestSelection().version).toBe(2)
  })
})

describe('list keys from a view', () => {
  it('hands the fullscreen view\'s keys to the main window, named with the view', async () => {
    const fullscreen = contents()
    mocks.fullscreenContents = fullscreen
    await call('list:key', fullscreen, 'left')
    await call('list:key', fullscreen, 'delete')
    expect(main.sent).toEqual([
      ['list:key', { key: 'left', surface: 'fullscreen-view' }],
      ['list:key', { key: 'delete', surface: 'fullscreen-view' }],
    ])
  })

  it('hands the preview window\'s keys, Space included, to the main window, named with the view', async () => {
    const previewWindow = contents()
    mocks.previewContents = previewWindow
    await call('list:key', previewWindow, 'right')
    await call('list:key', previewWindow, 'space')
    await call('list:key', previewWindow, 'remove')
    expect(main.sent).toEqual([
      ['list:key', { key: 'right', surface: 'preview-window' }],
      ['list:key', { key: 'space', surface: 'preview-window' }],
      ['list:key', { key: 'remove', surface: 'preview-window' }],
    ])
  })

  it('ignores an unknown key and a sender that is not an open view', async () => {
    const fullscreen = contents()
    mocks.fullscreenContents = fullscreen
    await call('list:key', fullscreen, 'Escape')
    await call('list:key', contents(), 'left')
    expect(main.sent).toEqual([])
  })
})

describe('confirmations in a view', () => {
  it('shows the main window\'s confirmation in the view and returns its answer', async () => {
    const fullscreen = contents()
    mocks.fullscreenContents = fullscreen
    const answer = call('surface:confirm', main, 'fullscreen-view', { message: 'Delete?' }) as Promise<boolean>
    const [[channel, request]] = fullscreen.sent as [[string, { id: number; options: unknown }]]
    expect(channel).toBe('surface:confirm')
    expect(request.options).toEqual({ message: 'Delete?' })

    await call('surface:answerConfirm', contents(), request.id, true)
    await call('surface:answerConfirm', fullscreen, request.id, true)
    await expect(answer).resolves.toBe(true)
  })

  it('shows a confirmation for a key pressed in the preview window in the preview window', async () => {
    const previewWindow = contents()
    mocks.previewContents = previewWindow
    const answer = call('surface:confirm', main, 'preview-window', { message: 'Delete?' }) as Promise<boolean>
    const request = previewWindow.sent[0]![1] as { id: number }
    await call('surface:answerConfirm', previewWindow, request.id, false)
    await expect(answer).resolves.toBe(false)
  })

  it('answers no for a dialog still open when its view closes, and withdraws it', async () => {
    const fullscreen = contents()
    mocks.fullscreenContents = fullscreen
    const answer = call('surface:confirm', main, 'fullscreen-view', { message: 'Remove?' }) as Promise<boolean>
    const id = (fullscreen.sent[0]![1] as { id: number }).id
    confirms.dismissSurfaceConfirms('fullscreen-view')
    await expect(answer).resolves.toBe(false)
    expect(fullscreen.sent.at(-1)).toEqual(['surface:confirmDismissed', id])
  })

  it('returns null when the view is gone, so the main window asks itself', async () => {
    expect(await call('surface:confirm', main, 'fullscreen-view', { message: 'Delete?' })).toBeNull()
    expect(await call('surface:confirm', main, 'toString', { message: 'Delete?' })).toBeNull()
  })
})
