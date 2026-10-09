import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ElaboratedPromptRecord } from '../../../shared/types'
import { createEmptySessionDraft, type SessionDraft } from '../../../shared/session-draft'
import { serializeError } from '../../../shared/serialize-error'
import type { MessageKey } from '../../../shared/i18n/catalogues'

// The renderer's working state for the active session: the SessionDraft fields
// (main prompt + Advanced Prompting selections) plus the elaborated-prompts
// history. The draft fields go to the main process as the user types, which
// keeps each session's draft for the running app only, so switching sessions
// restores it and a restart starts empty. elaboratedPrompts are committed
// results, written to session.json immediately on each append/delete/clear.
// Both re-hydrate on session change.
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
  // A catalogue key, rendered where it is shown.
  draftUnavailable: MessageKey | null
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

// The draft could not be loaded, or an elaborated-prompt change could not be
// saved; either way the working state no longer matches main until a retry.
interface DraftFailure {
  message: MessageKey
}

function logDraftFailure(message: string, error: unknown): void {
  void window.electronAPI.appLog('error', message, { error: serializeError(error) })
    .catch((logError) => console.error('Failed to record a session draft diagnostic', logError))
}

export function SessionDraftProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<SessionDraftState>(emptyState)
  const [draftFailure, setDraftFailure] = useState<DraftFailure | null>(null)
  const [hydrateRetry, setHydrateRetry] = useState(0)
  const draftUnavailable = draftFailure?.message ?? null
  // Guards the send effect: stays false until the first hydrate completes, and
  // tracks the last draft sent so re-applying a hydrated draft doesn't
  // immediately echo it back.
  const loadedRef = useRef(false)
  const lastPersistedDraftRef = useRef('')

  useEffect(() => {
    let cancelled = false
    let hydrateRevision = 0

    const hydrate = async (): Promise<void> => {
      const revision = ++hydrateRevision
      loadedRef.current = false
      try {
        const [draft, elaboratedPrompts] = await Promise.all([
          window.electronAPI.getSessionDraft(),
          window.electronAPI.getSessionElaboratedPrompts(),
        ])
        if (cancelled || revision !== hydrateRevision) return
        setDraftFailure(null)
        lastPersistedDraftRef.current = JSON.stringify(draft)
        loadedRef.current = true
        setState({ ...draft, elaboratedPrompts })
      } catch (error) {
        if (cancelled || revision !== hydrateRevision) return
        setState(emptyState())
        lastPersistedDraftRef.current = ''
        setDraftFailure({ message: 'draft.hydrationFailed' })
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
    }
  }, [hydrateRetry])

  // The draft fields go to main on every change; main only keeps them in
  // memory, so there is nothing to debounce. elaboratedPrompts are excluded —
  // they persist through their own immediate path below. A send that fails
  // leaves main with an earlier draft, which only matters if the user switches
  // sessions before the next change; it is logged, not announced.
  const draftSnapshot = JSON.stringify(extractDraft(state))
  useEffect(() => {
    if (!loadedRef.current) return
    if (draftSnapshot === lastPersistedDraftRef.current) return
    lastPersistedDraftRef.current = draftSnapshot
    void window.electronAPI.saveSessionDraft(JSON.parse(draftSnapshot) as SessionDraft)
      .catch((error) => logDraftFailure('Failed to send the session draft to the main process', error))
  }, [draftSnapshot])

  const retryDraftHydration = useCallback((): void => setHydrateRetry((value) => value + 1), [])

  const handleDraftMutationFailure = useCallback((operation: string, error: unknown): void => {
    loadedRef.current = false
    setDraftFailure({ message: 'draft.mutationFailed' })
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
