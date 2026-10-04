// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendId, SessionSummary, Task } from '../../../../src/shared/types'

// The Sessions window follows the app's own jobs while it is open: each queue
// change reads the sessions again, and only the latest read applies.

let queueValue: { tasks: Record<BackendId, Task[]> }

vi.mock('../../../../src/renderer/src/context/QueueContext', () => ({
  useQueue: () => queueValue,
}))
vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => ({ settings: null }),
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => async () => true,
}))

const { SessionsModal } = await import('../../../../src/renderer/src/components/SessionsModal')

const emptyTasks = (): Record<BackendId, Task[]> => ({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })

function session(completed: number, updatedAt: string): SessionSummary {
  return {
    sessionId: '20261004-120000', createdAt: '2026-10-04T12:00:00.000Z', updatedAt, lastResumedAt: null,
    taskCounts: { total: completed, queued: 0, generating: 0, completed, kept: 0, failed: 0, interrupted: 0 },
    completedCount: completed, retryCount: 0, keptCount: 0, thumbnails: [], isCurrent: true,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

const listSessions = vi.fn<() => Promise<SessionSummary[]>>()

beforeEach(() => {
  queueValue = { tasks: emptyTasks() }
  window.electronAPI = { listSessions } as unknown as typeof window.electronAPI
})

afterEach(() => {
  cleanup()
  listSessions.mockReset()
})

describe('SessionsModal', () => {
  it('reads the sessions again when the queue changes while it is open', async () => {
    listSessions.mockResolvedValueOnce([session(1, '2026-10-04T12:00:00.000Z')])
    const view = render(<SessionsModal onClose={() => undefined} />)
    await screen.findByText(/1 complete/)

    listSessions.mockResolvedValueOnce([session(2, '2026-10-04T12:05:00.000Z')])
    queueValue = { tasks: emptyTasks() }
    view.rerender(<SessionsModal onClose={() => undefined} />)

    await screen.findByText(/2 complete/)
    expect(listSessions).toHaveBeenCalledTimes(2)
  })

  it('keeps the newer list when an earlier read lands after it', async () => {
    const earlier = deferred<SessionSummary[]>()
    listSessions.mockReturnValueOnce(earlier.promise)
    const view = render(<SessionsModal onClose={() => undefined} />)

    listSessions.mockResolvedValueOnce([session(2, '2026-10-04T12:05:00.000Z')])
    queueValue = { tasks: emptyTasks() }
    view.rerender(<SessionsModal onClose={() => undefined} />)
    await screen.findByText(/2 complete/)

    await act(async () => { earlier.resolve([session(1, '2026-10-04T12:00:00.000Z')]) })
    expect(screen.queryByText(/1 complete/)).toBeNull()
    expect(screen.getByText(/2 complete/)).toBeTruthy()
  })
})
