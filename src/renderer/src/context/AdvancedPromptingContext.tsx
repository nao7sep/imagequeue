import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { BackendId } from '../../../shared/types'

export type PromptMode = 'as-is' | 'elaborated' | 'fresh-iteration' | 'fresh-task'
export type TargetScope = 'selected' | 'all-proprietary' | 'all-drawthings' | 'all'

export interface AdvancedPromptingState {
  seed: string
  selectedElaboratorId: string | null
  elaborated: string
  override: string
  selectedProprietary: Record<BackendId, boolean>
  selectedDtFiles: string[]
  promptMode: PromptMode
  targetScope: TargetScope
  count: number
  // Source of truth for the elaborated-prompts history within this session.
  // Fed to the brainstorm orchestrator as previousPrompts on each call so the
  // text AI avoids repeats across separate clicks. Also shown in the Generated
  // Prompts manager modal. There is exactly one copy of this list.
  elaboratedPrompts: string[]
}

function emptyState(): AdvancedPromptingState {
  return {
    seed: '',
    selectedElaboratorId: null,
    elaborated: '',
    override: '',
    selectedProprietary: {
      openai: false, imagen: false, nanobanana: false, grok: false, flux: false, drawthings: false,
    },
    selectedDtFiles: [],
    promptMode: 'as-is',
    targetScope: 'selected',
    count: 1,
    elaboratedPrompts: [],
  }
}

interface AdvancedPromptingContextValue {
  state: AdvancedPromptingState
  // Partial updates to one or more fields. Use the function form when next
  // value depends on previous (e.g. toggling a Set membership).
  update: (patch: Partial<AdvancedPromptingState>) => void
  updateWith: (fn: (prev: AdvancedPromptingState) => AdvancedPromptingState) => void
  appendElaboratedPrompts: (prompts: string[]) => void
  deleteElaboratedPromptAt: (index: number) => void
  clearElaboratedPrompts: () => void
}

const AdvancedPromptingContext = createContext<AdvancedPromptingContextValue | null>(null)

export function AdvancedPromptingProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AdvancedPromptingState>(emptyState)

  // Reset on session change. The advanced-prompting state is intentionally
  // not persisted to disk and not scoped per-modal-open — it lives for the
  // duration of one session and is wiped when the session boundary moves.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSessionChanged(() => {
      setState(emptyState())
    })
    return unsubscribe
  }, [])

  const update = useCallback((patch: Partial<AdvancedPromptingState>): void => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const updateWith = useCallback((fn: (prev: AdvancedPromptingState) => AdvancedPromptingState): void => {
    setState(fn)
  }, [])

  const appendElaboratedPrompts = useCallback((prompts: string[]): void => {
    if (prompts.length === 0) return
    setState((prev) => ({ ...prev, elaboratedPrompts: [...prev.elaboratedPrompts, ...prompts] }))
  }, [])

  const deleteElaboratedPromptAt = useCallback((index: number): void => {
    setState((prev) => {
      if (index < 0 || index >= prev.elaboratedPrompts.length) return prev
      const next = prev.elaboratedPrompts.slice()
      next.splice(index, 1)
      return { ...prev, elaboratedPrompts: next }
    })
  }, [])

  const clearElaboratedPrompts = useCallback((): void => {
    setState((prev) => ({ ...prev, elaboratedPrompts: [] }))
  }, [])

  return (
    <AdvancedPromptingContext.Provider
      value={{ state, update, updateWith, appendElaboratedPrompts, deleteElaboratedPromptAt, clearElaboratedPrompts }}
    >
      {children}
    </AdvancedPromptingContext.Provider>
  )
}

export function useAdvancedPrompting(): AdvancedPromptingContextValue {
  const ctx = useContext(AdvancedPromptingContext)
  if (!ctx) throw new Error('useAdvancedPrompting must be used within AdvancedPromptingProvider')
  return ctx
}
