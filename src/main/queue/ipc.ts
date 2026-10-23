import { broadcastPresentation } from '../presentation'
import { refreshMainWindowMinimumSize } from '../main-window-layout'
import { getShowKeptImages, toggleShowKeptImages } from './view-state'
import { recoverPublishedOutput } from '../session/output-recovery'
import { handle } from '../ipc-boundary'
import { queueManager } from './queue-manager'
import { BackendId, EnqueueBatchUnit, EnqueueRequest, TaskDeletionResult } from '../../shared/types'
import { deleteImageOutput, trashImageOutput, imageExtFromPath, imageOutputFileStates } from '../utils/file-output'
import { loadConfig } from '../config'
import { logEnqueue, log, serializeError } from '../logger'
import { getSessionDir, getSessionId, mutateSession, persistActiveSession } from '../session'
import { shouldDeleteToTrash } from '../../shared/config'
import { cancelAllInFlight, isQueuePaused } from '../backends/cancellation'
import { buildControlState } from './control-state'
import { publishQueueState } from './publisher'
import { setQueuePausedAndPublish } from './control-actions'
import { pauseForStorageFailure } from './storage-failure'

// These commands acknowledge an applied memory change, not a saved-state
// claim. Once applied, a failed save must expose the retained intent rather
// than invite a second enqueue/retry. The session owner retains the failure;
// the shared storage warning pauses the queue and owns its recovery.
async function persistQueueChange(): Promise<void> {
  try { await persistActiveSession() } catch (error) {
    pauseForStorageFailure('change', error)
    return
  }
  publishQueueState()
}

