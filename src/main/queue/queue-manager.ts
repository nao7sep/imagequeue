import crypto from 'crypto'
import { BackendId, Task, EnqueueBatchUnit, EnqueueRequest } from '../../shared/types'
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
    params: { ...(task.params ?? {}) }
  }
}

export function cloneTask(task: Task): Task {
  return normalizeTaskRecord(task)
}

// In-memory queue manager. One ordered queue per backend.
class QueueManager {
  private queues: Record<BackendId, Task[]> = createEmptyQueues()

  private createTask(request: EnqueueBatchUnit): Task {
    return {
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
      imagePath: null,
      baseName: null,
      error: null
    }
  }

  private insertNewTask(task: Task): void {
    this.queues[task.backend].unshift(task)
  }

  private enqueueUnit(request: EnqueueBatchUnit): Task {
    const task = this.createTask(request)
    this.insertNewTask(task)
    return task
  }

  enqueue(request: EnqueueRequest): Task[] {
    const tasks: Task[] = []

    for (let i = 0; i < request.count; i++) {
      tasks.push(this.enqueueUnit(request))
    }

    return tasks
  }

  enqueueBatch(units: EnqueueBatchUnit[]): Task[] {
    const orderedTasks: Task[] = []

    for (const unit of units) {
      orderedTasks.push(this.enqueueUnit(unit))
    }

    return orderedTasks
  }

  getActiveTasks(backend: BackendId): Task[] {
    return this.queues[backend].filter(isActiveTask)
  }

  getAllVisibleTasks(): Record<BackendId, Task[]> {
    const visible = createEmptyQueues()
    for (const backend of Object.keys(visible) as BackendId[]) {
      visible[backend] = this.getActiveTasks(backend)
    }
    return visible
  }

  getAllStoredTasks(): Record<BackendId, Task[]> {
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

  restoreTask(backend: BackendId, taskId: string): Task | undefined {
    const task = this.getTask(backend, taskId)
    if (!task || task.status !== 'kept') return undefined
    task.status = 'completed'
    return task
  }

  removeTask(backend: BackendId, taskId: string): Task | undefined {
    const index = this.queues[backend].findIndex((task) => task.id === taskId)
    if (index < 0) return undefined
    const [task] = this.queues[backend].splice(index, 1)
    return task
  }

  // NOTE: this sweeps all kept tasks to the end of the array, which changes
  // their absolute position. No UI calls this today, so it's harmless. If a
  // drag-reorder UI is added later, kept rows visible in the column will
  // visually jump to the bottom on every reorder — at that point either
  // preserve kept tasks' original indices here, or block reorder while
  // showKeptImages is true.
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
      replaced[backend] = (nextQueues[backend] ?? []).map(cloneTask)
    }
    this.queues = replaced
  }

  hasGeneratingTasks(): boolean {
    return Object.values(this.queues).some((tasks) => tasks.some((task) => task.status === 'generating'))
  }
}

export const queueManager = new QueueManager()
