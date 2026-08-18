// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import type { BackendId, Task } from '../../../../src/shared/types'

// Drives the real SelectionContext against stubbed queue/settings/confirm, so the
// delete rules are exercised where they live rather than through a column's
// keydown handler. The keybinding itself is QueueColumn's; what a delete does to
// each task status is this context's, and is the part that silently did nothing.

const emptyTasks = (): Record<BackendId, Task[]> => ({
  openai: [], nanobanana: [], grok: [], flux: [], drawthings: [],
})

function task(id: string, status: Task['status'], baseName: string | null = null): Task {
  return {
    id, prompt: 'p', backend: 'openai', model: 'm', params: {}, status,
    enqueuedAt: '2026-08-18T00:00:00.000Z', startedAt: null, completedAt: null,
    durationMs: null,
    imagePath: baseName ? `/out/${baseName}.png` : null,
    baseName,
    error: null,
  }
}

interface ConfirmRequest { message: string }

let queueValue: Record<string, unknown>
let settingsValue: Record<string, unknown>
let confirmCalls: ConfirmRequest[]
let confirmAnswer: boolean

vi.mock('../../../../src/renderer/src/context/QueueContext', () => ({
  useQueue: () => queueValue,
}))
vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => settingsValue,
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({
  useConfirm: () => async (request: ConfirmRequest) => {
    confirmCalls.push(request)
    return confirmAnswer
  },
}))

const { SelectionProvider, useSelection } = await import(
  '../../../../src/renderer/src/context/SelectionContext'
)

type Selection = ReturnType<typeof useSelection>

let api: { deleteWithFiles: ReturnType<typeof vi.fn>; removeTask: ReturnType<typeof vi.fn> }

beforeEach(() => {
  const tasks = emptyTasks()
  tasks.openai = [
    task('t-queued', 'queued'),
    task('t-generating', 'generating'),
    task('t-failed', 'failed'),
    task('t-done', 'completed', 'img-1'),
  ]
  queueValue = { tasks, restoreTask: vi.fn() }
  settingsValue = { settings: { general: { confirm_delete: true, delete_to_trash: true } } }
  confirmCalls = []
  confirmAnswer = true
  api = { deleteWithFiles: vi.fn(async () => {}), removeTask: vi.fn(async () => {}) }
  window.electronAPI = api as unknown as typeof window.electronAPI
})

afterEach(cleanup)

// Renders the provider and hands back the live context value.
function mountSelection(): { ctx: () => Selection } {
  let latest!: Selection
  function Probe(): null {
    latest = useSelection()
    return null
  }
  render(<SelectionProvider><Probe /></SelectionProvider>)
  return { ctx: () => latest }
}

async function deleteById(taskId: string): Promise<void> {
  const { ctx } = mountSelection()
  await act(async () => { await ctx().deleteTask('openai', taskId) })
}

describe('deleteTask', () => {
  it('deletes a task that never produced an image', async () => {
    await deleteById('t-queued')
    expect(api.deleteWithFiles).toHaveBeenCalledWith('openai', 't-queued')
  })

  it('deletes a failed task', async () => {
    await deleteById('t-failed')
    expect(api.deleteWithFiles).toHaveBeenCalledWith('openai', 't-failed')
  })

  it('deletes a completed task, files and all', async () => {
    await deleteById('t-done')
    expect(api.deleteWithFiles).toHaveBeenCalledWith('openai', 't-done')
  })

  // The safety invariant. queue:deleteWithFiles has no status guard of its own —
  // unlike queue:removeTask — so this refusal is the only thing standing between
  // a keystroke and a task disappearing while its image is being written.
  it('refuses a task that is generating, and asks nothing first', async () => {
    await deleteById('t-generating')
    expect(api.deleteWithFiles).not.toHaveBeenCalled()
    expect(confirmCalls).toHaveLength(0)
  })

  it('does not offer to remove files from a task that has none', async () => {
    await deleteById('t-queued')
    expect(confirmCalls).toHaveLength(1)
    expect(confirmCalls[0].message).not.toMatch(/file/i)
    expect(confirmCalls[0].message).not.toMatch(/trash/i)
  })

  it('still names the files when the task has an image', async () => {
    await deleteById('t-done')
    expect(confirmCalls).toHaveLength(1)
    expect(confirmCalls[0].message).toMatch(/trash/i)
  })

  it('deletes nothing when the confirmation is declined', async () => {
    confirmAnswer = false
    await deleteById('t-queued')
    expect(api.deleteWithFiles).not.toHaveBeenCalled()
  })
})