// Registers all IPC handlers for queue operations.
export function registerQueueIpc(): void {
  handle('queue:getShowKeptImages', () => getShowKeptImages())
  handle('queue:toggleShowKeptImages', () => {
    const visible = toggleShowKeptImages()
    broadcastPresentation('queue:showKeptImages', visible)
    try { refreshMainWindowMinimumSize() } catch (error) {
      log('warn', 'Window geometry presentation failed', { error: serializeError(error) })
    }
    return visible
  })

  handle('queue:enqueue', (_event, request: EnqueueRequest) => mutateSession(async () => {
    const tasks = queueManager.enqueue(request)
    for (const task of tasks) {
      logEnqueue(task.id, request.backend, request.model, request.prompt, request.params, request.count)
    }
    await persistQueueChange()
    return tasks
  }))

  handle('queue:enqueueBatch', (_event, units: EnqueueBatchUnit[]) => mutateSession(async () => {
    const tasks = queueManager.enqueueBatch(units)
    tasks.forEach((task, index) => {
      const unit = units[index]
      logEnqueue(task.id, unit.backend, unit.model, unit.prompt, unit.params, 1)
    })
    await persistQueueChange()
    return tasks
  }))

  handle('queue:getAllStoredTasks', () => {
    return queueManager.getAllStoredTasks()
  })

  handle('queue:removeTask', (_event, backend: BackendId, taskId: string) => mutateSession(async () => {
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
    await persistQueueChange()
  }))

  handle('queue:restoreTask', (_event, backend: BackendId, taskId: string) => mutateSession(async () => {
    const task = queueManager.restoreTask(backend, taskId)
    if (!task) return

    log('info', 'Task restored from kept list', { taskId, backend, baseName: task.baseName ?? null })
    await persistQueueChange()
  }))

  handle('queue:deleteWithFiles', async (_event, backend: BackendId, taskId: string) => {
    const task = queueManager.getTask(backend, taskId)
    // Renderer state can be one processor tick stale: a row checked as queued
    // there may be generating by the time this handler runs. Main owns the
    // queue and is the authority that must keep live work from disappearing.
    if (task?.status === 'generating') {
      log('warn', 'Refusing to delete generating task', { taskId, backend })
      return
    }
    if (!task) return
    return mutateSession(async () => {
      const result: TaskDeletionResult = { removed: false, sessionId: getSessionId() }
      const toTrash = shouldDeleteToTrash(loadConfig().general.delete_to_trash)
      log('info', 'Task deleted with files', { taskId, backend, baseName: task?.baseName ?? null, toTrash })
      // File cleanup is best-effort. Session switches take the same guard, so
      // the session cannot change while the files go; the task is rechecked
      // below because the queue may have replaced it meanwhile.
      if (task.baseName) {
        result.baseName = task.baseName
        const ext = imageExtFromPath(task.imagePath)
        if (ext) {
          result.ext = ext
          try {
            if (toTrash) {
              await trashImageOutput(task.baseName, ext)
            } else {
              await deleteImageOutput(task.baseName, ext)
            }
          } catch (err) {
            log('error', 'Failed to remove task files; removing the queue entry anyway', { taskId, toTrash, error: serializeError(err) })
            result.files = await imageOutputFileStates(task.baseName, ext)
          }
        } else {
          log('warn', 'Cannot determine image extension; skipping file removal', { taskId, imagePath: task.imagePath ?? null })
          result.files = { image: 'unknown', metadata: 'unknown' }
        }
      } else {
        log('warn', 'Task has no baseName; nothing to remove on disk', { taskId, backend })
      }
      if (queueManager.getTask(backend, taskId) !== task) return result
      queueManager.removeTask(backend, taskId)
      result.removed = true
      try {
        await persistActiveSession()
      } catch (error) {
        // Files and memory already changed. Keep the required save pending for
        // quit/retry, and return that consequence instead of claiming rollback.
        result.sessionSaved = false
        log('error', 'Task removed, but the session change could not be saved', { taskId, backend, error: serializeError(error) })
      }
      publishQueueState()
      return result
    })
  })

  handle('queue:retryTask', (_event, backend: BackendId, taskId: string) => mutateSession(async () => {
    const pending = queueManager.getTask(backend, taskId)
    if (pending && (pending.status === 'failed' || pending.status === 'interrupted') &&
      pending.pendingOutput && await recoverPublishedOutput(pending, getSessionDir())) {
      await persistQueueChange()
      return
    }
    const task = queueManager.retryTask(backend, taskId)
    if (task) {
      log('info', 'Task retry requested', { taskId, backend })
      await persistQueueChange()
    }
  }))

  handle('queue:resumeInterrupted', () => mutateSession(async () => {
    const recovered = []
    for (const tasks of Object.values(queueManager.getAllStoredTasks())) {
      for (const task of tasks) {
        if (task.status === 'interrupted' && task.pendingOutput &&
          await recoverPublishedOutput(task, getSessionDir())) recovered.push(task)
      }
    }
    // Inspect every candidate before changing memory: inaccessible storage must
    // leave the entire retry operation available to try again.
    for (const task of recovered) {
      const current = queueManager.getTask(task.backend, task.id)!
      Object.assign(current, task)
      delete current.pendingOutput
    }
    const count = queueManager.retryAllInterrupted()
    if (count > 0 || recovered.length > 0) {
      log('info', 'Resuming interrupted tasks', { count })
      await persistQueueChange()
    }
    return count
  }))

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
    setQueuePausedAndPublish(paused)
  })

  handle('queue:stopAll', async () => {
    // Queued first, then in-flight: both are synchronous within this handler,
    // so no processor tick can interleave — the order is for the reader.
    const queued = queueManager.interruptQueuedTasks()
    const cancelled = cancelAllInFlight()
    log('info', 'Stopped all queue work', { cancelled, queued, paused: isQueuePaused() })
    await persistQueueChange()
    return { cancelled, queued }
  })

  handle('queue:clearPending', () => mutateSession(async () => {
    const removed = queueManager.removePendingTasks()
    log('info', 'Cleared pending tasks', { removed })
    await persistQueueChange()
    return removed
  }))

  handle('queue:getControlState', () => buildControlState())

}

export { buildControlState }
