import { nanoid } from 'nanoid'
import { BackendId, Task, EnqueueBatchUnit, EnqueueRequest } from '../../shared/types'

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
export class QueueManager {
  private queues: Record<BackendId, Task[]> = createEmptyQueues()

  private createTask(request: EnqueueBatchUnit): Task {
    return {
      id: nanoid(),
      prompt: request.prompt,
      backend: request.backend,
      model: request.model,
      params: { ...request.params },
      status: 'queued',
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

  // Resets a task back to 'queued' so the processor picks it up again, clearing
  // the per-attempt result fields. Shared by single retry and bulk resume.
  private requeueTask(task: Task): void {
    task.status = 'queued'
    task.error = null
    task.startedAt = null
    task.completedAt = null
    task.durationMs = null
  }

  retryTask(backend: BackendId, taskId: string): Task | undefined {
    const task = this.getTask(backend, taskId)
    if (!task || !isActiveTask(task) || (task.status !== 'failed' && task.status !== 'interrupted')) {
      return undefined
    }

    this.requeueTask(task)
    return task
  }

  // Re-queues every interrupted task across all backends and returns how many
  // were affected. Backs the "resume interrupted tasks" prompt shown after a
  // session with unfinished work is reopened.
  retryAllInterrupted(): number {
    let count = 0
    for (const backend of Object.keys(this.queues) as BackendId[]) {
      for (const task of this.queues[backend]) {
        if (task.status === 'interrupted') {
          this.requeueTask(task)
          count++
        }
      }
    }
    return count
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

  // Flips any in-flight 'generating' tasks to 'interrupted', clearing the
  // per-attempt fields the same way a resumed session does (toInterruptedTask).
  // Called at shutdown so the persisted manifest reflects that the process
  // stopped mid-generation instead of freezing a task as 'generating' forever.
  // Returns how many were affected.
  interruptGeneratingTasks(): number {
    let count = 0
    for (const backend of Object.keys(this.queues) as BackendId[]) {
      for (const task of this.queues[backend]) {
        if (task.status === 'generating') {
          task.status = 'interrupted'
          task.startedAt = null
          task.completedAt = null
          task.durationMs = null
          task.imagePath = null
          task.baseName = null
          task.error = null
          count++
        }
      }
    }
    return count
  }

  hasQueuedTasks(): boolean {
    return Object.values(this.queues).some((tasks) => tasks.some((task) => task.status === 'queued'))
  }
}

export const queueManager = new QueueManager()
