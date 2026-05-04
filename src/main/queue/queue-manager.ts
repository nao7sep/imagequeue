import crypto from 'crypto'
import { BackendId, Task, EnqueueRequest } from '../../shared/types'
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

function isActiveTask(task: Task): boolean {
  return task.status !== 'kept'
}

export function normalizeTaskRecord(task: Task): Task {
  return {
    ...task,
    params: { ...task.params }
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
    return this.queues[backend].filter(isActiveTask)
  }

  getAllTasks(): Record<BackendId, Task[]> {
    const visible = createEmptyQueues()
    for (const backend of Object.keys(visible) as BackendId[]) {
      visible[backend] = this.getTasks(backend)
    }
    return visible
  }

  getStoredTasks(): Record<BackendId, Task[]> {
    const stored = createEmptyQueues()
    for (const backend of Object.keys(stored) as BackendId[]) {
      stored[backend] = this.queues[backend].map(cloneTask)
    }
    return stored
  }

  getTask(backend: BackendId, taskId: string): Task | undefined {
    return this.queues[backend].find((t) => t.id === taskId)
  }

  keepTask(backend: BackendId, taskId: string): Task | undefined {
    const task = this.getTask(backend, taskId)
    if (!task || task.status !== 'completed') return undefined
    task.status = 'kept'
    return task
  }

  removeTask(backend: BackendId, taskId: string): Task | undefined {
    const index = this.queues[backend].findIndex((task) => task.id === taskId)
    if (index < 0) return undefined
    const [task] = this.queues[backend].splice(index, 1)
    return task
  }

  reorderTasks(backend: BackendId, taskIds: string[]): void {
    const activeTasks = this.queues[backend].filter(isActiveTask)
    const keptTasks = this.queues[backend].filter((task) => !isActiveTask(task))
    const activeTaskMap = new Map(activeTasks.map((task) => [task.id, task]))
    const reorderedActive = taskIds.map((id) => activeTaskMap.get(id)).filter(Boolean) as Task[]
    const remainingActive = activeTasks.filter((task) => !taskIds.includes(task.id))
    this.queues[backend] = [...reorderedActive, ...remainingActive, ...keptTasks]
  }

  retryTask(backend: BackendId, taskId: string): Task | undefined {
    const task = this.getTask(backend, taskId)
    if (!task || !isActiveTask(task) || (task.status !== 'failed' && task.status !== 'interrupted')) {
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
