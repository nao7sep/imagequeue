import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ElaboratedPromptRecord } from '../../../shared/types'
import { createEmptySessionDraft, type SessionDraft } from '../../../shared/session-draft'
import { serializeError } from '../../../shared/serialize-error'
import {
  SESSION_DRAFT_PERSISTENCE_ERROR,
  type SessionDraftPersistenceState,
} from '../../../shared/electron-api'

// The renderer's working state for the active session: the SessionDraft fields
// (main prompt + Advanced Prompting selections) plus the elaborated-prompts
// history. The two persist on different cadences — the draft fields write
// through as the user types (coalesced by the main process), while
// elaboratedPrompts are committed results written immediately on each
// append/delete/clear. Both live in session.json and re-hydrate on session
// change, so resuming a session restores the full working context.
export interface SessionDraftState extends SessionDraft {
  elaboratedPrompts: ElaboratedPromptRecord[]
}

function emptyState(): SessionDraftState {
  return { ...createEmptySessionDraft(), elaboratedPrompts: [] }
}

function extractDraft(state: SessionDraftState): SessionDraft {
  const { elaboratedPrompts: _elaboratedPrompts, ...draft } = state
  return draft
}

interface SessionDraftContextValue {
  state: SessionDraftState
  draftIssue: { title: string; message: string } | null
  dismissDraftIssue: () => void
  draftUnavailable: string | null
  retryDraftHydration: () => void
  // Partial updates to one or more fields. Use the function form when the next
  // value depends on the previous (e.g. toggling a Set membership).
  update: (patch: Partial<SessionDraftState>) => void
  updateWith: (fn: (prev: SessionDraftState) => SessionDraftState) => void
  appendElaboratedPrompts: (prompts: ElaboratedPromptRecord[]) => void
  deleteElaboratedPromptAt: (index: number) => void
  clearElaboratedPrompts: () => void
}

const SessionDraftContext = createContext<SessionDraftContextValue | null>(null)

interface DraftPersistenceFailure {
  message: string
  source: 'disk' | 'ipc' | 'hydrate' | 'mutation'
}

const SESSION_DRAFT_HYDRATION_ERROR =
  'The active session’s draft could not be loaded. Switch sessions and return, or restart ImageQueue; no saved session data was changed.'

function logDraftFailure(message: string, error: unknown): void {
  void window.electronAPI.appLog('error', message, { error: serializeError(error) })
    .catch((logError) => console.error('Failed to record a session draft diagnostic', logError))
}

