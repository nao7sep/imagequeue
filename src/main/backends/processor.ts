import { BACKEND_IDS_IN_UI_ORDER, BackendId, Task } from '../../shared/types'
import { queueManager } from '../queue/queue-manager'
import { loadConfig } from '../config'
import { allocateOutputTimestamp, persistActiveSession, isSessionMutationPending } from '../session'
import { writeImageOutput } from '../utils/file-output'
import { validateImage } from '../image-processing'
import { ImageMetadata } from '../utils/image-metadata'
import { log, logGenerationStart, logGenerationComplete, logGenerationFailed, serializeError } from '../logger'
import { DrainTracker } from './drain-tracker'
import { addRun, CANCELLED_MESSAGE, isQueuePaused, laneWidth, removeRun, runCount, type GenerationRun } from './cancellation'
import { isQuitting } from '../quit-state'
import { publishQueueState, publishQueueControlState } from '../queue/publisher'
import { pauseForStorageFailure, resetStorageFailureNotice } from '../queue/storage-failure'
import { generateOpenAI } from './openai'
import { generateNanoBanana } from './nanobanana'
import { generateGrok } from './grok'
import { generateFlux } from './flux'
import { generateDrawThings } from './drawthings'
import { generateSlug } from './slug'
import { generationFailurePresentation } from '../failure-presentation'
import { providerMessage } from '../provider-errors'
import { maskDiagnostic } from '../records'

// Every generator takes the queue's cancellation signal. It is a parameter
// rather than something each backend registers for itself: registration lived
// in Draw Things alone, which made "stop generating" a Draw-Things-only command
// and left the four cloud backends running with no way to reach them.
// A generator returns the seed it sent, when it sent one, for the sidecar.
type GenerateFn = (task: Task, signal: AbortSignal) => Promise<{ buffer: Buffer; mimeType?: string; seed?: number }>

const generators: Record<BackendId, GenerateFn> = {
  openai: generateOpenAI,
  nanobanana: generateNanoBanana,
  grok: generateGrok,
  flux: generateFlux,
  drawthings: generateDrawThings
}

// Tracks one continuous busy period (a "drain") across all backends so the
// queue logs a single aggregate summary instead of an info line per image.
// Process-global like the queue itself; per-image start/complete stay at debug.
const drainTracker = new DrainTracker()

// Each cloud backend runs up to its Concurrency setting at once (developer
// decision): the image is made on the provider, another device, and while one
// request runs, typically tens of seconds, the Mac's processor and network are
// near idle, so requests side by side finish a batch sooner. The right number
// depends on the account's rate tier, which only its owner knows. Draw Things
// runs one at a time: one local generation already keeps the graphics
// processor near full use.
function laneLimit(backend: BackendId, config: ReturnType<typeof loadConfig>): number {
  return backend === 'drawthings' ? 1 : config.image_backends[backend].concurrency
}

/** The session's start decision, made after each session command, each run's
 *  reported result, a resume, a settings save and a cancelled quit. Starts every
 *  queued task its lane has room for; nothing starts during a session command,
 *  once quit has begun, or while paused. */
export function processQueues(): void {
  if (isQuitting() || isSessionMutationPending()) return
  // Close out a finished drain before scheduling new work: once nothing is in
  // flight and nothing is queued, the busy period that just ended gets its one
  // summary line.
  const summary = drainTracker.finalize(performance.now(), runCount() === 0 && !queueManager.hasQueuedTasks())
  if (summary) {
    log('info', 'Queue drained', { ...summary })
  }

  // Paused: start nothing new. Work already running is deliberately untouched —
  // it finishes and saves normally, which is the whole point of pausing rather
  // than stopping. Cancelling in-flight work is a separate, explicit action.
  if (isQueuePaused()) return
  resetStorageFailureNotice()

  const config = loadConfig()
  for (const backend of BACKEND_IDS_IN_UI_ORDER) {
    const limit = laneLimit(backend, config)
    const tasks = queueManager.getActiveTasks(backend)

    for (let i = tasks.length - 1; i >= 0; i--) {
      const task = tasks[i]
      if (laneWidth(backend) >= limit) break
      if (task.status !== 'queued') continue

      // The manifest records the task as generating before anything is paid
      // for, so a crash leaves it interrupted rather than silently lost. If
      // that write fails, nothing starts: the task stays queued and the queue
      // pauses until the user resumes it.
      queueManager.updateTask(task, { status: 'generating', startedAt: new Date().toISOString() })
      drainTracker.begin(performance.now())
      logGenerationStart(task.id, backend, task.model)
      // The run joins its lane before its first await and before publishing,
      // so the menu count includes this task.
      const run: GenerationRun = {
        backend, generation: new AbortController(), naming: new AbortController(), cancellable: true, done: Promise.resolve(),
      }
      addRun(task.id, run)
      run.done = processTask(backend, task, run).finally(() => {
        removeRun(task.id)
        processQueues()
      })
      publishQueueState()
    }
  }
}

