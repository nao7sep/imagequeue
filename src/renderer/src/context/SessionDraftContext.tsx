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
  draftPersistenceFailure: string | null
  dismissDraftPersistenceFailure: () => void
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
  source: 'disk' | 'ipc'
}

export function SessionDraftProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<SessionDraftState>(emptyState)
  const [draftPersistenceFailureState, setDraftPersistenceFailureState] =
    useState<DraftPersistenceFailure | null>(null)
  const draftPersistenceFailure = draftPersistenceFailureState?.message ?? null
  // Guards the write-through effect: stays false until the first hydrate
  // completes, and tracks the last draft we persisted so re-applying a hydrated
  // draft doesn't immediately echo back a redundant save.
  const loadedRef = useRef(false)
  const lastPersistedDraftRef = useRef('')

  useEffect(() => {
    let cancelled = false

    const applyPersistenceState = (next: SessionDraftPersistenceState): void => {
      if (cancelled) return
      setDraftPersistenceFailureState(
        next.status === 'failed' ? { message: next.message, source: 'disk' } : null,
      )
    }

    const unsubscribePersistence = window.electronAPI.onSessionDraftPersistenceState(
      applyPersistenceState,
    )

    const hydrate = async (): Promise<void> => {
      const [draft, elaboratedPrompts, persistenceState] = await Promise.all([
        window.electronAPI.getSessionDraft(),
        window.electronAPI.getSessionElaboratedPrompts(),
        window.electronAPI.getSessionDraftPersistenceState(),
      ])
      if (cancelled) return
      applyPersistenceState(persistenceState)
      lastPersistedDraftRef.current = JSON.stringify(draft)
      loadedRef.current = true
      setState({ ...draft, elaboratedPrompts })
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
  }, [])

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
        void window.electronAPI.appLog('error', 'Failed to send session draft for persistence', {
          error: serializeError(error),
        })
      })
  }, [draftSnapshot])

  const dismissDraftPersistenceFailure = useCallback((): void => {
    setDraftPersistenceFailureState(null)
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
  }, [])

  const deleteElaboratedPromptAt = useCallback((index: number): void => {
    setState((prev) => {
      if (index < 0 || index >= prev.elaboratedPrompts.length) return prev
      const next = prev.elaboratedPrompts.slice()
      next.splice(index, 1)
      return { ...prev, elaboratedPrompts: next }
    })
    void window.electronAPI.deleteSessionElaboratedPromptAt(index)
  }, [])

  const clearElaboratedPrompts = useCallback((): void => {
    setState((prev) => ({ ...prev, elaboratedPrompts: [] }))
    void window.electronAPI.clearSessionElaboratedPrompts()
  }, [])

  return (
    <SessionDraftContext.Provider
      value={{
        state,
        draftPersistenceFailure,
        dismissDraftPersistenceFailure,
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
