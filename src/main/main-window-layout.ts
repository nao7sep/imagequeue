import type { BrowserWindow } from 'electron'
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

export function registerMainWindowForLayout(win: BrowserWindow): void {
  mainWindow = win
}

export function unregisterMainWindowForLayout(win: BrowserWindow): void {
  if (mainWindow === win) mainWindow = null
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
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const { minWidth, minHeight } = buildMainWindowOptions(getVisiblePaneCount())
  win.setMinimumSize(minWidth, minHeight)

  // macOS accepts a higher minimum without bringing an already-smaller window
  // up to that floor. Grow only the undersized axes so a newly visible pane is
  // usable immediately, while a lower minimum never changes the user's window.
  const [width, height] = win.getSize()
  const nextWidth = Math.max(width, minWidth)
  const nextHeight = Math.max(height, minHeight)
  if (nextWidth !== width || nextHeight !== height) {
    win.setSize(nextWidth, nextHeight)
  }
}
