// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendId, SessionListEntry, SessionSummary, Task } from '../../../../src/shared/types'

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

const listSessions = vi.fn<() => Promise<SessionListEntry[]>>()
const resumeSession = vi.fn(async (_sessionId: string) => {})
const openSessionFolder = vi.fn(async (_sessionId: string) => {})

beforeEach(() => {
  queueValue = { tasks: emptyTasks() }
  window.electronAPI = { listSessions, resumeSession, openSessionFolder } as unknown as typeof window.electronAPI
})

afterEach(() => {
  cleanup()
  listSessions.mockReset()
  resumeSession.mockClear()
  openSessionFolder.mockClear()
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

  it('lists a session it cannot open in place, by folder and reason, offering only Open Folder', async () => {
    listSessions.mockResolvedValueOnce([
      session(1, '2026-10-04T12:00:00.000Z'),
      { ...session(3, '2026-10-03T12:00:00.000Z'), sessionId: '20261003-120000-000-utc', isCurrent: false },
      { sessionId: '20261003-090000-123-utc', unopenable: 'newer' },
      { sessionId: '20261002-090000-123-utc copy', unopenable: 'unreadable' },
    ])
    render(<SessionsModal onClose={() => undefined} />)

    const newer = (await screen.findByText('20261003-090000-123-utc')).closest('[role="option"]') as HTMLElement
    const unreadable = screen.getByText('20261002-090000-123-utc copy').closest('[role="option"]') as HTMLElement
    expect(within(newer).getByText(/A newer version of ImageQueue wrote this session’s session.json/)).toBeTruthy()
    expect(within(unreadable).getByText(/ImageQueue can’t read this session’s session.json/)).toBeTruthy()
    for (const card of [newer, unreadable]) {
      expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['Open Folder'])
    }

    await act(async () => { fireEvent.click(within(newer).getByRole('button', { name: 'Open Folder' })) })
    expect(openSessionFolder).toHaveBeenCalledExactlyOnceWith('20261003-090000-123-utc')

    act(() => newer.focus())
    await act(async () => { fireEvent.keyDown(newer, { key: 'Enter' }) })
    expect(resumeSession).not.toHaveBeenCalled()
    // Enter on a session it can open does resume it.
    const readable = screen.getByText('20261003-120000').closest('[role="option"]') as HTMLElement
    act(() => readable.focus())
    await act(async () => { fireEvent.keyDown(readable, { key: 'Enter' }) })
    expect(resumeSession).toHaveBeenCalledExactlyOnceWith('20261003-120000-000-utc')
  })
})
