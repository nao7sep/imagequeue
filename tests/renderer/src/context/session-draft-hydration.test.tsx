// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionDraftProvider, useSessionDraft } from '../../../../src/renderer/src/context/SessionDraftContext'
import { createEmptySessionDraft } from '../../../../src/shared/session-draft'
import type { ElaboratedPromptRecord } from '../../../../src/shared/types'
import { useI18n } from '../../../../src/renderer/src/i18n/I18nContext'
import { until } from '../../until'

function Probe(): React.JSX.Element {
  const { draftUnavailable, retryDraftHydration } = useSessionDraft()
  const { t } = useI18n()
  return <div>{draftUnavailable && <><span role="alert">{t(draftUnavailable)}</span><button onClick={retryDraftHydration}>Retry</button></>}</div>
}

afterEach(cleanup)

describe('session draft hydration boundary', () => {
  it('blocks unknown draft state with authored recovery and logs hostile diagnostics', async () => {
    window.electronAPI = {
      getSessionDraft: vi.fn(async () => { throw new Error('EACCES /private/tmp/IMAGEQUEUE_DRAFT_SENTINEL') }),
      getSessionElaboratedPrompts: vi.fn(async () => []),
      getSessionDraftPersistenceState: vi.fn(async () => ({ status: 'ok' as const })),
      onSessionDraftPersistenceState: vi.fn(() => () => undefined),
      onSessionChanged: vi.fn(() => () => undefined),
      appLog: vi.fn(async () => undefined),
    } as unknown as typeof window.electronAPI

    render(<SessionDraftProvider><Probe /></SessionDraftProvider>)

    const alert = await until(() => screen.getByRole('alert'))
    expect(alert.textContent).toContain('no saved session data was changed')
    expect(alert.textContent).not.toContain('IMAGEQUEUE_DRAFT_SENTINEL')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(window.electronAPI.appLog).toHaveBeenCalledWith(
      'error',
      'Failed to hydrate the active session draft',
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('IMAGEQUEUE_DRAFT_SENTINEL') }) }),
    )
  })
})


function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture(): { context: () => ReturnType<typeof useSessionDraft>; changed: () => void } {
  let latest!: ReturnType<typeof useSessionDraft>
  let changed!: () => void
  window.electronAPI = {
    getSessionDraft: vi.fn(async () => ({ ...createEmptySessionDraft(), prompt: 'saved' })),
    getSessionElaboratedPrompts: vi.fn(async () => [{ text: 'first', concepts: [] }, { text: 'second', concepts: [] }]),
    saveSessionDraft: vi.fn(async () => {}),
    appendSessionElaboratedPrompts: vi.fn(async () => []),
    deleteSessionElaboratedPromptAt: vi.fn(async () => []),
    clearSessionElaboratedPrompts: vi.fn(async () => []),
    onSessionChanged: vi.fn((callback: () => void) => { changed = callback; return () => {} }),
    appLog: vi.fn(async () => {}),
  } as unknown as typeof window.electronAPI
  function Capture(): null { latest = useSessionDraft(); return null }
  render(<SessionDraftProvider><Capture /></SessionDraftProvider>)
  return { context: () => latest, changed: () => changed() }
}

it('gates edits throughout hydration and session switching, then sends admitted typing', async () => {
  const { context, changed } = fixture()
  act(() => context().update({ prompt: 'not admitted' }))
  await act(async () => {})
  expect(context().state.prompt).toBe('saved')
  expect(window.electronAPI.saveSessionDraft).not.toHaveBeenCalled()
  act(() => context().update({ prompt: 'new typing' }))
  expect(window.electronAPI.saveSessionDraft).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'new typing' }))
  const pending = deferred<ReturnType<typeof createEmptySessionDraft>>()
  vi.mocked(window.electronAPI.getSessionDraft).mockReturnValueOnce(pending.promise)
  act(changed)
  act(() => context().update({ prompt: 'not admitted in next session' }))
  await act(async () => pending.resolve({ ...createEmptySessionDraft(), prompt: 'next session' }))
  expect(context().state.prompt).toBe('next session')
  expect(window.electronAPI.saveSessionDraft).toHaveBeenCalledTimes(1)
})

it('recovers from a failed hydration through Retry without echoing its snapshot', async () => {
  const { context, changed } = fixture()
  await act(async () => {})
  vi.mocked(window.electronAPI.getSessionDraft).mockRejectedValueOnce(new Error('unavailable'))
  await act(async () => changed())
  expect(context().draftUnavailable).toBe('draft.hydrationFailed')
  act(() => context().update({ prompt: 'blocked' }))
  await act(async () => context().retryDraftHydration())
  expect(context().draftUnavailable).toBeNull()
  expect(context().state.prompt).toBe('saved')
  expect(window.electronAPI.saveSessionDraft).not.toHaveBeenCalled()
})

it.each(['append', 'delete', 'clear'] as const)('blocks after failed history %s and reloads the retained main snapshot', async (operation) => {
  const { context } = fixture()
  await act(async () => {})
  const record: ElaboratedPromptRecord = { text: 'paid prompt', concepts: [] }
  const method = operation === 'append' ? 'appendSessionElaboratedPrompts' : operation === 'delete' ? 'deleteSessionElaboratedPromptAt' : 'clearSessionElaboratedPrompts'
  vi.mocked(window.electronAPI[method]).mockRejectedValueOnce(new Error('storage failed'))
  await act(async () => {
    if (operation === 'append') context().appendElaboratedPrompts([record])
    else if (operation === 'delete') context().deleteElaboratedPromptAt(0)
    else context().clearElaboratedPrompts()
  })
  expect(context().draftUnavailable).toBe('draft.mutationFailed')
  const retained = context().state.elaboratedPrompts
  expect(retained.map((item) => item.text)).toEqual(operation === 'append' ? ['first', 'second', 'paid prompt'] : operation === 'delete' ? ['second'] : [])
  act(() => context().update({ prompt: 'blocked until reload' }))
  expect(context().state.prompt).toBe('saved')
  vi.mocked(window.electronAPI.getSessionElaboratedPrompts).mockResolvedValueOnce(retained)
  await act(async () => context().retryDraftHydration())
  expect(context().draftUnavailable).toBeNull()
  expect(context().state.elaboratedPrompts).toEqual(retained)
  act(() => context().update({ prompt: 'editable again' }))
  expect(window.electronAPI.saveSessionDraft).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'editable again' }))
})

it('keeps a previous session mutation failure out of the newly hydrated session', async () => {
  const { context, changed } = fixture()
  await act(async () => {})
  const pending = deferred<ElaboratedPromptRecord[]>()
  vi.mocked(window.electronAPI.clearSessionElaboratedPrompts).mockReturnValueOnce(pending.promise)
  act(() => context().clearElaboratedPrompts())
  await act(async () => changed())
  await act(async () => pending.reject(new Error('previous session write failed')))
  expect(context().draftUnavailable).toBeNull()
  expect(window.electronAPI.appLog).toHaveBeenCalled()
})
