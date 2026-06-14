import { BrowserWindow } from 'electron'
import { BACKEND_IDS_IN_UI_ORDER, BackendId, Task } from '../../shared/types'
import { queueManager } from '../queue/queue-manager'
import { loadConfig } from '../config'
import { allocateOutputTimestamp, persistActiveSession } from '../session'
import { writeImageOutput, ImageExt } from '../utils/file-output'
import { detectImageExt } from '../utils/detect-image-type'
import { ImageMetadata } from '../utils/image-metadata'
import { log, logGenerationStart, logGenerationComplete, logGenerationFailed, serializeError } from '../logger'
import { DrainTracker } from './drain-tracker'
import { generateOpenAI } from './openai'
import { generateImagen } from './imagen'
import { generateNanoBanana } from './nanobanana'
import { generateGrok } from './grok'
import { generateFlux } from './flux'
import { generateDrawThings } from './drawthings'
import { generateSlug } from './slug'

type GenerateFn = (task: Task) => Promise<{ buffer: Buffer; mimeType?: string }>

const generators: Record<BackendId, GenerateFn> = {
  openai: generateOpenAI,
  imagen: generateImagen,
  nanobanana: generateNanoBanana,
  grok: generateGrok,
  flux: generateFlux,
  drawthings: generateDrawThings
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

// Tracks one continuous busy period (a "drain") across all backends so the
// queue logs a single aggregate summary instead of an info line per image.
// Process-global like the queue itself; per-image start/complete stay at debug.
const drainTracker = new DrainTracker()

function totalActive(): number {
  return Object.values(activeCounts).reduce((sum, count) => sum + count, 0)
}

// Returns the per-backend default extension, used when both the MIME hint
// and magic-byte detection fail to identify the image type.
// OpenAI supports jpeg/webp/png via outputFormat param; others are fixed.
function getFallbackExt(backend: BackendId, params: Task['params']): ImageExt {
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
  // Close out a finished drain before scheduling new work: once nothing is in
  // flight and nothing is queued, the busy period that just ended gets its one
  // summary line. The 500ms tick that observes the idle state may land up to
  // half a second after the last task settled — fine for an aggregate summary.
  const summary = drainTracker.finalize(Date.now(), totalActive() === 0 && !queueManager.hasQueuedTasks())
  if (summary) {
    log('info', 'Queue drained', { ...summary })
  }

  const config = loadConfig()
  const backends: BackendId[] = BACKEND_IDS_IN_UI_ORDER

  for (const backend of backends) {
    const maxConcurrency = backend === 'drawthings' ? 1 :
      (config.image_backends[backend] as { concurrency?: number }).concurrency || 3
    const tasks = queueManager.getActiveTasks(backend)

    for (let i = tasks.length - 1; i >= 0; i--) {
      const task = tasks[i]
      if (activeCounts[backend] >= maxConcurrency) break
      if (task.status !== 'queued') continue

      drainTracker.begin(Date.now())
      activeCounts[backend]++
      task.status = 'generating'
      task.startedAt = new Date().toISOString()
      logGenerationStart(task.id, backend, task.model)
      persistActiveSession()
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
    const { buffer: imageBuffer, mimeType } = await generate(task)
    const completedAt = new Date()

    task.completedAt = completedAt.toISOString()
    task.durationMs = completedAt.getTime() - new Date(task.startedAt!).getTime()

    // Generate slug and allocate timestamp
    const slug = await generateSlug(task.prompt)
    const { timestamp, ordinal } = allocateOutputTimestamp(backend)

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

    const fallback = getFallbackExt(backend, task.params)
    const ext = detectImageExt(imageBuffer, mimeType, fallback, { backend, model: task.model })
    let baseName: string
    try {
      baseName = writeImageOutput(timestamp, ordinal, slug, backend, imageBuffer, metadata, ext)
    } catch (writeErr) {
      // Generation already succeeded (and, for cloud backends, was billed), so a
      // write failure here is a distinct, more costly event than a generation
      // failure — record it as such before the task is marked failed below.
      log('error', 'Generated image could not be saved to disk', {
        backend,
        model: task.model,
        estimatedCostUsd: task.estimatedCostUsd,
        error: serializeError(writeErr),
      })
      throw writeErr
    }

    task.status = 'completed'
    task.baseName = baseName
    task.imagePath = `${baseName}.${ext}`
    drainTracker.recordOk()
    logGenerationComplete(task.id, task.durationMs, task.baseName, task.estimatedCostUsd)
  } catch (err) {
    task.status = 'failed'
    // task.error stays a short string for the UI and the persisted manifest;
    // the log captures the full error (type, message, stack, cause).
    task.error = err instanceof Error ? err.message : String(err)
    drainTracker.recordFailed()
    logGenerationFailed(task.id, err, {
      backend,
      model: task.model,
      prompt: task.prompt,
      params: task.params,
      durationMs: task.startedAt ? Date.now() - new Date(task.startedAt).getTime() : null
    })
  }

  persistActiveSession()
  broadcastUpdate()
}

function broadcastUpdate(): void {
  const allTasks = queueManager.getAllStoredTasks()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:updated', allTasks)
  }
}
