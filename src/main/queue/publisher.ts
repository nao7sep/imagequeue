import { BrowserWindow } from 'electron'
import { refreshMainWindowMinimumSize } from '../main-window-layout'
import { buildControlState } from './control-state'
import { queueManager } from './queue-manager'

export function publishQueueControlState(): void {
  const controlState = buildControlState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:controlState', controlState)
  }
}

/** The one post-mutation path for queue state: renderer data, menu counts, and
 * native window constraints are one observable state and move together. */
export function publishQueueState(): void {
  const tasks = queueManager.getAllStoredTasks()
  const controlState = buildControlState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:updated', tasks)
    win.webContents.send('queue:controlState', controlState)
  }
  refreshMainWindowMinimumSize()
}
