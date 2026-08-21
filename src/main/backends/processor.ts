import { BACKEND_IDS_IN_UI_ORDER, BackendId, Task } from '../../shared/types'
import { queueManager } from '../queue/queue-manager'
import { loadConfig } from '../config'
import { allocateOutputTimestamp, persistActiveSession } from '../session'
import { writeImageOutput, ImageExt } from '../utils/file-output'
import { detectImageExt } from '../utils/detect-image-type'
import { ImageMetadata } from '../utils/image-metadata'
import { log, logGenerationStart, logGenerationComplete, logGenerationFailed, serializeError } from '../logger'
import { DrainTracker } from './drain-tracker'
import { CANCELLED_MESSAGE, clearInFlight, isQueuePaused, registerInFlight } from './cancellation'
import { publishQueueState } from '../queue/publisher'
import { generateOpenAI } from './openai'
import { generateNanoBanana } from './nanobanana'
import { generateGrok } from './grok'
import { generateFlux } from './flux'
import { generateDrawThings } from './drawthings'
import { generateSlug } from './slug'

// Every generator takes the queue's cancellation signal. It is a parameter
// rather than something each backend registers for itself: registration lived
// in Draw Things alone, which made "stop generating" a Draw-Things-only command
// and left the four cloud backends running with no way to reach them.
type GenerateFn = (task: Task, signal: AbortSignal) => Promise<{ buffer: Buffer; mimeType?: string }>

const generators: Record<BackendId, GenerateFn> = {
  openai: generateOpenAI,
  nanobanana: generateNanoBanana,
  grok: generateGrok,
  flux: generateFlux,
  drawthings: generateDrawThings
}

// Per-backend active task counts for concurrency limiting
const activeCounts: Record<BackendId, number> = {
  openai: 0,
  nanobanana: 0,
  grok: 0,
  flux: 0,
  drawthings: 0
}

// Tracks one continuous busy period (a "drain") across all backends so the
// queue logs a single aggregate summary instead of an info line per image.
// Process-global like the queue itself; per-image start/complete stay at debug.
const drainTracker = new DrainTracker()
let processorTimer: NodeJS.Timeout | null = null
let processorStopping = false

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
    nanobanana: 'png',
    grok: 'jpg',
    flux: 'png',
    drawthings: 'png'
  }
  return staticExts[backend as Exclude<BackendId, 'openai'>]
}

// Starts the queue processor loop. Call once at app startup.
export function startProcessor(): void {
  processorStopping = false
  if (processorTimer) clearInterval(processorTimer)
  processorTimer = setInterval(() => {
    processQueues()
  }, 500)
}

/** Prevent a shutdown race from starting queued work after cleanup begins. */
export function stopProcessor(): void {
  processorStopping = true
  if (processorTimer) {
    clearInterval(processorTimer)
    processorTimer = null
  }
}

export function processQueues(): void {
  if (processorStopping) return
  // Close out a finished drain before scheduling new work: once nothing is in
  // flight and nothing is queued, the busy period that just ended gets its one
  // summary line. The 500ms tick that observes the idle state may land up to
  // half a second after the last task settled — fine for an aggregate summary.
  const summary = drainTracker.finalize(Date.now(), totalActive() === 0 && !queueManager.hasQueuedTasks())
  if (summary) {
    log('info', 'Queue drained', { ...summary })
  }

  // Paused: start nothing new. Work already running is deliberately untouched —
  // it finishes and saves normally, which is the whole point of pausing rather
  // than stopping. Cancelling in-flight work is a separate, explicit action.
  if (isQueuePaused()) return

  const config = loadConfig()
  const backends: BackendId[] = BACKEND_IDS_IN_UI_ORDER

  for (const backend of backends) {
    const maxConcurrency = backend === 'drawthings' ? 1 :
      ((config.image_backends[backend] as { concurrency?: number }).concurrency ?? 3)
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
      // Registration happens synchronously before processTask's first await.
      // Start it before publishing so the menu count includes this task.
      const processing = processTask(backend, task)
      publishQueueState()

      processing.finally(() => {
        activeCounts[backend]--
      })
    }
  }
}

async function processTask(backend: BackendId, task: Task): Promise<void> {
  const generate = generators[backend]

  // The processor owns the canceller for the whole run, so the registry holds an
  // entry for every generating task whatever backend it belongs to — which is
  // also what makes the menu's "generating" count the real one.
  const controller = new AbortController()
  let resolveSettled!: () => void
  const settled = new Promise<void>((resolve) => { resolveSettled = resolve })
  registerInFlight(task.id, () => controller.abort(), settled)

  // Only generate() is cancellable work. Once it resolves, the image exists
  // (and, on a cloud backend, is paid for) — so the task leaves the registry
  // RIGHT THEN, not in the finally: a Stop arriving during the slug/write
  // phase must neither count this task as cancelled nor reach it.
  let generated = false

  try {
    const { buffer: imageBuffer, mimeType } = await generate(task, controller.signal)
    generated = true
    clearInFlight(task.id)
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
        error: serializeError(writeErr),
      })
      throw writeErr
    }

    task.status = 'completed'
    task.baseName = baseName
    task.imagePath = `${baseName}.${ext}`
    drainTracker.recordOk()
    logGenerationComplete(task.id, task.durationMs, task.baseName)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // A cancellation is not a failure: the user asked for it. It lands as
    // `interrupted` — the same status a crash mid-generation produces — so the
    // existing per-row retry and bulk "Retry All" already put it back in the
    // queue, and the row reads "interrupted" rather than showing an error.
    // `signal.aborted` is the authority, not the message: an SDK that turns an
    // abort into its own error type would otherwise be recorded as a failure.
    // `!generated` bounds the classification to the phase a stop can reach: a
    // transient slug/write failure AFTER a successful generation must land as
    // `failed`, never `interrupted` — retrying an interrupted task would buy
    // the already-bought image again.
    if (!generated && (message === CANCELLED_MESSAGE || controller.signal.aborted)) {
      task.status = 'interrupted'
      task.startedAt = null
      task.completedAt = null
      task.durationMs = null
      task.error = null
      drainTracker.recordFailed()
      log('info', 'Generation stopped by request', { taskId: task.id, backend })
    } else {
      task.status = 'failed'
      // task.error stays a short string for the UI and the persisted manifest;
      // the log captures the full error (type, message, stack, cause).
      task.error = message
      drainTracker.recordFailed()
      logGenerationFailed(task.id, err, {
        backend,
        model: task.model,
        prompt: task.prompt,
        params: task.params,
        durationMs: task.startedAt ? Date.now() - new Date(task.startedAt).getTime() : null
      })
    }
  } finally {
    clearInFlight(task.id)
  }

  try {
    persistActiveSession()
    publishQueueState()
  } finally {
    // The shutdown barrier covers the task's final state publication too, not
    // merely the backend request/child exiting.
    resolveSettled()
  }
}
