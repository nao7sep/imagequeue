import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { UiState } from '../../../shared/ui-state'
import { defaultUiState } from '../../../shared/ui-state'
import { Modal } from '../components/Modal'
import { reportOperationalFailure } from '../utils/operationalFailure'

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
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loadRevision, setLoadRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getUiState().then((state) => {
      if (!cancelled) { setUiState(state); setLoaded(true); setLoadError(false) }
    }).catch((error) => {
      if (!cancelled) { setLoadError(true); reportOperationalFailure('ui-state', 'Window preferences could not be loaded. Nothing was changed; try again.', 'Failed to load UI state', error) }
    })
    return () => {
      cancelled = true
    }
  }, [loadRevision])

  const patchUiState = useCallback((patch: Partial<UiState>): void => {
    void window.electronAPI.updateUiState(patch)
      .then(() => setUiState((prev) => ({ ...prev, ...patch })))
      .catch((error) => reportOperationalFailure('ui-state', 'Window preferences could not be saved. The previous values are still active; try again.', 'Failed to persist UI state', error))
  }, [])

  return (
    <UiStateContext.Provider value={{ uiState, patchUiState }}>
      {loaded ? children : loadError ? (
        <Modal title="Window preferences could not be loaded" onClose={() => setLoadRevision((value) => value + 1)} dismissable={false} closeOnBackdropClick={false} footer={<button className="modal-btn" autoFocus onClick={() => setLoadRevision((value) => value + 1)}>Retry</button>}>
          <div className="modal-body"><p role="alert">Window preferences could not be loaded. Nothing was changed; try again.</p></div>
        </Modal>
      ) : null}
    </UiStateContext.Provider>
  )
}

export function useUiState(): UiStateContextValue {
  const ctx = useContext(UiStateContext)
  if (!ctx) throw new Error('useUiState must be used within UiStateProvider')
  return ctx
}
