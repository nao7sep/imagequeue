// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionSnapshot, SurfaceConfirmRequest } from '../../../../src/shared/viewing'

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
  it('shows the selected image and follows the selection', async () => {
    const { container } = render(<PreviewWindowApp />)
    await waitFor(() => expect(src(container)).toBe('iq-image://output/current/a'))
    act(() => pushSnapshot({ version: 3, task: image('b') }))
    await waitFor(() => expect(src(container)).toBe('iq-image://output/current/b'))
  })

  it('ignores a snapshot older than the one shown, such as a late answer to its first request', async () => {
    let answer: (snapshot: SelectionSnapshot) => void = () => {}
    latest = new Promise((resolve) => { answer = resolve })
    const { container } = render(<PreviewWindowApp />)
    act(() => pushSnapshot({ version: 5, task: image('new') }))
    await waitFor(() => expect(src(container)).toBe('iq-image://output/current/new'))
    await act(async () => answer({ version: 4, task: image('old') }))
    expect(src(container)).toBe('iq-image://output/current/new')
  })

  it('shows why a failed task failed, as the main window does', async () => {
    latest = Promise.resolve({ version: 1, task: { taskId: 'f', status: 'failed', baseName: null, error: { key: 'taskFailure.unknown' }, providerMessage: 'blocked' } })
    const { container } = render(<PreviewWindowApp />)
    await waitFor(() => expect(container.querySelector('.preview-failure-provider')?.textContent).toBe('blocked'))
    expect(container.querySelector('.preview-placeholder')).not.toBeNull()
  })

  it('hands arrows, Backspace and Delete to the main window, and not Space', async () => {
    render(<PreviewWindowApp />)
    for (const key of ['ArrowUp', 'ArrowRight', ' ', 'Backspace', 'Delete']) fireEvent.keyDown(document, { key })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(api.sendListKey.mock.calls.map(([key]) => key)).toEqual(['up', 'right', 'remove', 'delete'])
  })

  it('shows a confirmation asked of it and keeps keys from the lists while it is open', async () => {
    render(<PreviewWindowApp />)
    act(() => askConfirm({ id: 3, options: { title: 'Remove?', message: 'It stays on disk.', confirmLabel: 'Remove' } }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(api.sendListKey).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(api.answerSurfaceConfirm).toHaveBeenCalledWith(3, true)
  })
})
