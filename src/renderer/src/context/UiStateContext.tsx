import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { UiState } from '../../../shared/ui-state'
import { defaultUiState } from '../../../shared/ui-state'

// The renderer's view of state.json — the adjustments the app remembers on the
// user's behalf (column width, notification volume), as opposed to the settings
// it saves for them. One hydration and one writer for the whole window, so two
// surfaces showing the same value (the volume slider appears in both the prompt
// pane and Settings) cannot drift apart.
//
// The state starts at its defaults rather than null: every field has a real
// default, so there is nothing a consumer could usefully do with "not yet
// known", and this keeps the default in exactly one place (defaultUiState).

interface UiStateContextValue {
  uiState: UiState
  /** Patch and persist. The local value updates immediately; the write follows. */
  patchUiState: (patch: Partial<UiState>) => void
}

const UiStateContext = createContext<UiStateContextValue | null>(null)

export function UiStateProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [uiState, setUiState] = useState<UiState>(defaultUiState)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getUiState().then((state) => {
      if (!cancelled) setUiState(state)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const patchUiState = useCallback((patch: Partial<UiState>): void => {
    setUiState((prev) => ({ ...prev, ...patch }))
    void window.electronAPI.updateUiState(patch)
  }, [])

  return (
    <UiStateContext.Provider value={{ uiState, patchUiState }}>{children}</UiStateContext.Provider>
  )
}

export function useUiState(): UiStateContextValue {
  const ctx = useContext(UiStateContext)
  if (!ctx) throw new Error('useUiState must be used within UiStateProvider')
  return ctx
}
