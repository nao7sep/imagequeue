// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionSnapshot, SurfaceConfirmRequest } from '../../../../src/shared/viewing'
import { until } from '../../until'

const { PreviewWindowApp } = await import('../../../../src/renderer/src/viewing/PreviewWindow')

const image = (baseName: string) => ({ taskId: baseName, status: 'completed' as const, baseName, error: null, providerMessage: null })

let latest: Promise<SelectionSnapshot>
let pushSnapshot: (snapshot: SelectionSnapshot) => void
let askConfirm: (request: SurfaceConfirmRequest) => void
let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  HTMLImageElement.prototype.decode = vi.fn(async () => undefined) as unknown as () => Promise<void>
  latest = Promise.resolve({ version: 2, task: image('a') })
  api = {
    getLatestSelection: vi.fn(() => latest),
    onSelectionSnapshot: vi.fn((callback) => { pushSnapshot = callback; return () => {} }),
    sendListKey: vi.fn(async () => undefined),
    sendWindowCommand: vi.fn(async () => undefined),
    openFullscreenView: vi.fn(async () => undefined),
    onSurfaceConfirm: vi.fn((callback) => { askConfirm = callback; return () => {} }),
    onSurfaceConfirmDismissed: vi.fn(() => () => {}),
    answerSurfaceConfirm: vi.fn(async () => undefined),
    appLog: vi.fn(async () => undefined),
  }
  window.electronAPI = api as unknown as typeof window.electronAPI
})

afterEach(cleanup)

const src = (container: HTMLElement) => container.querySelector('.preview-image')?.getAttribute('src')

describe('preview window page', () => {
  it.each(['failed', 'queued', 'kept'] as const)('allows removal of a displayed %s placeholder', async (status) => {
    latest = Promise.resolve({ version: 1, task: { taskId: 'no-image', status, baseName: null, error: null, providerMessage: null } })
    render(<PreviewWindowApp />)
    await act(async () => {})
    fireEvent.keyDown(document, { key: 'Backspace' })
    expect(api.sendListKey).toHaveBeenLastCalledWith('remove', 'no-image')
  })

  it('ignores destructive keys while B is loading over A, then identifies B', async () => {
    render(<PreviewWindowApp />)
    await until(() => expect(document.querySelector('img')?.getAttribute('src')).toBe('iq-image://sessions/current/a'))
    let finish!: () => void
    vi.mocked(HTMLImageElement.prototype.decode).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    act(() => pushSnapshot({ version: 8, task: image('b') }))
    fireEvent.keyDown(document, { key: 'Delete' })
    fireEvent.keyDown(document, { key: 'Backspace' })
    expect(api.sendListKey).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'ArrowDown', repeat: true })
    expect(api.sendListKey).toHaveBeenLastCalledWith('down', 'b')
    await act(async () => finish())
    fireEvent.keyDown(document, { key: 'Delete' })
    expect(api.sendListKey).toHaveBeenLastCalledWith('delete', 'b')
  })

  it('shows the selected image and follows the selection', async () => {
    const { container } = render(<PreviewWindowApp />)
    await until(() => expect(src(container)).toBe('iq-image://sessions/current/a'))
    act(() => pushSnapshot({ version: 3, task: image('b') }))
    await until(() => expect(src(container)).toBe('iq-image://sessions/current/b'))
  })

  it('ignores a snapshot older than the one shown, such as a late answer to its first request', async () => {
    let answer: (snapshot: SelectionSnapshot) => void = () => {}
    latest = new Promise((resolve) => { answer = resolve })
    const { container } = render(<PreviewWindowApp />)
    act(() => pushSnapshot({ version: 5, task: image('new') }))
    await until(() => expect(src(container)).toBe('iq-image://sessions/current/new'))
    await act(async () => answer({ version: 4, task: image('old') }))
    expect(src(container)).toBe('iq-image://sessions/current/new')
  })

  it('shows why a failed task failed, as the main window does', async () => {
    latest = Promise.resolve({ version: 1, task: { taskId: 'f', status: 'failed', baseName: null, error: { key: 'taskFailure.unknown' }, providerMessage: 'blocked' } })
    const { container } = render(<PreviewWindowApp />)
    await until(() => expect(container.querySelector('.preview-failure-provider')?.textContent).toBe('blocked'))
    expect(container.querySelector('.preview-placeholder')).not.toBeNull()
  })

  // The preview window opens with the main window as one set and answers its
  // keys and shortcuts the same way (window-conventions).
  it('hands arrows, Backspace and Delete to the main window as list keys', async () => {
    let finish!: () => void
    vi.mocked(HTMLImageElement.prototype.decode).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<PreviewWindowApp />)
    await act(async () => {})
    await act(async () => finish())
    for (const key of ['ArrowUp', 'ArrowRight', 'Backspace', 'Delete']) fireEvent.keyDown(document, { key })
    expect(api.sendListKey.mock.calls.map(([key]) => key)).toEqual(['up', 'right', 'remove', 'delete'])
  })

  it('opens the fullscreen view on Space once its image is on screen, as the lists do', async () => {
    let finish!: () => void
    vi.mocked(HTMLImageElement.prototype.decode).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<PreviewWindowApp />)
    await act(async () => {})
    fireEvent.keyDown(document, { key: ' ' })
    expect(api.openFullscreenView).not.toHaveBeenCalled()
    await act(async () => finish())
    fireEvent.keyDown(document, { key: ' ', repeat: true })
    expect(api.openFullscreenView).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: ' ' })
    expect(api.openFullscreenView).toHaveBeenCalledOnce()
    expect(api.sendListKey).not.toHaveBeenCalled()
  })

  it('hands the main window\'s shortcuts to it', async () => {
    render(<PreviewWindowApp />)
    await act(async () => {})
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: ',', metaKey: true })
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(document, { key: '2', metaKey: true })
    fireEvent.keyDown(document, { key: 'K', metaKey: true, shiftKey: true })
    fireEvent.keyDown(document, { key: 'K', metaKey: true, shiftKey: true, repeat: true })
    expect(api.sendWindowCommand.mock.calls.map(([command]) => command)).toEqual(['clear', 'settings', 'sendAll', 'send:2', 'toggleKept'])
    expect(api.sendListKey).not.toHaveBeenCalled()
  })

  it('shows a confirmation asked of it and keeps keys from the lists while it is open', async () => {
    render(<PreviewWindowApp />)
    act(() => askConfirm({ id: 3, options: { title: 'Remove?', message: 'It stays on disk.', confirmLabel: 'Remove' } }))
    expect(await until(() => screen.getByRole('dialog'))).toBeTruthy()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(api.sendListKey).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(api.answerSurfaceConfirm).toHaveBeenCalledWith(3, true)
  })
})
