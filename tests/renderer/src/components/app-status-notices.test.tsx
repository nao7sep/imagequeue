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

  it('logs the original retry diagnostic while keeping hostile details out of the result', async () => {
    context.tasks = queues([task('stopped', 'interrupted')])
    const hostile = new Error('EACCES /private/tmp/IMAGEQUEUE_RETRY_SENTINEL')
    vi.mocked(window.electronAPI.resumeInterruptedTasks).mockRejectedValueOnce(hostile)
    render(<AppStatusNotices />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry stopped' }))
    })

    expect(screen.getByRole('alert').textContent).toContain('Retrying the stopped tasks failed.')
    expect(screen.getByRole('alert').textContent).not.toContain('IMAGEQUEUE_RETRY_SENTINEL')
    expect(window.electronAPI.appLog).toHaveBeenCalledWith(
      'error',
      'Failed to retry stopped tasks',
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('IMAGEQUEUE_RETRY_SENTINEL') }) }),
    )
  })

  it('renders nothing when persistence and every queue are healthy', () => {
    const { container } = render(<AppStatusNotices />)
    expect(container.innerHTML).toBe('')
  })

  it('owns shell-level background failures without exposing hostile diagnostics', async () => {
    render(<AppStatusNotices />)
    reportOperationalFailure(
      'output-folder',
      'The output folder could not be opened. Check that it is still available.',
      'Failed to open output folder',
      new Error('EACCES /private/tmp/IMAGEQUEUE_FOLDER_SENTINEL'),
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('output folder could not be opened')
    expect(alert.textContent).not.toContain('IMAGEQUEUE_FOLDER_SENTINEL')
    expect(window.electronAPI.appLog).toHaveBeenCalledWith(
      'error',
      'Failed to open output folder',
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('IMAGEQUEUE_FOLDER_SENTINEL') }) }),
    )
  })

  it('retains independent shell results instead of replacing the earlier failure', async () => {
    render(<AppStatusNotices />)
    reportOperationalFailure('ui-state', 'Window preferences could not be saved.', 'UI state failed', new Error('a'))
    reportOperationalFailure('output-folder', 'The output folder could not be opened.', 'Folder open failed', new Error('b'))
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(screen.getByText('Window preferences could not be saved.')).toBeTruthy()
    expect(screen.getByText('The output folder could not be opened.')).toBeTruthy()
  })
})
