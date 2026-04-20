import { ipcMain, BrowserWindow } from 'electron'
import { queueManager } from './queue-manager'
import { BackendId, EnqueueRequest } from '../../shared/types'

// Registers all IPC handlers for queue operations.
export function registerQueueIpc(): void {
  ipcMain.handle('queue:enqueue', (_event, request: EnqueueRequest) => {
    const tasks = queueManager.enqueue(request)
    notifyAllWindows('queue:updated', queueManager.getAllTasks())
    return tasks
  })

  ipcMain.handle('queue:getTasks', (_event, backend: BackendId) => {
    return queueManager.getTasks(backend)
  })

  ipcMain.handle('queue:getAllTasks', () => {
    return queueManager.getAllTasks()
  })

  ipcMain.handle('queue:removeTask', (_event, backend: BackendId, taskId: string) => {
    queueManager.removeTask(backend, taskId)
    notifyAllWindows('queue:updated', queueManager.getAllTasks())
  })

  ipcMain.handle('queue:reorderTasks', (_event, backend: BackendId, taskIds: string[]) => {
    queueManager.reorderTasks(backend, taskIds)
    notifyAllWindows('queue:updated', queueManager.getAllTasks())
  })

  ipcMain.handle('queue:getPromptHistory', () => {
    return queueManager.getPromptHistory()
  })
}

function notifyAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}
