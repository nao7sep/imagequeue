import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { BackendId } from '../../../shared/types'

export type PromptMode = 'as-is' | 'elaborated' | 'fresh-iteration' | 'fresh-task'
export type TargetScope = 'selected' | 'all-proprietary' | 'all-drawthings' | 'all'

export interface AdvancedPromptingState {
  seed: string
  selectedContentElaboratorId: string | null
  selectedCompositionElaboratorId: string | null
  selectedStyleElaboratorId: string | null
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
  // Prompts manager modal and persisted in session.json for session resume.
  elaboratedPrompts: string[]
}

function emptyState(): AdvancedPromptingState {
  return {
    seed: '',
    selectedContentElaboratorId: null,
    selectedCompositionElaboratorId: null,
    selectedStyleElaboratorId: null,
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

  useEffect(() => {
    let cancelled = false

    const hydrateSessionPrompts = async (resetAll: boolean): Promise<void> => {
      const elaboratedPrompts = await window.electronAPI.getSessionElaboratedPrompts()
      if (cancelled) return
      setState((prev) => resetAll ? { ...emptyState(), elaboratedPrompts } : { ...prev, elaboratedPrompts })
    }

    void hydrateSessionPrompts(false)

    const unsubscribe = window.electronAPI.onSessionChanged(() => {
      void hydrateSessionPrompts(true)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
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
