import { BrowserWindow } from 'electron'
import { BackendId, Task } from '../../shared/types'
import { queueManager } from '../queue/queue-manager'
import { loadConfig } from '../config'
import { TimestampAllocator } from '../session'
import { writeImageOutput } from '../utils/file-output'
import { ImageMetadata } from '../utils/image-metadata'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '../logger'
import { generateOpenAI } from './openai'
import { generateGoogle } from './google'
import { generateFlux } from './flux'
import { generateLocal } from './local'
import { generateSlug } from './slug'

type GenerateFn = (task: Task) => Promise<Buffer>

const generators: Record<BackendId, GenerateFn> = {
  openai: generateOpenAI,
  google: generateGoogle,
  flux: generateFlux,
  local: generateLocal
}

// Per-backend timestamp allocators
const allocators: Record<BackendId, TimestampAllocator> = {
  openai: new TimestampAllocator(),
  google: new TimestampAllocator(),
  flux: new TimestampAllocator(),
  local: new TimestampAllocator()
}

// Per-backend active task counts for concurrency limiting
const activeCounts: Record<BackendId, number> = {
  openai: 0,
  google: 0,
  flux: 0,
  local: 0
}

// Starts the queue processor loop. Call once at app startup.
export function startProcessor(): void {
  setInterval(() => {
    processQueues()
  }, 500)
}

function processQueues(): void {
  const config = loadConfig()
  const backends: BackendId[] = ['openai', 'google', 'flux', 'local']

  for (const backend of backends) {
    const maxConcurrency = backend === 'local' ? 1 :
      (config.image_backends[backend] as { concurrency?: number }).concurrency || 3
    const tasks = queueManager.getTasks(backend)

    for (const task of tasks) {
      if (activeCounts[backend] >= maxConcurrency) break
      if (task.status !== 'queued') continue

      activeCounts[backend]++
      task.status = 'generating'
      task.startedAt = new Date().toISOString()
      logGenerationStart(task.id, backend, task.model)
      broadcastUpdate()

      processTask(backend, task).finally(() => {
        activeCounts[backend]--
      })
    }
  }
}

async function processTask(backend: BackendId, task: Task): Promise<void> {
  const generate = generators[backend]

  try {
    const imageBuffer = await generate(task)
    const completedAt = new Date()

    task.completedAt = completedAt.toISOString()
    task.durationMs = completedAt.getTime() - new Date(task.startedAt!).getTime()

    // Generate slug and allocate timestamp
    const slug = await generateSlug(task.prompt)
    const timestamp = await allocators[backend].allocate()

    const metadata: ImageMetadata = {
      prompt: task.prompt,
      backend,
      model: task.model,
      params: task.params,
      slug,
      status: 'completed',
      enqueued_at: task.enqueuedAt,
      started_at: task.startedAt!,
      completed_at: task.completedAt,
      file_timestamp: new Date().toISOString(),
      duration_ms: task.durationMs,
      estimated_cost_usd: task.estimatedCostUsd,
      seed: null,
      error: null
    }

    const baseName = writeImageOutput(timestamp, slug, backend, imageBuffer, metadata)

    task.status = 'completed'
    task.baseName = baseName
    task.imagePath = `${baseName}.png`
    logGenerationComplete(task.id, task.durationMs)
  } catch (err) {
    task.status = 'failed'
    task.error = err instanceof Error ? err.message : String(err)
    logGenerationFailed(task.id, task.error)
  }

  broadcastUpdate()
}

function broadcastUpdate(): void {
  const allTasks = queueManager.getAllTasks()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:updated', allTasks)
  }
}
