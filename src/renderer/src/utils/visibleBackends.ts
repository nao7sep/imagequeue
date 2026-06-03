import { BACKEND_IDS_IN_UI_ORDER, type BackendId } from '../../../shared'

// Backends shown as columns, in UI order. Draw Things is macOS-only, so it is
// hidden on other platforms. This is the single source of truth for which
// backends a column number maps to — keyboard shortcuts and selection
// navigation must both derive from it so an off-macOS column index can never
// resolve to the hidden Draw Things backend.
export function getVisibleBackends(): BackendId[] {
  const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  return isMac ? BACKEND_IDS_IN_UI_ORDER : BACKEND_IDS_IN_UI_ORDER.filter((b) => b !== 'drawthings')
}
