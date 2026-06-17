import { BrowserWindow } from 'electron'
import { handle } from '../ipc-boundary'
import { queueManager } from './queue-manager'
import { BackendId, EnqueueBatchUnit, EnqueueRequest } from '../../shared/types'
import { deleteImageOutput, trashImageOutput, imageExtFromPath } from '../utils/file-output'
import { loadConfig } from '../config'
import { logEnqueue, log, serializeError } from '../logger'
import { persistActiveSession } from '../session'
import { shouldDeleteToTrash } from '../../shared/config'

// Registers all IPC handlers for queue operations.
export function registerQueueIpc(): void {
  handle('queue:enqueue', (_event, request: EnqueueRequest) => {
    const tasks = queueManager.enqueue(request)
    for (const task of tasks) {
      logEnqueue(task.id, request.backend, request.model, request.prompt, request.params, request.count)
    }
    persistActiveSession()
    notifyAllWindows('queue:updated', queueManager.getAllStoredTasks())
    return tasks
  })

  handle('queue:enqueueBatch', (_event, units: EnqueueBatchUnit[]) => {
    const tasks = queueManager.enqueueBatch(units)
    tasks.forEach((task, index) => {
      const unit = units[index]
      logEnqueue(task.id, unit.backend, unit.model, unit.prompt, unit.params, 1)
    })
    persistActiveSession()
    notifyAllWindows('queue:updated', queueManager.getAllStoredTasks())
    return tasks
  })

  handle('queue:getTasks', (_event, backend: BackendId) => {
    return queueManager.getActiveTasks(backend)
  })

  handle('queue:getAllTasks', () => {
    return queueManager.getAllVisibleTasks()
  })

  handle('queue:getAllStoredTasks', () => {
    return queueManager.getAllStoredTasks()
  })

  handle('queue:removeTask', (_event, backend: BackendId, taskId: string) => {
    const task = queueManager.getTask(backend, taskId)
    if (task?.status === 'generating') {
      log('warn', 'Refusing to remove generating task', { taskId, backend })
      return
    }
    if (!task) return

    if (task.status === 'completed') {
      log('info', 'Task marked kept', { taskId, backend, baseName: task.baseName ?? null })
      queueManager.keepTask(backend, taskId)
    } else {
      log('info', 'Task removed from queue', { taskId, backend })
      queueManager.removeTask(backend, taskId)
    }
    persistActiveSession()
    notifyAllWindows('queue:updated', queueManager.getAllStoredTasks())
  })

  handle('queue:restoreTask', (_event, backend: BackendId, taskId: string) => {
    const task = queueManager.restoreTask(backend, taskId)
    if (!task) return

    log('info', 'Task restored from kept list', { taskId, backend, baseName: task.baseName ?? null })
    persistActiveSession()
    notifyAllWindows('queue:updated', queueManager.getAllStoredTasks())
  })

  handle('queue:deleteWithFiles', async (_event, backend: BackendId, taskId: string) => {
    const task = queueManager.getTask(backend, taskId)
    const toTrash = shouldDeleteToTrash(loadConfig().general.delete_to_trash)
    log('info', 'Task deleted with files', { taskId, backend, baseName: task?.baseName ?? null, toTrash })
    // File removal is best-effort: whatever happens on disk, the user asked to delete
    // the task, so the queue entry is always removed (and broadcast) afterwards — a
    // failed/partial file removal must never leave the queue diverged from disk.
    if (task?.baseName) {
      const ext = imageExtFromPath(task.imagePath)
      if (ext) {
        try {
          if (toTrash) {
            await trashImageOutput(task.baseName, ext)
          } else {
            deleteImageOutput(task.baseName, ext)
          }
        } catch (err) {
          log('error', 'Failed to remove task files; removing the queue entry anyway', { taskId, toTrash, error: serializeError(err) })
        }
      } else {
        log('warn', 'Cannot determine image extension; skipping file removal', { taskId, imagePath: task.imagePath ?? null })
      }
    } else {
      log('warn', 'Task has no baseName; nothing to remove on disk', { taskId, backend })
    }
    queueManager.removeTask(backend, taskId)
    persistActiveSession()
    notifyAllWindows('queue:updated', queueManager.getAllStoredTasks())
  })

  handle('queue:retryTask', (_event, backend: BackendId, taskId: string) => {
    const task = queueManager.retryTask(backend, taskId)
    if (task) {
      log('info', 'Task retry requested', { taskId, backend })
      persistActiveSession()
      notifyAllWindows('queue:updated', queueManager.getAllStoredTasks())
    }
  })

  handle('queue:resumeInterrupted', () => {
    const count = queueManager.retryAllInterrupted()
    if (count > 0) {
      log('info', 'Resuming interrupted tasks', { count })
      persistActiveSession()
      notifyAllWindows('queue:updated', queueManager.getAllStoredTasks())
    }
    return count
  })

  handle('queue:reorderTasks', (_event, backend: BackendId, taskIds: string[]) => {
    queueManager.reorderTasks(backend, taskIds)
    persistActiveSession()
    notifyAllWindows('queue:updated', queueManager.getAllStoredTasks())
  })
}

function notifyAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}
