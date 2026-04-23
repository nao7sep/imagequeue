import { BrowserWindow } from 'electron'
import { BackendId, Task } from '../../shared/types'
import { queueManager } from '../queue/queue-manager'
import { loadConfig } from '../config'
import { TimestampAllocator } from '../session'
import { writeImageOutput, ImageExt } from '../utils/file-output'
import { ImageMetadata } from '../utils/image-metadata'
import { logGenerationStart, logGenerationComplete, logGenerationFailed } from '../logger'
import { generateOpenAI } from './openai'
import { generateImagen } from './imagen'
import { generateNanoBanana } from './nanobanana'
import { generateGrok } from './grok'
import { generateFlux } from './flux'
import { generateDrawThings } from './drawthings'
import { generateSlug } from './slug'

type GenerateFn = (task: Task) => Promise<Buffer>

const generators: Record<BackendId, GenerateFn> = {
  openai: generateOpenAI,
  imagen: generateImagen,
  nanobanana: generateNanoBanana,
  grok: generateGrok,
  flux: generateFlux,
  drawthings: generateDrawThings
}

// Per-backend timestamp allocators
const allocators: Record<BackendId, TimestampAllocator> = {
  openai: new TimestampAllocator(),
  imagen: new TimestampAllocator(),
  nanobanana: new TimestampAllocator(),
  grok: new TimestampAllocator(),
  flux: new TimestampAllocator(),
  drawthings: new TimestampAllocator()
}

// Per-backend active task counts for concurrency limiting
const activeCounts: Record<BackendId, number> = {
  openai: 0,
  imagen: 0,
  nanobanana: 0,
  grok: 0,
  flux: 0,
  drawthings: 0
}

// Returns the correct file extension for the generated image.
// OpenAI supports jpeg/webp/png via outputFormat param; all other backends have fixed formats.
function getImageExt(backend: BackendId, params: Task['params']): ImageExt {
  if (backend === 'openai') {
    const fmt = params?.outputFormat as string | undefined
    if (fmt === 'jpeg') return 'jpg'
    if (fmt === 'webp') return 'webp'
    return 'png'
  }
  const staticExts: Record<Exclude<BackendId, 'openai'>, ImageExt> = {
    imagen: 'png',
    nanobanana: 'png',
    grok: 'jpg',
    flux: 'png',
    drawthings: 'png'
  }
  return staticExts[backend as Exclude<BackendId, 'openai'>]
}

// Starts the queue processor loop. Call once at app startup.
export function startProcessor(): void {
  setInterval(() => {
    processQueues()
  }, 500)
}

function processQueues(): void {
  const config = loadConfig()
  const backends: BackendId[] = ['openai', 'imagen', 'nanobanana', 'grok', 'flux', 'drawthings']

  for (const backend of backends) {
    const maxConcurrency = backend === 'drawthings' ? 1 :
      (config.image_backends[backend] as { concurrency?: number }).concurrency || 3
    const tasks = queueManager.getTasks(backend)

    for (let i = tasks.length - 1; i >= 0; i--) {
      const task = tasks[i]
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

    const ext = getImageExt(backend, task.params)
    const baseName = writeImageOutput(timestamp, slug, backend, imageBuffer, metadata, ext)

    task.status = 'completed'
    task.baseName = baseName
    task.imagePath = `${baseName}.${ext}`
    logGenerationComplete(task.id, task.durationMs, task.baseName, task.estimatedCostUsd)
  } catch (err) {
    task.status = 'failed'
    task.error = err instanceof Error ? err.message : String(err)
    logGenerationFailed(task.id, task.error, {
      backend,
      model: task.model,
      prompt: task.prompt,
      params: task.params,
      durationMs: task.startedAt ? Date.now() - new Date(task.startedAt).getTime() : null
    })
  }

  broadcastUpdate()
}

function broadcastUpdate(): void {
  const allTasks = queueManager.getAllTasks()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:updated', allTasks)
  }
}
