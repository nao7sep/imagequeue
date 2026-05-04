import crypto from 'crypto'
import { BackendId, Task, EnqueueRequest, TaskHiddenReason } from '../../shared/types'
import { estimateCostFromRegistry } from '../../shared/models'

export function createEmptyQueues(): Record<BackendId, Task[]> {
  return {
    openai: [],
    imagen: [],
    nanobanana: [],
    grok: [],
    flux: [],
    drawthings: []
  }
}

function isVisible(task: Task): boolean {
  return task.visibility !== 'hidden'
}

export function normalizeTaskRecord(task: Task): Task {
  return {
    ...task,
    params: { ...task.params },
    visibility: task.visibility ?? 'visible',
    hiddenAt: task.hiddenAt ?? null,
    hiddenReason: task.hiddenReason ?? null,
    assetState: task.assetState ?? 'present',
    deletedAt: task.deletedAt ?? null
  }
}

export function cloneTask(task: Task): Task {
  return {
    ...normalizeTaskRecord(task),
    params: { ...task.params }
  }
}

// In-memory queue manager. One ordered queue per backend.
class QueueManager {
  private queues: Record<BackendId, Task[]> = createEmptyQueues()

  enqueue(request: EnqueueRequest): Task[] {
    const tasks: Task[] = []

    for (let i = 0; i < request.count; i++) {
      const task: Task = {
        id: crypto.randomUUID(),
        prompt: request.prompt,
        backend: request.backend,
        model: request.model,
        params: { ...request.params },
        status: 'queued',
        visibility: 'visible',
        hiddenAt: null,
        hiddenReason: null,
        assetState: 'present',
        deletedAt: null,
        estimatedCostUsd: estimateCostFromRegistry(request.backend, request.model, request.params),
        enqueuedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        durationMs: null,
        thumbnailPath: null,
        imagePath: null,
        baseName: null,
        error: null
      }
      this.queues[request.backend].unshift(task)
      tasks.push(task)
    }

    return tasks
  }

  getTasks(backend: BackendId): Task[] {
    return this.queues[backend].filter(isVisible)
  }

  getAllTasks(): Record<BackendId, Task[]> {
    const visible = createEmptyQueues()
    for (const backend of Object.keys(visible) as BackendId[]) {
      visible[backend] = this.getTasks(backend)
    }
    return visible
  }

  getAllTasksIncludingHidden(): Record<BackendId, Task[]> {
    return { ...this.queues }
  }

  getTask(backend: BackendId, taskId: string): Task | undefined {
    return this.queues[backend].find((t) => t.id === taskId)
  }

  hideTask(
    backend: BackendId,
    taskId: string,
    hiddenReason: Exclude<TaskHiddenReason, null>,
    options?: { assetDeleted?: boolean }
  ): Task | undefined {
    const task = this.getTask(backend, taskId)
    if (!task) return undefined

    const hiddenAt = new Date().toISOString()
    task.visibility = 'hidden'
    task.hiddenAt = hiddenAt
    task.hiddenReason = hiddenReason
    if (options?.assetDeleted) {
      task.assetState = 'deleted'
      task.deletedAt = hiddenAt
    }
    return task
  }

  reorderTasks(backend: BackendId, taskIds: string[]): void {
    const visibleTasks = this.queues[backend].filter(isVisible)
    const hiddenTasks = this.queues[backend].filter((task) => !isVisible(task))
    const visibleTaskMap = new Map(visibleTasks.map((task) => [task.id, task]))
    const reorderedVisible = taskIds.map((id) => visibleTaskMap.get(id)).filter(Boolean) as Task[]
    const remainingVisible = visibleTasks.filter((task) => !taskIds.includes(task.id))
    this.queues[backend] = [...reorderedVisible, ...remainingVisible, ...hiddenTasks]
  }

  retryTask(backend: BackendId, taskId: string): Task | undefined {
    const task = this.getTask(backend, taskId)
    if (!task || !isVisible(task) || (task.status !== 'failed' && task.status !== 'interrupted')) {
      return undefined
    }

    task.status = 'queued'
    task.error = null
    task.startedAt = null
    task.completedAt = null
    task.durationMs = null
    return task
  }

  replaceAllTasks(nextQueues: Record<BackendId, Task[]>): void {
    const replaced = createEmptyQueues()
    for (const backend of Object.keys(replaced) as BackendId[]) {
      replaced[backend] = (nextQueues[backend] ?? []).map((task) => cloneTask(normalizeTaskRecord(task)))
    }
    this.queues = replaced
  }

  hasGeneratingTasks(): boolean {
    return Object.values(this.queues).some((tasks) => tasks.some((task) => task.status === 'generating'))
  }
}

export const queueManager = new QueueManager()
