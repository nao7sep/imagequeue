// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliJobKind } from '../../../../src/shared/cli-jobs'

const context = vi.hoisted(() => ({
  jobs: new Map<string, { kind: CliJobKind; target: string }>(),
}))

vi.mock('../../../../src/renderer/src/context/CliJobsContext', () => ({
  useCliJobs: () => ({ jobs: context.jobs, removeJob: vi.fn() }),
}))

const { ToastStack } = await import('../../../../src/renderer/src/components/ToastStack')
const { reportOperationalFailure, clearOperationalFailure } = await import(
  '../../../../src/renderer/src/utils/operationalFailure'
)

function stack(): HTMLElement {
  return screen.getByRole('region', { name: 'Notifications' })
}

function toastTexts(): string[] {
  return [...stack().querySelectorAll('.toast')].map((node) => node.textContent ?? '')
}

beforeEach(() => {
  context.jobs = new Map()
  window.electronAPI = {
    appLog: vi.fn(async () => undefined),
    onCliJobChunk: vi.fn(() => () => {}),
    onCliJobStatus: vi.fn(() => () => {}),
    cliSubscribeJob: vi.fn(async () => null),
    cliUnsubscribeJob: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI
})

afterEach(cleanup)

describe('ToastStack', () => {
  it('renders no stack when nothing has failed, but keeps its live region mounted', () => {
    render(<ToastStack />)
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('')
  })

  it('presents operation failures without hostile diagnostics and without taking focus', () => {
    render(<ToastStack />)
    const before = document.activeElement
    act(() => reportOperationalFailure(
      'sessions-folder',
      'operation.sessionsFolderFailed',
      'Failed to open sessions folder',
      new Error('EACCES /private/tmp/IMAGEQUEUE_FOLDER_SENTINEL'),
    ))
    expect(toastTexts()[0]).toContain('sessions folder could not be opened')
    expect(screen.getByRole('alert').textContent).toContain('sessions folder could not be opened')
    expect(document.body.textContent).not.toContain('IMAGEQUEUE_FOLDER_SENTINEL')
    expect(document.activeElement).toBe(before)
    expect(window.electronAPI.appLog).toHaveBeenCalledWith(
      'error',
      'Failed to open sessions folder',
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('IMAGEQUEUE_FOLDER_SENTINEL') }) }),
    )
  })

  it('keeps every independent failure, with no count limit', () => {
    render(<ToastStack />)
    const keys = ['operation.sessionsFolderFailed', 'operation.enqueueFailed', 'operation.uiStateSaveFailed',
      'operation.fullscreenViewOpenFailed', 'operation.fullscreenViewCloseFailed', 'operation.queueCommandFailed'] as const
    act(() => keys.forEach((key, index) => reportOperationalFailure(`op-${index}`, key, 'failed', new Error(key))))
    expect(toastTexts()).toHaveLength(keys.length)
    expect(stack().textContent).not.toMatch(/more/)
  })

  it('replaces a repeated operation failure in place and moves it to the newest position', () => {
    render(<ToastStack />)
    act(() => {
      reportOperationalFailure('queue-controls-load', 'operation.queueControlsLoadFailed', 'failed', new Error('a'))
      reportOperationalFailure('sessions-folder', 'operation.sessionsFolderFailed', 'failed', new Error('b'))
    })
    act(() => reportOperationalFailure('queue-controls-load', 'operation.queueControlsRefreshFailed', 'failed', new Error('c')))
    const texts = toastTexts()
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('The sessions folder could not be opened.')
    expect(texts[1]).toContain('Queue controls could not be refreshed.')
    expect(stack().textContent).not.toContain('×')
  })

  it('clears a failure when the same operation later succeeds, and nothing else', () => {
    render(<ToastStack />)
    act(() => {
      reportOperationalFailure('ui-state-save', 'operation.uiStateSaveFailed', 'UI state failed', new Error('a'))
      reportOperationalFailure('sessions-folder', 'operation.sessionsFolderFailed', 'Folder open failed', new Error('b'))
    })
    act(() => clearOperationalFailure('ui-state-save'))
    expect(toastTexts()).toEqual([expect.stringContaining('The sessions folder could not be opened.')])
  })

  it('closes one failure at a time', () => {
    render(<ToastStack />)
    act(() => {
      reportOperationalFailure('queue-enqueue', 'operation.enqueueFailed', 'failed', new Error('a'))
      reportOperationalFailure('sessions-folder', 'operation.sessionsFolderFailed', 'failed', new Error('b'))
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Close operation result' })[0])
    expect(toastTexts()).toEqual([expect.stringContaining('The sessions folder could not be opened.')])
  })

  it('stacks failure toasts above the download cards', () => {
    context.jobs = new Map([['job-1', { kind: 'download', target: 'model.ckpt' }]])
    render(<ToastStack />)
    act(() => reportOperationalFailure('queue-enqueue', 'operation.enqueueFailed', 'failed', new Error('x')))
    expect([...stack().children].map((node) => node.className)).toEqual(['toast', 'cli-job-row'])
  })
})