async function processTask(backend: BackendId, task: Task, run: GenerationRun): Promise<void> {
  const generate = generators[backend]
  const started = performance.now()
  const controller = run.generation
  try {
    await persistActiveSession()
  } catch (error) {
    queueManager.updateTask(task, { status: controller.signal.aborted ? 'interrupted' : 'queued', startedAt: null })
    if (controller.signal.aborted) drainTracker.recordCancelled()
    run.cancellable = false
    pauseForStorageFailure('start', error)
    return
  }

  // Only generate() is cancellable work. Once it resolves, the image exists
  // (and, on a cloud backend, is paid for) — so the run stops being cancellable
  // RIGHT THEN, not in the finally: a Stop arriving during the slug/write phase
  // must neither count this task as cancelled nor reach it. Quit still waits
  // for it, and aborts the slug call so the image is saved under a random name.
  let generated = false

  try {
    controller.signal.throwIfAborted()
    const { buffer: imageBuffer, seed } = await generate(task, controller.signal)
    generated = true
    run.cancellable = false
    publishQueueControlState()
    const completedAt = new Date()

    const durationMs = performance.now() - started
    queueManager.updateTask(task, { completedAt: completedAt.toISOString(), durationMs })

    const ext = await validateImage(imageBuffer)

    // Generate slug and allocate timestamp
    const slug = await generateSlug(task.prompt, task.id, run.naming.signal)
    const { timestamp, utc, ordinal } = allocateOutputTimestamp(backend)

    const metadata: ImageMetadata = {
      prompt: task.prompt,
      backend,
      model: task.model,
      params: task.params,
      slug,
      status: 'completed',
      enqueued_at: task.enqueuedAt,
      started_at: task.startedAt!,
      completed_at: completedAt.toISOString(),
      file_timestamp: utc,
      duration_ms: durationMs,
      seed: seed ?? null,
      error: null
    }

    let baseName: string
    try {
      baseName = await writeImageOutput(timestamp, ordinal, slug, backend, imageBuffer, metadata, ext, async (output) => {
        queueManager.updateTask(task, { pendingOutput: output })
        await persistActiveSession()
      })
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

    queueManager.updateTask(task, { status: 'completed', pendingOutput: undefined, baseName, imagePath: `${baseName}.${ext}` })
    drainTracker.recordOk()
    logGenerationComplete(task.id, durationMs, baseName)
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
      queueManager.updateTask(task, {
        status: 'interrupted', startedAt: null, completedAt: null, durationMs: null, error: null, providerMessage: null,
      })
      drainTracker.recordCancelled()
      log('info', 'Generation stopped by request', { taskId: task.id, backend })
    } else {
      // The task and manifest keep deliberately authored presentation copy. The
      // complete diagnostic (type, message, stack, cause) remains in the log.
      const presentation = generationFailurePresentation(backend, err, generated)
      const error = maskDiagnostic(presentation) as typeof presentation
      // The provider's own words, kept beside the authored copy rather than in
      // it. A save failure after a successful generation is not its answer.
      queueManager.updateTask(task, { status: 'failed', error, providerMessage: generated ? null : maskDiagnostic(providerMessage(err)) as string | null })
      drainTracker.recordFailed()
      logGenerationFailed(task.id, err, {
        backend,
        model: task.model,
        prompt: task.prompt,
        params: task.params,
        durationMs: performance.now() - started
      })
    }
  } finally {
    run.cancellable = false
  }

  try {
    await persistActiveSession()
  } catch (err) {
    pauseForStorageFailure('finish', err)
  }
  // Quit waits for the run through its final state publication too, not
  // merely for the backend request or child to exit.
  publishQueueState()
}
