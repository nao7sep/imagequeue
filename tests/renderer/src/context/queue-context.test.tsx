// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueueProvider, useQueue } from '../../../../src/renderer/src/context/QueueContext'
import { OPERATIONAL_FAILURE_EVENT, OPERATIONAL_RESOLVED_EVENT } from '../../../../src/renderer/src/utils/operationalFailure'
import type { BackendId, Task } from '../../../../src/shared/types'

afterEach(cleanup)

const emptyTasks = (): Record<BackendId, Task[]> => ({
  openai: [], nanobanana: [], grok: [], flux: [], drawthings: [],
})

function Probe(): React.JSX.Element {
  const { loadState, tasks } = useQueue()
  const count = Object.values(tasks).reduce((total, list) => total + list.length, 0)
  return <div>{loadState}:{count}</div>
}

describe('QueueProvider load state', () => {
  it('moves from loading to ready when the initial snapshot arrives', async () => {
    let resolveInitial!: (tasks: Record<BackendId, Task[]>) => void
    const initial = new Promise<Record<BackendId, Task[]>>((resolve) => { resolveInitial = resolve })
    window.electronAPI = {
      getShowKeptImages: vi.fn(async () => false),
      toggleShowKeptImages: vi.fn(async () => true),
      onShowKeptImagesChanged: vi.fn(() => () => undefined),
      getAllStoredTasks: vi.fn(() => initial),
      onQueueUpdated: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    render(<QueueProvider><Probe /></QueueProvider>)
    expect(screen.getByText('loading:0')).toBeTruthy()

    await act(async () => resolveInitial(emptyTasks()))
    expect(screen.getByText('ready:0')).toBeTruthy()
  })

  it('reports failure, then recovers when a live queue update arrives', async () => {
    let onUpdate!: (tasks: Record<BackendId, Task[]>) => void
    window.electronAPI = {
      getShowKeptImages: vi.fn(async () => false),
      toggleShowKeptImages: vi.fn(async () => true),
      onShowKeptImagesChanged: vi.fn(() => () => undefined),
      getAllStoredTasks: vi.fn(async () => { throw new Error('unavailable') }),
      onQueueUpdated: vi.fn((callback) => {
        onUpdate = callback
        return () => undefined
      }),
    } as unknown as typeof window.electronAPI

    render(<QueueProvider><Probe /></QueueProvider>)
    expect(await screen.findByText('failed:0')).toBeTruthy()

    act(() => onUpdate(emptyTasks()))
    expect(screen.getByText('ready:0')).toBeTruthy()
  })

  it('does not let an older initial-read failure overwrite a live update', async () => {
    let rejectInitial!: (error: Error) => void
    let onUpdate!: (tasks: Record<BackendId, Task[]>) => void
    const initial = new Promise<Record<BackendId, Task[]>>((_, reject) => { rejectInitial = reject })
    window.electronAPI = {
      getShowKeptImages: vi.fn(async () => false),
      toggleShowKeptImages: vi.fn(async () => true),
      onShowKeptImagesChanged: vi.fn(() => () => undefined),
      getAllStoredTasks: vi.fn(() => initial),
      onQueueUpdated: vi.fn((callback) => {
        onUpdate = callback
        return () => undefined
      }),
    } as unknown as typeof window.electronAPI

    render(<QueueProvider><Probe /></QueueProvider>)
    act(() => onUpdate(emptyTasks()))
    expect(screen.getByText('ready:0')).toBeTruthy()

    await act(async () => rejectInitial(new Error('stale failure')))
    expect(screen.getByText('ready:0')).toBeTruthy()
  })
})


function keptTask(): Task {
  return {
    id: 'kept', prompt: 'p', backend: 'grok', model: 'm', params: {}, status: 'kept',
    enqueuedAt: '2026-10-01T00:00:00Z', startedAt: null, completedAt: null, durationMs: null,
    baseName: 'image', imagePath: 'image.png', error: null, providerMessage: null,
  }
}

describe('shared kept-image visibility', () => {
  let queue!: ReturnType<typeof useQueue>
  function VisibilityProbe(): React.JSX.Element {
    queue = useQueue()
    return <Probe />
  }
  function installVisibilityApi(initial: Promise<boolean> = Promise.resolve(false)) {
    let push!: (visible: boolean) => void
    const stored = emptyTasks()
    stored.grok = [keptTask()]
    const unsubscribe = vi.fn()
    const toggle = vi.fn(async () => true)
    window.electronAPI = {
      getAllStoredTasks: vi.fn(async () => stored), onQueueUpdated: vi.fn(() => () => undefined),
      getShowKeptImages: vi.fn(() => initial), toggleShowKeptImages: toggle,
      onShowKeptImagesChanged: vi.fn((callback) => { push = callback; return unsubscribe }),
      appLog: vi.fn(async () => undefined),
    } as unknown as typeof window.electronAPI
    return { push: (visible: boolean) => push(visible), toggle, unsubscribe }
  }

  it('projects main updates and waits for the event when a toggle is acknowledged', async () => {
    const api = installVisibilityApi()
    const view = render(<QueueProvider><VisibilityProbe /></QueueProvider>)
    await act(async () => {})
    expect(queue.showKeptImages).toBe(false)
    expect(queue.tasks.grok).toHaveLength(0)
    act(() => queue.toggleShowKeptImages())
    await act(async () => {})
    expect(api.toggle).toHaveBeenCalledOnce()
    // The acknowledgment does not replace the event as presentation authority.
    expect(queue.showKeptImages).toBe(false)
    act(() => api.push(true))
    expect(queue.showKeptImages).toBe(true)
    expect(queue.tasks.grok).toHaveLength(1)
    act(() => api.push(false))
    expect(queue.tasks.grok).toHaveLength(0)
    view.unmount()
    expect(api.unsubscribe).toHaveBeenCalledOnce()
  })

  it('ignores a late initial value after a newer main event', async () => {
    let finish!: (visible: boolean) => void
    const api = installVisibilityApi(new Promise((resolve) => { finish = resolve }))
    render(<QueueProvider><VisibilityProbe /></QueueProvider>)
    await act(async () => {})
    act(() => api.push(true))
    await act(async () => finish(false))
    expect(queue.showKeptImages).toBe(true)
    expect(queue.tasks.grok).toHaveLength(1)
  })

  it('ignores a stale hydration failure after a remote visibility event', async () => {
    let reject!: (error: Error) => void
    const failures = vi.fn()
    window.addEventListener(OPERATIONAL_FAILURE_EVENT, failures)
    try {
      const api = installVisibilityApi(new Promise((_, fail) => { reject = fail }))
      render(<QueueProvider><VisibilityProbe /></QueueProvider>)
      await act(async () => {})
      act(() => api.push(true))
      await act(async () => reject(new Error('stale failure')))
      expect(queue.showKeptImages).toBe(true)
      expect(failures).not.toHaveBeenCalled()
    } finally { window.removeEventListener(OPERATIONAL_FAILURE_EVENT, failures) }
  })

  it('clears an earlier load failure when a remounted provider successfully hydrates', async () => {
    const resolutions = vi.fn()
    window.addEventListener(OPERATIONAL_RESOLVED_EVENT, resolutions)
    try {
      installVisibilityApi(Promise.reject(new Error('load unavailable')))
      const first = render(<QueueProvider><VisibilityProbe /></QueueProvider>)
      await act(async () => {})
      expect(resolutions).not.toHaveBeenCalled()
      first.unmount()
      installVisibilityApi(Promise.resolve(true))
      render(<QueueProvider><VisibilityProbe /></QueueProvider>)
      await act(async () => {})
      expect(queue.showKeptImages).toBe(true)
      expect(resolutions).toHaveBeenCalledWith(expect.objectContaining({ detail: { key: 'queue-kept-visibility-load' } }))
    } finally { window.removeEventListener(OPERATIONAL_RESOLVED_EVENT, resolutions) }
  })

  it('reports load and toggle failures without changing the authoritative projection', async () => {
    const failures: unknown[] = []
    const onFailure = (event: Event): void => { failures.push((event as CustomEvent).detail) }
    window.addEventListener(OPERATIONAL_FAILURE_EVENT, onFailure)
    try {
      const api = installVisibilityApi(Promise.reject(new Error('load unavailable')))
      api.toggle.mockRejectedValueOnce(new Error('toggle unavailable'))
      render(<QueueProvider><VisibilityProbe /></QueueProvider>)
      await act(async () => {})
      act(() => queue.toggleShowKeptImages())
      await act(async () => {})
      expect(queue.showKeptImages).toBe(false)
      expect(queue.tasks.grok).toHaveLength(0)
      expect(failures).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'operation.uiStateLoadFailed' }),
        expect.objectContaining({ message: 'operation.uiStateSaveFailed' }),
      ]))
    } finally { window.removeEventListener(OPERATIONAL_FAILURE_EVENT, onFailure) }
  })
})
