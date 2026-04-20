import crypto from 'crypto'
import { BackendId, Task, EnqueueRequest } from '../../shared/types'
import { estimateCostFromRegistry } from '../../shared/models'

// In-memory queue manager. One ordered queue per backend.
class QueueManager {
  private queues: Record<BackendId, Task[]> = {
    openai: [],
    imagen: [],
    flux: [],
    drawthings: [],
    nanobanana: []
  }

  private promptHistory: string[] = []

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
      this.queues[request.backend].push(task)
      tasks.push(task)
    }

    // Track unique prompts for history
    if (!this.promptHistory.includes(request.prompt)) {
      this.promptHistory.push(request.prompt)
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

  getPromptHistory(): string[] {
    return [...this.promptHistory]
  }
}

export const queueManager = new QueueManager()
