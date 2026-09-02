// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionDraftProvider, useSessionDraft } from '../../../../src/renderer/src/context/SessionDraftContext'

function Probe(): React.JSX.Element {
  const { draftUnavailable, retryDraftHydration } = useSessionDraft()
  return <div>{draftUnavailable && <><span role="alert">{draftUnavailable}</span><button onClick={retryDraftHydration}>Retry</button></>}</div>
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

    const alert = await screen.findByRole('alert')
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