export function SessionDraftProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<SessionDraftState>(emptyState)
  const [draftPersistenceFailureState, setDraftPersistenceFailureState] =
    useState<DraftPersistenceFailure | null>(null)
  const [hydrateRetry, setHydrateRetry] = useState(0)
  const draftUnavailable = draftPersistenceFailureState?.source === 'hydrate' || draftPersistenceFailureState?.source === 'mutation'
    ? draftPersistenceFailureState.message
    : null
  const draftIssue = draftPersistenceFailureState && draftPersistenceFailureState.source !== 'hydrate' && draftPersistenceFailureState.source !== 'mutation'
    ? {
        title: 'Session draft isn’t being saved',
        message: draftPersistenceFailureState.message,
      }
    : null
  // Guards the write-through effect: stays false until the first hydrate
  // completes, and tracks the last draft we persisted so re-applying a hydrated
  // draft doesn't immediately echo back a redundant save.
  const loadedRef = useRef(false)
  const lastPersistedDraftRef = useRef('')

  useEffect(() => {
    let cancelled = false
    let hydrateRevision = 0

    const applyPersistenceState = (next: SessionDraftPersistenceState): void => {
      if (cancelled) return
      setDraftPersistenceFailureState(
        (current) => current?.source === 'hydrate' || current?.source === 'mutation'
          ? current
          : next.status === 'failed' ? { message: next.message, source: 'disk' } : null,
      )
    }

    const unsubscribePersistence = window.electronAPI.onSessionDraftPersistenceState(
      applyPersistenceState,
    )

    const hydrate = async (): Promise<void> => {
      const revision = ++hydrateRevision
      loadedRef.current = false
      try {
        const [draft, elaboratedPrompts, persistenceState] = await Promise.all([
          window.electronAPI.getSessionDraft(),
          window.electronAPI.getSessionElaboratedPrompts(),
          window.electronAPI.getSessionDraftPersistenceState(),
        ])
        if (cancelled || revision !== hydrateRevision) return
        setDraftPersistenceFailureState(null)
        applyPersistenceState(persistenceState)
        lastPersistedDraftRef.current = JSON.stringify(draft)
        loadedRef.current = true
        setState({ ...draft, elaboratedPrompts })
      } catch (error) {
        if (cancelled || revision !== hydrateRevision) return
        setState(emptyState())
        lastPersistedDraftRef.current = ''
        setDraftPersistenceFailureState({
          message: SESSION_DRAFT_HYDRATION_ERROR,
          source: 'hydrate',
        })
        logDraftFailure('Failed to hydrate the active session draft', error)
      }
    }

    void hydrate()

    // New session / resume into another swaps the whole draft: re-hydrate from
    // the now-active session's manifest.
    const unsubscribe = window.electronAPI.onSessionChanged(() => {
      void hydrate()
    })

    return () => {
      cancelled = true
      unsubscribe()
      unsubscribePersistence()
    }
  }, [hydrateRetry])

  // Write-through for the draft fields. The main process coalesces rapid writes
  // and flushes on quit, so we send on every change without debouncing here.
  // elaboratedPrompts are excluded — they persist through their own immediate
  // path below.
  const draftSnapshot = JSON.stringify(extractDraft(state))
  useEffect(() => {
    if (!loadedRef.current) return
    if (draftSnapshot === lastPersistedDraftRef.current) return
    lastPersistedDraftRef.current = draftSnapshot
    void window.electronAPI.saveSessionDraft(JSON.parse(draftSnapshot) as SessionDraft)
      .then(() => {
        // A transport failure means main never received the prior draft. Once a
        // later IPC succeeds, main owns the write again; disk failures arrive
        // through the persistence-state event and must not be cleared here.
        setDraftPersistenceFailureState((current) =>
          current?.source === 'ipc' ? null : current
        )
      })
      .catch((error) => {
        setDraftPersistenceFailureState({
          message: SESSION_DRAFT_PERSISTENCE_ERROR,
          source: 'ipc',
        })
        logDraftFailure('Failed to send session draft for persistence', error)
      })
  }, [draftSnapshot])

  const dismissDraftIssue = useCallback((): void => {
    setDraftPersistenceFailureState(null)
  }, [])

  const retryDraftHydration = useCallback((): void => setHydrateRetry((value) => value + 1), [])

  const handleDraftMutationFailure = useCallback((operation: string, error: unknown): void => {
    loadedRef.current = false
    setDraftPersistenceFailureState({
      source: 'mutation',
      message: 'A session draft change could not be saved. Reload the saved draft before continuing; no stored data was replaced.',
    })
    logDraftFailure(operation, error)
  }, [])

  const update = useCallback((patch: Partial<SessionDraftState>): void => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const updateWith = useCallback((fn: (prev: SessionDraftState) => SessionDraftState): void => {
    setState(fn)
  }, [])

  const appendElaboratedPrompts = useCallback((prompts: ElaboratedPromptRecord[]): void => {
    if (prompts.length === 0) return
    setState((prev) => ({ ...prev, elaboratedPrompts: [...prev.elaboratedPrompts, ...prompts] }))
    void window.electronAPI.appendSessionElaboratedPrompts(prompts)
      .catch((error) => handleDraftMutationFailure('Failed to append elaborated prompts', error))
  }, [handleDraftMutationFailure])

  const deleteElaboratedPromptAt = useCallback((index: number): void => {
    setState((prev) => {
      if (index < 0 || index >= prev.elaboratedPrompts.length) return prev
      const next = prev.elaboratedPrompts.slice()
      next.splice(index, 1)
      return { ...prev, elaboratedPrompts: next }
    })
    void window.electronAPI.deleteSessionElaboratedPromptAt(index)
      .catch((error) => handleDraftMutationFailure('Failed to delete elaborated prompt', error))
  }, [handleDraftMutationFailure])

  const clearElaboratedPrompts = useCallback((): void => {
    setState((prev) => ({ ...prev, elaboratedPrompts: [] }))
    void window.electronAPI.clearSessionElaboratedPrompts()
      .catch((error) => handleDraftMutationFailure('Failed to clear elaborated prompts', error))
  }, [handleDraftMutationFailure])

  return (
    <SessionDraftContext.Provider
      value={{
        state,
        draftIssue,
        dismissDraftIssue,
        draftUnavailable,
        retryDraftHydration,
        update,
        updateWith,
        appendElaboratedPrompts,
        deleteElaboratedPromptAt,
        clearElaboratedPrompts,
      }}
    >
      {children}
    </SessionDraftContext.Provider>
  )
}

export function useSessionDraft(): SessionDraftContextValue {
  const ctx = useContext(SessionDraftContext)
  if (!ctx) throw new Error('useSessionDraft must be used within SessionDraftProvider')
  return ctx
}
