import { useMemo } from 'react'
import { useQueue } from '../context/QueueContext'
import { useSettings } from '../context/SettingsContext'
import { getVisibleBackends, getVisiblePanesForUi } from '../utils/visibleBackends'
import type { BackendId } from '../../../shared/types'
import type { PaneId } from '../../../shared/layout-metrics'

// The one hook every surface uses to learn what the right-hand group shows.
// Reactive on purpose: key presence and task counts both change at runtime, and
// a column appearing or leaving renumbers the Cmd+N shortcuts with it. Reading
// the list at module scope — as several of these call sites once did — froze it
// at import and would have aimed a shortcut at a column that is no longer there.
export function useVisiblePanes(): { panes: PaneId[]; backends: BackendId[] } {
  const { apiKeyPresence } = useSettings()
  const { tasks } = useQueue()
  return useMemo(
    () => ({
      panes: getVisiblePanesForUi(apiKeyPresence, tasks),
      backends: getVisibleBackends(apiKeyPresence, tasks),
    }),
    [apiKeyPresence, tasks]
  )
}
