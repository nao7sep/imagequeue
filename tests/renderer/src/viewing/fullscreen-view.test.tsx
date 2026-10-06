// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionSnapshot, SurfaceConfirmRequest } from '../../../../src/shared/viewing'

const { FullscreenViewApp } = await import('../../../../src/renderer/src/viewing/FullscreenView')

const image = (baseName: string) => ({ taskId: baseName, status: 'completed' as const, baseName, error: null, providerMessage: null })

let latest: SelectionSnapshot
let pushSnapshot: (snapshot: SelectionSnapshot) => void
let askConfirm: (request: SurfaceConfirmRequest) => void
let dismissConfirm: (id: number) => void
let decode: ReturnType<typeof vi.fn>
let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  decode = vi.fn(async () => undefined)
  HTMLImageElement.prototype.decode = decode as unknown as () => Promise<void>
  latest = { version: 3, task: image('a') }
  api = {
    getLatestSelection: vi.fn(async () => latest),
    onSelectionSnapshot: vi.fn((callback) => { pushSnapshot = callback; return () => {} }),
    reportFullscreenViewPainted: vi.fn(async () => undefined),
    closeFullscreenView: vi.fn(async () => undefined),
    sendListKey: vi.fn(async () => undefined),
    onSurfaceConfirm: vi.fn((callback) => { askConfirm = callback; return () => {} }),
    onSurfaceConfirmDismissed: vi.fn((callback) => { dismissConfirm = callback; return () => {} }),
    answerSurfaceConfirm: vi.fn(async () => undefined),
    appLog: vi.fn(async () => undefined),
  }
  window.electronAPI = api as unknown as typeof window.electronAPI
})

afterEach(cleanup)

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document, { key, ...init })

describe('fullscreen view page', () => {
  it('draws the selected image once decoded and reports that snapshot painted', async () => {
    const { container } = render(<FullscreenViewApp />)
    await waitFor(() => expect(api.reportFullscreenViewPainted).toHaveBeenCalledWith(3, true))
    expect(container.querySelector('.fullscreen-view-image')?.getAttribute('src')).toBe('iq-image://output/current/a')
  })

  it('keeps the current image up until the next one has decoded', async () => {
    let finish: () => void = () => {}
    const { container } = render(<FullscreenViewApp />)
    await waitFor(() => expect(api.reportFullscreenViewPainted).toHaveBeenCalledWith(3, true))
    decode.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    act(() => pushSnapshot({ version: 4, task: image('b') }))
    expect(container.querySelector('.fullscreen-view-image')?.getAttribute('src')).toBe('iq-image://output/current/a')
    await act(async () => finish())
    await waitFor(() => expect(container.querySelector('.fullscreen-view-image')?.getAttribute('src')).toBe('iq-image://output/current/b'))
    expect(api.reportFullscreenViewPainted).toHaveBeenLastCalledWith(4, true)
  })

  it('reports a snapshot it cannot paint: no image to show, or one that did not load', async () => {
    render(<FullscreenViewApp />)
    await waitFor(() => expect(api.reportFullscreenViewPainted).toHaveBeenCalledWith(3, true))
    act(() => pushSnapshot({ version: 4, task: { ...image('q'), status: 'queued' } }))
    await waitFor(() => expect(api.reportFullscreenViewPainted).toHaveBeenLastCalledWith(4, false))
    decode.mockRejectedValueOnce(new Error('EncodingError'))
    act(() => pushSnapshot({ version: 5, task: image('missing') }))
    await waitFor(() => expect(api.reportFullscreenViewPainted).toHaveBeenLastCalledWith(5, false))
  })

  it('closes on Space or Escape and hands list keys to the main window', async () => {
    render(<FullscreenViewApp />)
    press(' ')
    press('Escape')
    expect(api.closeFullscreenView).toHaveBeenCalledTimes(2)
    press('ArrowLeft')
    press('ArrowDown')
    press('Backspace')
    press('Delete')
    press('Backspace', { metaKey: true })
    expect(api.sendListKey.mock.calls.map(([key]) => key)).toEqual(['left', 'down', 'remove', 'delete', 'delete'])
    press(' ', { repeat: true })
    expect(api.closeFullscreenView).toHaveBeenCalledTimes(2)
  })

  it('shows a confirmation asked of it over the image, answers it, and leaves keys to it while open', async () => {
    render(<FullscreenViewApp />)
    act(() => askConfirm({ id: 7, options: { title: 'Delete image?', message: 'It goes to the Trash.', confirmLabel: 'Delete', danger: true } }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('It goes to the Trash.')).toBeTruthy()
    press('ArrowLeft')
    press(' ')
    expect(api.sendListKey).not.toHaveBeenCalled()
    expect(api.closeFullscreenView).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(api.answerSurfaceConfirm).toHaveBeenCalledWith(7, true)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('drops a confirmation the main process withdraws', async () => {
    render(<FullscreenViewApp />)
    act(() => askConfirm({ id: 8, options: { message: 'Remove?' } }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    act(() => dismissConfirm(8))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.answerSurfaceConfirm).not.toHaveBeenCalled()
  })
})
