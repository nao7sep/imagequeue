// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installVirtualListLayout } from '../../virtual-list-layout'
import { ENGLISH } from '../../../../src/shared/i18n/catalogues'
import type { ConfirmOptions } from '../../../../src/shared/confirm'
import type { BackendId, SessionListEntry, SessionSummary, Task } from '../../../../src/shared/types'

// The Sessions window follows the app's own jobs while it is open: each queue
// change reads the sessions again, and only the latest read applies.

const confirm = vi.fn<(options: ConfirmOptions) => Promise<boolean>>()

let queueValue: { tasks: Record<BackendId, Task[]> }

vi.mock('../../../../src/renderer/src/context/QueueContext', () => ({
  useQueue: () => queueValue,
}))
vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => ({ settings: null }),
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => confirm,
}))


// jsdom lacks the CSSOM escape used by the listbox's real focus lookup.
if (typeof globalThis.CSS === 'undefined' || typeof globalThis.CSS.escape !== 'function') {
  ;(globalThis as unknown as { CSS: { escape: (value: string) => string } }).CSS = {
    escape: (value) => value.replace(/[^a-zA-Z0-9_-]/g, (character) => '\\' + character),
  }
}

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

let restoreLayout: () => void
beforeEach(() => {
  restoreLayout = installVirtualListLayout()
  confirm.mockReset()
  confirm.mockResolvedValue(true)
  queueValue = { tasks: emptyTasks() }
  window.electronAPI = { listSessions, resumeSession, openSessionFolder } as unknown as typeof window.electronAPI
})

afterEach(() => {
  cleanup()
  restoreLayout()
  vi.unstubAllGlobals()
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
    // Named by its start in the display zone (the test translator's default).
    const start = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date('2026-10-03T12:00:00Z'))
    const readable = screen.getByText(start).closest('[role="option"]') as HTMLElement
    act(() => readable.focus())
    await act(async () => { fireEvent.keyDown(readable, { key: 'Enter' }) })
    expect(resumeSession).toHaveBeenCalledExactlyOnceWith('20261003-120000-000-utc')
  })
})


describe('session selected actions', () => {
  it.each(['newer', 'unreadable'] as const)('opens the active %s folder from a keyboard menu without resuming', async (unopenable) => {
    listSessions.mockResolvedValueOnce([
      session(1, '2026-10-04T12:00:00.000Z'),
      { sessionId: 'other-session', unopenable },
    ])
    render(<SessionsModal onClose={vi.fn()} />)
    const list = await screen.findByRole('listbox')
    const rows = await within(list).findAllByRole('option')
    act(() => rows[0].focus())
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    expect(resumeSession).not.toHaveBeenCalled()
    const trigger = screen.getByRole('button', { name: 'Actions' })
    expect(list.contains(trigger)).toBe(false)
    expect(list.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    fireEvent.keyDown(rows[1], { key: 'F10', shiftKey: true })
    expect(screen.getByRole('menu')).toBeTruthy()
    expect((screen.getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Open Folder' })) })
    expect(openSessionFolder).toHaveBeenCalledWith('other-session')
    expect(resumeSession).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })

  it.each([false, true])('waits for deletion confirmation and deletes only when accepted (%s)', async (accepted) => {
    const decision = deferred<boolean>()
    confirm.mockReturnValueOnce(decision.promise)
    const previous = { ...session(1, '2026-10-04T12:00:00.000Z'), isCurrent: false }
    listSessions.mockResolvedValue([previous])
    const deleteSession = vi.fn(async () => undefined)
    window.electronAPI.deleteSession = deleteSession
    render(<SessionsModal onClose={vi.fn()} />)
    const row = await screen.findByRole('option')
    act(() => row.focus())
    fireEvent.keyDown(row, { key: 'ContextMenu' })
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })) })
    expect(confirm).toHaveBeenCalledExactlyOnceWith({
      title: ENGLISH['sessions.deleteTitle'],
      message: ENGLISH['sessions.deleteTrashMessage'],
      confirmLabel: ENGLISH['task.delete'],
      danger: true,
    })
    expect(deleteSession).not.toHaveBeenCalled()
    await act(async () => { decision.resolve(accepted) })
    if (accepted) expect(deleteSession).toHaveBeenCalledExactlyOnceWith(previous.sessionId)
    else expect(deleteSession).not.toHaveBeenCalled()
  })
})


describe('session thumbnail requests', () => {
  it('requests the 64 CSS pixel strip at display density without fetching originals', async () => {
    vi.stubGlobal('devicePixelRatio', 2)
    listSessions.mockResolvedValueOnce([{ ...session(1, '2026-10-04T12:00:00.000Z'), thumbnails: [{ baseName: 'image-one' }] }])
    render(<SessionsModal onClose={vi.fn()} />)
    const row = await screen.findByRole('option')
    const image = row.querySelector<HTMLImageElement>('.session-preview-thumb')!
    expect(image.getAttribute('src')).toBe('iq-image://sessions/session/20261004-120000/image-one?thumbnail=128')
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(row.querySelector('img[src="iq-image://sessions/session/20261004-120000/image-one"]')).toBeNull()
  })
})


it('bounds cards and thumbnails while navigating the entire archive and retaining the offscreen tab stop', async () => {
  const sessions: SessionListEntry[] = Array.from({ length: 5000 }, (_, i) => ({
    ...session(1, '2026-10-04T12:00:00.000Z'), sessionId: `archive-${i}`, isCurrent: false,
    thumbnails: [{ baseName: `image-${i}` }],
  }))
  listSessions.mockResolvedValue(sessions)
  render(<SessionsModal onClose={vi.fn()} />)
  const first = (await screen.findByText('archive-0')).closest<HTMLElement>('[role="option"]')!
  expect(screen.getAllByRole('option').length).toBeLessThan(20)
  expect(document.querySelectorAll('img').length).toBeLessThan(20)
  act(() => first.focus())
  fireEvent.keyDown(first, { key: 'End' })
  const last = (await screen.findByText('archive-4999')).closest<HTMLElement>('[role="option"]')!
  expect(document.activeElement).toBe(last)
  expect(last.getAttribute('aria-posinset')).toBe('5000')
  expect(last.getAttribute('aria-setsize')).toBe('5000')
  expect(resumeSession).not.toHaveBeenCalled()
  const viewport = document.querySelector<HTMLElement>('.sessions-viewport')!
  act(() => { viewport.scrollTop = 0; fireEvent.scroll(viewport) })
  expect(last.isConnected).toBe(true)
  expect(screen.getAllByRole('option').length).toBeLessThan(20)
  fireEvent.keyDown(last, { key: 'ContextMenu' })
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Open Folder' })) })
  expect(openSessionFolder).toHaveBeenCalledWith('archive-4999')
  act(() => last.focus())
  await act(async () => { fireEvent.keyDown(last, { key: 'Enter' }) })
  expect(resumeSession).toHaveBeenCalledWith('archive-4999')
})

it('finds a session by its label even when its card is not mounted', async () => {
  listSessions.mockResolvedValue(Array.from({ length: 200 }, (_, index) => ({
    sessionId: index === 199 ? 'zebra' : `archive-${index}`, unopenable: 'unreadable',
  })))
  render(<SessionsModal onClose={vi.fn()} />)
  const first = (await screen.findByText('archive-0')).closest<HTMLElement>('[role="option"]')!
  expect(screen.queryByText('zebra')).toBeNull()
  act(() => first.focus())
  fireEvent.keyDown(first, { key: 'z' })
  const target = (await screen.findByText('zebra')).closest<HTMLElement>('[role="option"]')!
  expect(document.activeElement).toBe(target)
})
