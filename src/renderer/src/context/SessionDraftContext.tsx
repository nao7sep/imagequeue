import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createEmptySessionDraft, type SessionDraft } from '../../../shared/session-draft'

// The renderer's working state for the active session: the SessionDraft fields
// (main prompt + Advanced Prompting selections) plus the elaborated-prompts
// history. The two persist on different cadences — the draft fields write
// through as the user types (coalesced by the main process), while
// elaboratedPrompts are committed results written immediately on each
// append/delete/clear. Both live in session.json and re-hydrate on session
// change, so resuming a session restores the full working context.
export interface SessionDraftState extends SessionDraft {
  elaboratedPrompts: string[]
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
  // Partial updates to one or more fields. Use the function form when the next
  // value depends on the previous (e.g. toggling a Set membership).
  update: (patch: Partial<SessionDraftState>) => void
  updateWith: (fn: (prev: SessionDraftState) => SessionDraftState) => void
  appendElaboratedPrompts: (prompts: string[]) => void
  deleteElaboratedPromptAt: (index: number) => void
  clearElaboratedPrompts: () => void
}

const SessionDraftContext = createContext<SessionDraftContextValue | null>(null)

export function SessionDraftProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<SessionDraftState>(emptyState)
  // Guards the write-through effect: stays false until the first hydrate
  // completes, and tracks the last draft we persisted so re-applying a hydrated
  // draft doesn't immediately echo back a redundant save.
  const loadedRef = useRef(false)
  const lastPersistedDraftRef = useRef('')

  useEffect(() => {
    let cancelled = false

    const hydrate = async (): Promise<void> => {
      const [draft, elaboratedPrompts] = await Promise.all([
        window.electronAPI.getSessionDraft(),
        window.electronAPI.getSessionElaboratedPrompts(),
      ])
      if (cancelled) return
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
    void window.electronAPI.saveSessionDraft(JSON.parse(draftSnapshot) as SessionDraft).catch((error) => {
      void window.electronAPI.appLog('error', 'Failed to persist session draft', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, [draftSnapshot])

  const update = useCallback((patch: Partial<SessionDraftState>): void => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const updateWith = useCallback((fn: (prev: SessionDraftState) => SessionDraftState): void => {
    setState(fn)
  }, [])

  const appendElaboratedPrompts = useCallback((prompts: string[]): void => {
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
      value={{ state, update, updateWith, appendElaboratedPrompts, deleteElaboratedPromptAt, clearElaboratedPrompts }}
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
