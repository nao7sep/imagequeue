import type { BrowserWindow } from 'electron'
import { configureWindowMinimum } from './window-minimum'
import { log, serializeError } from './logger'
import { hasApiKey } from './config/api-keys-store'
import { queueManager } from './queue/queue-manager'
import { buildMainWindowOptions } from './window-options'
import { getVisiblePanes } from '../shared/layout-metrics'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER, IMAGE_BACKEND_SECRET } from '../shared/types'
import type { Platform } from '../shared/electron-api'

// The main window is registered explicitly. BrowserWindow.getAllWindows()[0]
// is not a main-window identity: the notification window is created first and
// could receive the minimum-size update instead.
let mainWindow: BrowserWindow | null = null
let refreshMinimum: (() => void) | null = null

export function registerMainWindowForLayout(win: BrowserWindow): void {
  mainWindow = win
  refreshMinimum = configureWindowMinimum(win, () => {
    const { minWidth, minHeight } = buildMainWindowOptions(getVisiblePaneCount())
    return { width: minWidth, height: minHeight }
  }, (error) => log('warn', 'Window minimum could not be updated', { error: serializeError(error) }))
}

export function unregisterMainWindowForLayout(win: BrowserWindow): void {
  if (mainWindow === win) {
    mainWindow = null
    refreshMinimum = null
  }
}

/** Pane count from the same keyed-or-occupied rule the renderer uses. */
export function getVisiblePaneCount(platform: Platform = process.platform as Platform): number {
  const keyed = CLOUD_BACKEND_IDS_IN_UI_ORDER.filter((backend) =>
    hasApiKey(IMAGE_BACKEND_SECRET[backend])
  )
  const tasks = queueManager.getAllStoredTasks()
  const occupied = CLOUD_BACKEND_IDS_IN_UI_ORDER.filter((backend) => (tasks[backend]?.length ?? 0) > 0)
  return getVisiblePanes(platform, keyed, occupied).length
}

/** Re-apply the minimum after a key, queue, or session transition changes panes. */
export function refreshMainWindowMinimumSize(): void {
  refreshMinimum?.()
}
