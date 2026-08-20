import { BrowserWindow } from 'electron'
import { handle } from '../ipc-boundary'
import { queueManager } from './queue-manager'
import { BackendId, EnqueueBatchUnit, EnqueueRequest } from '../../shared/types'
import { deleteImageOutput, trashImageOutput, imageExtFromPath } from '../utils/file-output'
import { loadConfig } from '../config'
import { logEnqueue, log, serializeError } from '../logger'
import { persistActiveSession } from '../session'
import { shouldDeleteToTrash } from '../../shared/config'
import { cancelAllInFlight, inFlightCount, isQueuePaused, setQueuePaused } from '../backends/cancellation'
import type { QueueControlState } from '../../shared/types'

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

  // Queue control — two orthogonal axes, deliberately not entangled:
  //
  //   Pause  is a MODE: the user's standing choice that nothing new starts.
  //          It touches no task and is the only thing Resume undoes.
  //   Stop   is an ACT on the work: interrupt everything active — cancel what
  //          is generating AND flip what is queued to `interrupted` — so the
  //          queue goes quiet with nothing left for the processor to pick up.
  //          It does NOT pause: a later Retry re-queues the stopped tasks and
  //          they start immediately, because the app was never in a mode.
  //
  // Both stopped kinds land in `interrupted` — the status a crash already
  // produces — so the existing retry paths (per-row retry, Retry All) bring
  // any of it back with no new machinery.
  handle('queue:setPaused', (_event, paused: boolean) => {
    setQueuePaused(paused)
    notifyAllWindows('queue:controlState', buildControlState())
  })

  handle('queue:stopAll', () => {
    // Queued first, then in-flight: both are synchronous within this handler,
    // so no processor tick can interleave — the order is for the reader.
    const queued = queueManager.interruptQueuedTasks()
    const cancelled = cancelAllInFlight()
    log('info', 'Stopped all queue work', { cancelled, queued, paused: isQueuePaused() })
    persistActiveSession()
    notifyAllWindows('queue:updated', queueManager.getAllStoredTasks())
    notifyAllWindows('queue:controlState', buildControlState())
    return { cancelled, queued }
  })

  handle('queue:clearPending', () => {
    const removed = queueManager.removePendingTasks()
    log('info', 'Cleared pending tasks', { removed })
    persistActiveSession()
    notifyAllWindows('queue:updated', queueManager.getAllStoredTasks())
    notifyAllWindows('queue:controlState', buildControlState())
    return removed
  })

  handle('queue:getControlState', () => buildControlState())

}

// What the queue-control menu needs to know to enable or disable each item, so
// the renderer never has to infer it from the task list.
function buildControlState(): QueueControlState {
  return {
    paused: isQueuePaused(),
    generating: inFlightCount(),
    queued: queueManager.countByStatus('queued'),
    interrupted: queueManager.countByStatus('interrupted'),
  }
}

function notifyAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}
