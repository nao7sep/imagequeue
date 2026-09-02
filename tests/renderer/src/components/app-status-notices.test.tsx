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
    draftPersistenceFailure: context.draftFailure,
    dismissDraftPersistenceFailure: context.dismiss,
  }),
}))

vi.mock('../../../../src/renderer/src/context/QueueContext', () => ({
  useQueue: () => ({ tasks: context.tasks }),
}))

const { AppStatusNotices } = await import(
  '../../../../src/renderer/src/components/AppStatusNotices'
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
  } as unknown as typeof window.electronAPI
})

afterEach(cleanup)

describe('AppStatusNotices', () => {
  it('keeps a dismissible draft-save error in the app shell', () => {
    context.draftFailure = 'Recent changes could not be saved.'
    render(<AppStatusNotices />)

    expect(screen.getByRole('alert').textContent).toContain('Session draft isn’t being saved')
    fireEvent.click(screen.getByRole('button', { name: 'Close session draft save result' }))
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
})
