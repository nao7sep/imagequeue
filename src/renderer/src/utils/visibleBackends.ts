import { getVisibleBackendsForPlatform, type BackendId } from '../../../shared'
import type { Platform } from '../../../shared/electron-api'

// Backends shown as columns, in UI order. Draw Things is macOS-only, so it is
// hidden on other platforms. This is the single source of truth for which
// backends a column number maps to — keyboard shortcuts and selection
// navigation must both derive from it so an off-macOS column index can never
// resolve to the hidden Draw Things backend. The actual filter rule lives in
// shared/layout-metrics (getVisibleBackendsForPlatform) so the window's
// minimum-width column count can never disagree with what the UI renders.
export function getVisibleBackends(): BackendId[] {
  // 'unknown' is not a real Platform, but any value other than 'darwin' takes
  // the non-mac branch (Draw Things hidden), which is the correct fallback when
  // the platform is unavailable.
  const platform = (typeof window !== 'undefined' && window.electronAPI?.platform) || 'unknown'
  return getVisibleBackendsForPlatform(platform as Platform)
}
