import { useMemo, useSyncExternalStore } from 'react'
import { useQueue } from '../context/QueueContext'
import { useSettings } from '../context/SettingsContext'
import { getVisibleBackends, getVisiblePanesForUi } from '../utils/visibleBackends'
import type { BackendId } from '../../../shared/types'
import type { PaneId } from '../../../shared/layout-metrics'

let drawThingsReady = false
const listeners = new Set<() => void>()
export function setDrawThingsReady(ready: boolean): void {
  if (ready === drawThingsReady) return
  drawThingsReady = ready
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// The one hook every surface uses to learn what the right-hand group shows.
// Reactive on purpose: key presence and task counts both change at runtime, and
// a column appearing or leaving renumbers the Cmd+N shortcuts with it. Reading
// the list at module scope — as several of these call sites once did — froze it
// at import and would have aimed a shortcut at a column that is no longer there.
export function useVisiblePanes(): { panes: PaneId[]; backends: BackendId[] } {
  const ready = useSyncExternalStore(subscribe, () => drawThingsReady)
  const { apiKeyPresence } = useSettings()
  const { tasks } = useQueue()
  return useMemo(
    () => ({
      panes: getVisiblePanesForUi(apiKeyPresence, tasks, ready),
      backends: getVisibleBackends(apiKeyPresence, tasks),
    }),
    [apiKeyPresence, tasks, ready]
  )
}
