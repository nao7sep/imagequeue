import { isQueueTaskVisible } from '../../shared/queue-visibility'
import { nanoid } from 'nanoid'
import { BackendId, Task, EnqueueBatchUnit, EnqueueRequest } from '../../shared/types'

export function createEmptyQueues(): Record<BackendId, Task[]> {
  return {
    openai: [],
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
    params: { ...task.params },
    ...(task.pendingOutput ? { pendingOutput: { ...task.pendingOutput } } : {})
  }
}

export function cloneTask(task: Task): Task {
  return normalizeTaskRecord(task)
}

// In-memory queue manager. One ordered queue per backend.
export class QueueManager {
  private queues: Record<BackendId, Task[]> = createEmptyQueues()
  private tasksById = new Map<string, Task>()

  private taskKey(backend: BackendId, id: string): string { return `${backend}:${id}` }

  private forget(task: Task): void {
    this.tasksById.delete(this.taskKey(task.backend, task.id))
  }

  updateTask(task: Task, changes: Partial<Task>): void {
    if (this.getTask(task.backend, task.id) !== task) throw new Error('Cannot update a task not owned by this queue')
    if ((changes.id !== undefined && changes.id !== task.id) || (changes.backend !== undefined && changes.backend !== task.backend)) {
      throw new Error('Cannot change a queue task identity')
    }
    Object.assign(task, changes)
  }

  hasVisibleTasks(backend: BackendId, showKept: boolean): boolean {
    return this.queues[backend].some(task => isQueueTaskVisible(task, showKept))
  }

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
      error: null,
      providerMessage: null
    }
  }

  private insertNewTask(task: Task): void {
    this.queues[task.backend].unshift(task)
    this.tasksById.set(this.taskKey(task.backend, task.id), task)
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

  getAllStoredTasks(): Record<BackendId, Task[]> {
    const stored = createEmptyQueues()
    for (const backend of Object.keys(stored) as BackendId[]) {
      stored[backend] = this.queues[backend].map(cloneTask)
    }
    return stored
  }

  getTask(backend: BackendId, taskId: string): Task | undefined {
    return this.tasksById.get(this.taskKey(backend, taskId))
  }

  keepTask(backend: BackendId, taskId: string): Task | undefined {
    const task = this.getTask(backend, taskId)
    if (!task || task.status !== 'completed') return undefined
    this.updateTask(task, { status: 'kept' })
    return task
  }

  restoreTask(backend: BackendId, taskId: string): Task | undefined {
    const task = this.getTask(backend, taskId)
    if (!task || task.status !== 'kept') return undefined
    this.updateTask(task, { status: 'completed' })
    return task
  }

  removeTask(backend: BackendId, taskId: string): Task | undefined {
    const index = this.queues[backend].findIndex((task) => task.id === taskId)
    if (index < 0) return undefined
    const [task] = this.queues[backend].splice(index, 1)
    this.forget(task)
    return task
  }

  // Resets a task back to 'queued' so the processor picks it up again, clearing
  // the per-attempt result fields. Shared by single retry and bulk resume.
  private requeueTask(task: Task): void {
    this.updateTask(task, {
      status: 'queued', pendingOutput: undefined, error: null, providerMessage: null,
      startedAt: null, completedAt: null, durationMs: null,
    })
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
    this.tasksById.clear()
    for (const tasks of Object.values(replaced)) {
      for (const task of tasks) this.tasksById.set(this.taskKey(task.backend, task.id), task)
    }
  }

  hasGeneratingTasks(): boolean {
    return this.generatingCount() > 0
  }

  generatingCount(): number {
    return Object.values(this.queues).reduce((count, tasks) => count + tasks.filter((task) => task.status === 'generating').length, 0)
  }

  /** Mark every task waiting to start as interrupted, so it stops being picked
   *  up and becomes retryable through the paths that already exist. Tasks
   *  currently generating are untouched — stopping those is the cancellation
   *  registry's job, and each lands here through its own failure path. */
  interruptQueuedTasks(): number {
    let count = 0
    for (const backend of Object.keys(this.queues) as BackendId[]) {
      for (const task of this.queues[backend]) {
        if (task.status === 'queued') {
          this.updateTask(task, { status: 'interrupted', error: null, providerMessage: null })
          count++
        }
      }
    }
    return count
  }

  /** Remove every pending task — `queued` and `interrupted` alike. Pending
   *  means "will run, or could be retried": both are work the user has decided
   *  not to do, so clearing one kind and stranding the other made the command
   *  a partial no-op. Running and finished tasks are untouched, and unlike
   *  stopping this is not retryable — the tasks are gone. */
  removePendingTasks(): number {
    let count = 0
    for (const backend of Object.keys(this.queues) as BackendId[]) {
      const before = this.queues[backend].length
      this.queues[backend] = this.queues[backend].filter(task => {
        if (task.status !== 'queued' && task.status !== 'interrupted') return true
        this.forget(task)
        return false
      })
      count += before - this.queues[backend].length
    }
    return count
  }

  countByStatus(status: Task['status']): number {
    let count = 0
    for (const backend of Object.keys(this.queues) as BackendId[]) {
      count += this.queues[backend].filter((task) => task.status === status).length
    }
    return count
  }

  hasQueuedTasks(): boolean {
    return Object.values(this.queues).some((tasks) => tasks.some((task) => task.status === 'queued'))
  }
}

export const queueManager = new QueueManager()
