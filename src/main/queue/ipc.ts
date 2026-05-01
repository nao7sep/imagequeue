import { ipcMain, BrowserWindow } from 'electron'
import { queueManager } from './queue-manager'
import { BackendId, EnqueueRequest } from '../../shared/types'
import { deleteImageOutput, trashImageOutput, imageExtFromPath } from '../utils/file-output'
import { loadConfig } from '../config'
import { logEnqueue, log } from '../logger'

// Registers all IPC handlers for queue operations.
export function registerQueueIpc(): void {
  ipcMain.handle('queue:enqueue', (_event, request: EnqueueRequest) => {
    const tasks = queueManager.enqueue(request)
    for (const task of tasks) {
      logEnqueue(task.id, request.backend, request.model, request.prompt, request.params, request.count)
    }
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
    const task = queueManager.getTask(backend, taskId)
    if (task?.status === 'generating') {
      log('warn', `Refusing to remove generating task ${taskId}`, { backend })
      return
    }
    log('info', `Task removed from queue: ${taskId}`, { backend })
    queueManager.removeTask(backend, taskId)
    notifyAllWindows('queue:updated', queueManager.getAllTasks())
  })

  ipcMain.handle('queue:deleteWithFiles', async (_event, backend: BackendId, taskId: string) => {
    const task = queueManager.getTask(backend, taskId)
    const toTrash = loadConfig().general.delete_to_trash
    log('info', `Task deleted with files: ${taskId}`, { backend, baseName: task?.baseName ?? null, toTrash })
    if (task?.baseName) {
      const ext = imageExtFromPath(task.imagePath)
      if (!ext) {
        log('warn', `Cannot determine image extension for ${taskId}; skipping file removal`, { imagePath: task.imagePath ?? null })
      } else {
        try {
          if (toTrash) {
            await trashImageOutput(task.baseName, ext)
          } else {
            deleteImageOutput(task.baseName, ext)
          }
        } catch (err) {
          log('error', `Failed to ${toTrash ? 'trash' : 'delete'} files for ${taskId}`, { error: String(err) })
        }
      }
    }
    queueManager.removeTask(backend, taskId)
    notifyAllWindows('queue:updated', queueManager.getAllTasks())
  })

  ipcMain.handle('queue:retryTask', (_event, backend: BackendId, taskId: string) => {
    const task = queueManager.getTask(backend, taskId)
    if (task && task.status === 'failed') {
      task.status = 'queued'
      task.error = null
      task.startedAt = null
      task.completedAt = null
      task.durationMs = null
      log('info', `Retrying task ${taskId}`, { backend })
      notifyAllWindows('queue:updated', queueManager.getAllTasks())
    }
  })

  ipcMain.handle('queue:reorderTasks', (_event, backend: BackendId, taskIds: string[]) => {
    queueManager.reorderTasks(backend, taskIds)
    notifyAllWindows('queue:updated', queueManager.getAllTasks())
  })
}

function notifyAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}
