// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendId, Task, TaskStatus } from '../../../../src/shared/types'

const context = vi.hoisted(() => ({
  draftFailure: null as string | null,
  dismiss: vi.fn(),
  tasks: {} as Record<BackendId, Task[]>,
}))

vi.mock('../../../../src/renderer/src/context/SessionDraftContext', () => ({
  useSessionDraft: () => ({
    draftIssue: context.draftFailure ? { title: 'Session draft isn’t being saved', message: context.draftFailure } : null,
    dismissDraftIssue: context.dismiss,
  }),
}))

vi.mock('../../../../src/renderer/src/context/QueueContext', () => ({
  useQueue: () => ({ tasks: context.tasks }),
}))

const { AppStatusNotices } = await import(
  '../../../../src/renderer/src/components/AppStatusNotices'
)
const { reportOperationalFailure } = await import(
  '../../../../src/renderer/src/utils/operationalFailure'
)

function task(id: string, status: TaskStatus): Task {
  return {
    id,
    prompt: 'prompt',
    backend: 'openai',
    model: 'model',
    params: {},
    status,
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    imagePath: null,
    baseName: null,
    error: status === 'failed' ? 'provider error' : null,
  }
}

function queues(tasks: Task[] = []): Record<BackendId, Task[]> {
  return { openai: tasks, nanobanana: [], grok: [], flux: [], drawthings: [] }
}

beforeEach(() => {
  context.draftFailure = null
  context.dismiss.mockReset()
  context.tasks = queues()
  window.electronAPI = {
    resumeInterruptedTasks: vi.fn(async () => 0),
    appLog: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI
})

afterEach(cleanup)

describe('AppStatusNotices', () => {
  it('keeps a dismissible draft-save error in the app shell', () => {
    context.draftFailure = 'Recent changes could not be saved.'
    render(<AppStatusNotices />)

    expect(screen.getByRole('alert').textContent).toContain('Session draft isn’t being saved')
    fireEvent.click(screen.getByRole('button', { name: 'Close session draft result' }))
    expect(context.dismiss).toHaveBeenCalledOnce()
  })

  it('summarizes failed and stopped work across queues without replacing row detail', async () => {
    context.tasks = queues([
      task('failed-a', 'failed'),
      task('failed-b', 'failed'),
      task('stopped', 'interrupted'),
    ])
    render(<AppStatusNotices />)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('2 tasks failed and 1 task stopped before completion')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry stopped' }))
    })
    expect(window.electronAPI.resumeInterruptedTasks).toHaveBeenCalledOnce()
  })

  it('renders nothing when persistence and every queue are healthy', () => {
    const { container } = render(<AppStatusNotices />)
    expect(container.innerHTML).toBe('')
  })

  it('owns background mutation failures without exposing hostile diagnostics', async () => {
    render(<AppStatusNotices />)
    reportOperationalFailure(
      'task-sentinel',
      'The task could not be removed. The queue is unchanged; try again.',
      'Failed to remove task',
      new Error('EACCES /private/tmp/IMAGEQUEUE_QUEUE_SENTINEL'),
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('queue is unchanged')
    expect(alert.textContent).not.toContain('IMAGEQUEUE_QUEUE_SENTINEL')
    expect(window.electronAPI.appLog).toHaveBeenCalledWith(
      'error',
      'Failed to remove task',
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('IMAGEQUEUE_QUEUE_SENTINEL') }) }),
    )
  })

  it('retains independent task results instead of replacing the earlier failure', async () => {
    render(<AppStatusNotices />)
    reportOperationalFailure('task-a', 'Task A could not be removed.', 'remove a failed', new Error('a'))
    reportOperationalFailure('task-b', 'Task B could not be retried.', 'retry b failed', new Error('b'))
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(screen.getByText('Task A could not be removed.')).toBeTruthy()
    expect(screen.getByText('Task B could not be retried.')).toBeTruthy()
  })
})
