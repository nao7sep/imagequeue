import crypto from 'crypto'
import { BackendId, Task, EnqueueRequest } from '../../shared/types'

// In-memory queue manager. One ordered queue per backend.
class QueueManager {
  private queues: Record<BackendId, Task[]> = {
    openai: [],
    google: [],
    flux: [],
    local: []
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
        estimatedCostUsd: estimateCost(request.backend, request.model, request.params),
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

function estimateCost(backend: BackendId, model: string, params: Record<string, unknown>): number | null {
  switch (backend) {
    case 'openai': {
      const quality = (params.quality as string) || 'high'
      if (quality === 'low') return 0.02
      if (quality === 'medium') return 0.07
      return 0.19
    }
    case 'google': {
      if (model.includes('fast')) return 0.02
      if (model.includes('ultra')) return 0.06
      return 0.04
    }
    case 'flux': {
      if (model.includes('max')) return 0.07
      if (model.includes('pro')) return 0.03
      if (model.includes('flex')) return 0.06
      if (model.includes('klein-4b')) return 0.014
      if (model.includes('klein')) return 0.015
      return 0.05
    }
    case 'local':
      return null
  }
}

export const queueManager = new QueueManager()
