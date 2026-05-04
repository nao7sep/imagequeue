import crypto from 'crypto'
import { BackendId, Task, EnqueueRequest } from '../../shared/types'
import { estimateCostFromRegistry } from '../../shared/models'

function createEmptyQueues(): Record<BackendId, Task[]> {
  return {
    openai: [],
    imagen: [],
    nanobanana: [],
    grok: [],
    flux: [],
    drawthings: []
  }
}

function cloneTask(task: Task): Task {
  return {
    ...task,
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
    return this.queues[backend]
  }

  getAllTasks(): Record<BackendId, Task[]> {
    return { ...this.queues }
  }

  getTask(backend: BackendId, taskId: string): Task | undefined {
    return this.queues[backend].find((t) => t.id === taskId)
  }

  removeTask(backend: BackendId, taskId: string): void {
    this.queues[backend] = this.queues[backend].filter((t) => t.id !== taskId)
  }

  reorderTasks(backend: BackendId, taskIds: string[]): void {
    const taskMap = new Map(this.queues[backend].map((t) => [t.id, t]))
    this.queues[backend] = taskIds.map((id) => taskMap.get(id)!).filter(Boolean)
  }

  retryTask(backend: BackendId, taskId: string): Task | undefined {
    const task = this.getTask(backend, taskId)
    if (!task || (task.status !== 'failed' && task.status !== 'interrupted')) {
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
