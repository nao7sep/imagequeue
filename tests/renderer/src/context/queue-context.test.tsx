// @vitest-environment jsdom
import type { QueueSnapshot, QueueUpdate } from '../../../../src/shared/queue-updates'
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
    let resolveInitial!: (tasks: QueueSnapshot) => void
    const initial = new Promise<QueueSnapshot>((resolve) => { resolveInitial = resolve })
    window.electronAPI = {
      getShowKeptImages: vi.fn(async () => false),
      toggleShowKeptImages: vi.fn(async () => true),
      onShowKeptImagesChanged: vi.fn(() => () => undefined),
      getQueueSnapshot: vi.fn(() => initial),
      onQueueUpdated: vi.fn(() => () => undefined),
    } as unknown as typeof window.electronAPI

    render(<QueueProvider><Probe /></QueueProvider>)
    expect(screen.getByText('loading:0')).toBeTruthy()

    await act(async () => resolveInitial({ kind: 'snapshot', revision: 0, tasks: emptyTasks() }))
    expect(screen.getByText('ready:0')).toBeTruthy()
  })

  it('reports failure, then recovers when a live queue update arrives', async () => {
    let onUpdate!: (tasks: QueueUpdate) => void
    window.electronAPI = {
      getShowKeptImages: vi.fn(async () => false),
      toggleShowKeptImages: vi.fn(async () => true),
      onShowKeptImagesChanged: vi.fn(() => () => undefined),
      getQueueSnapshot: vi.fn(async () => { throw new Error('unavailable') }),
      onQueueUpdated: vi.fn((callback) => {
        onUpdate = callback
        return () => undefined
      }),
    } as unknown as typeof window.electronAPI

    render(<QueueProvider><Probe /></QueueProvider>)
    expect(await screen.findByText('failed:0')).toBeTruthy()

    act(() => onUpdate({ kind: 'snapshot', revision: 1, tasks: emptyTasks() }))
    expect(screen.getByText('ready:0')).toBeTruthy()
  })

  it('does not let an older initial-read failure overwrite a live update', async () => {
    let rejectInitial!: (error: Error) => void
    let onUpdate!: (tasks: QueueUpdate) => void
    const initial = new Promise<QueueSnapshot>((_, reject) => { rejectInitial = reject })
    window.electronAPI = {
      getShowKeptImages: vi.fn(async () => false),
      toggleShowKeptImages: vi.fn(async () => true),
      onShowKeptImagesChanged: vi.fn(() => () => undefined),
      getQueueSnapshot: vi.fn(() => initial),
      onQueueUpdated: vi.fn((callback) => {
        onUpdate = callback
        return () => undefined
      }),
    } as unknown as typeof window.electronAPI

    render(<QueueProvider><Probe /></QueueProvider>)
    act(() => onUpdate({ kind: 'snapshot', revision: 1, tasks: emptyTasks() }))
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
      getQueueSnapshot: vi.fn(async () => ({ kind: 'snapshot', revision: 0, tasks: stored })), onQueueUpdated: vi.fn(() => () => undefined),
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


function deferredSnapshot() {
  let resolve!: (snapshot: QueueSnapshot) => void
  let reject!: (error: Error) => void
  const promise = new Promise<QueueSnapshot>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const snapshotWith = (revision: number, ...ids: string[]): QueueSnapshot => {
  const tasks = emptyTasks()
  tasks.openai = ids.map((id) => ({ ...keptTask(), id, prompt: id, backend: 'openai', status: 'queued' }))
  return { kind: 'snapshot', revision, tasks }
}

describe('revisioned queue updates', () => {
  let queue!: ReturnType<typeof useQueue>
  let renders = 0
  function RevisionProbe(): React.JSX.Element {
    queue = useQueue()
    renders++
    return <Probe />
  }
  function installSnapshots(...responses: ReturnType<typeof deferredSnapshot>[]) {
    let receive!: (update: QueueUpdate) => void
    const unsubscribe = vi.fn()
    const getSnapshot = vi.fn<() => Promise<QueueSnapshot>>()
    for (const response of responses) getSnapshot.mockReturnValueOnce(response.promise)
    window.electronAPI = {
      getQueueSnapshot: getSnapshot,
      onQueueUpdated: vi.fn((callback) => { receive = callback; return unsubscribe }),
      getShowKeptImages: vi.fn(async () => false),
      toggleShowKeptImages: vi.fn(async () => true),
      onShowKeptImagesChanged: vi.fn(() => () => undefined),
      appLog: vi.fn(async () => undefined),
    } as unknown as typeof window.electronAPI
    return { getSnapshot, unsubscribe, push: (update: QueueUpdate) => receive(update) }
  }
  const ids = (): string[] => queue.tasks.openai.map((task) => task.id)

  it('resynchronizes a live delta racing an older initial snapshot without replaying it against unknown state', async () => {
    const initial = deferredSnapshot()
    const resync = deferredSnapshot()
    const api = installSnapshots(initial, resync)
    render(<QueueProvider><RevisionProbe /></QueueProvider>)
    act(() => api.push({ kind: 'delta', baseRevision: 2, revision: 3, upserts: snapshotWith(3, 'new').tasks.openai, removed: [] }))
    expect(api.getSnapshot).toHaveBeenCalledTimes(1)
    expect(queue.loadState).toBe('loading')
    expect(ids()).toEqual([])
    await act(async () => initial.resolve(snapshotWith(2, 'earlier')))
    expect(api.getSnapshot).toHaveBeenCalledTimes(2)
    await act(async () => resync.resolve(snapshotWith(3, 'new', 'earlier')))
    expect(queue.loadState).toBe('ready')
    expect(ids()).toEqual(['new', 'earlier'])
  })

  it.each([
    { label: 'skipped', baseRevision: 4, revision: 5 },
    { label: 'overlapping', baseRevision: 1, revision: 4 },
  ])('requests a snapshot for a $label revision without applying a partial delta', async ({ baseRevision, revision }) => {
    const initial = deferredSnapshot()
    const resync = deferredSnapshot()
    const api = installSnapshots(initial, resync)
    render(<QueueProvider><RevisionProbe /></QueueProvider>)
    await act(async () => initial.resolve(snapshotWith(2, 'known')))
    act(() => api.push({ kind: 'delta', baseRevision, revision, upserts: snapshotWith(revision, 'partial').tasks.openai, removed: [{ backend: 'openai', id: 'known' }] }))
    expect(api.getSnapshot).toHaveBeenCalledTimes(2)
    expect(ids()).toEqual(['known'])
    // More missed updates share this in-flight synchronization request.
    act(() => api.push({ kind: 'delta', baseRevision: revision, revision: revision + 1, upserts: [], removed: [] }))
    expect(api.getSnapshot).toHaveBeenCalledTimes(2)
    await act(async () => resync.resolve(snapshotWith(revision + 1, 'authoritative')))
    expect(ids()).toEqual(['authoritative'])
  })

  it('applies contiguous deltas in order and ignores duplicate or older revisions', async () => {
    const initial = deferredSnapshot()
    const api = installSnapshots(initial)
    render(<QueueProvider><RevisionProbe /></QueueProvider>)
    await act(async () => initial.resolve(snapshotWith(2, 'first', 'second')))
    const updated = { ...queue.tasks.openai[1], status: 'generating' as const }
    act(() => api.push({ kind: 'delta', baseRevision: 2, revision: 3, upserts: [updated], removed: [{ backend: 'openai', id: 'first' }] }))
    expect(ids()).toEqual(['second'])
    expect(queue.tasks.openai[0]).toBe(updated)
    act(() => api.push(snapshotWith(2, 'stale')))
    act(() => api.push({ kind: 'delta', baseRevision: 2, revision: 3, upserts: snapshotWith(3, 'duplicate').tasks.openai, removed: [] }))
    expect(ids()).toEqual(['second'])
    expect(api.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('does not let an older synchronization response replace a newer live snapshot and delta', async () => {
    const initial = deferredSnapshot()
    const resync = deferredSnapshot()
    const api = installSnapshots(initial, resync)
    render(<QueueProvider><RevisionProbe /></QueueProvider>)
    await act(async () => initial.resolve(snapshotWith(2, 'initial')))
    act(() => api.push({ kind: 'delta', baseRevision: 4, revision: 5, upserts: [], removed: [] }))
    act(() => api.push(snapshotWith(6, 'live')))
    act(() => api.push({ kind: 'delta', baseRevision: 6, revision: 7, upserts: snapshotWith(7, 'latest').tasks.openai, removed: [] }))
    expect(ids()).toEqual(['latest', 'live'])
    await act(async () => resync.resolve(snapshotWith(5, 'old-response')))
    expect(ids()).toEqual(['latest', 'live'])
    expect(api.getSnapshot).toHaveBeenCalledTimes(2)
  })

  it.each(['resolve', 'reject'] as const)('unsubscribes and drops a late snapshot %s after cleanup', async (settlement) => {
    const initial = deferredSnapshot()
    const api = installSnapshots(initial)
    const view = render(<QueueProvider><RevisionProbe /></QueueProvider>)
    await act(async () => {})
    view.unmount()
    expect(api.unsubscribe).toHaveBeenCalledOnce()
    const previousRenders = renders
    await act(async () => {
      if (settlement === 'resolve') initial.resolve(snapshotWith(8, 'late'))
      else initial.reject(new Error('late failure'))
      api.push({ kind: 'delta', baseRevision: 8, revision: 9, upserts: [], removed: [] })
    })
    expect(renders).toBe(previousRenders)
    expect(api.getSnapshot).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.appLog).not.toHaveBeenCalled()
  })
})
