import { getVisibleBackendColumns, getVisiblePanes, type PaneId } from '../../../shared/layout-metrics'
import type { BackendId, CloudBackendId } from '../../../shared/types'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER, type ApiKeyPresence, type Task } from '../../../shared/types'
import type { Platform } from '../../../shared/electron-api'

// Which panes the right-hand group shows, and which of them are backends. This
// is the single source of truth for what a column NUMBER maps to — the Cmd+N
// shortcuts, the shortcut reference, arrow navigation between columns, and
// Send-to-All all derive from it, so a hidden backend can never be reached by a
// keystroke aimed at a column the user cannot see. The rule itself lives in
// shared/layout-metrics, which is also where the window minimum comes from, so
// the size of the window and the panes drawn in it cannot disagree.

/** Cloud backends whose key resolves. `null` presence (not yet loaded) counts
 *  every backend as keyed, so no column vanishes for a moment at startup — the
 *  same not-yet-known-is-not-absent rule hasApiKeyFor applies to readiness. */
function keyedCloudBackends(presence: ApiKeyPresence | null): CloudBackendId[] {
  if (!presence) return [...CLOUD_BACKEND_IDS_IN_UI_ORDER]
  return CLOUD_BACKEND_IDS_IN_UI_ORDER.filter((id) => presence.image[id] === true)
}

/** Cloud backends holding at least one task — kept visible whatever their key,
 *  so work in flight is never hidden. */
function occupiedCloudBackends(tasks: Record<BackendId, Task[]> | null): CloudBackendId[] {
  if (!tasks) return []
  return CLOUD_BACKEND_IDS_IN_UI_ORDER.filter((id) => (tasks[id]?.length ?? 0) > 0)
}

function currentPlatform(): Platform {
  // 'unknown' is not a real Platform, but any value other than 'darwin' takes
  // the non-mac branch (Draw Things hidden), which is the correct fallback when
  // the platform is unavailable.
  return ((typeof window !== 'undefined' && window.electronAPI?.platform) || 'unknown') as Platform
}

export function getVisiblePanesForUi(
  presence: ApiKeyPresence | null,
  tasks: Record<BackendId, Task[]> | null
): PaneId[] {
  return getVisiblePanes(currentPlatform(), keyedCloudBackends(presence), occupiedCloudBackends(tasks))
}

export function getVisibleBackends(
  presence: ApiKeyPresence | null = null,
  tasks: Record<BackendId, Task[]> | null = null
): BackendId[] {
  return getVisibleBackendColumns(getVisiblePanesForUi(presence, tasks))
}
