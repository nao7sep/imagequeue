import { log } from '../logger'

// The registry of in-flight generations, and the queue's paused flag. Both exist
// for one reason: nothing in this app could previously stop image generation.
// The processor polls every 500ms and starts any task sitting in `queued`, and
// the work itself was unreachable — a Draw Things child process handle lived
// inside its own promise, and cloud requests carried no abort signal. Killing
// the CLI from Activity Monitor therefore just failed one task and started the
// next, which is why the only reliable stop was quitting the app.
//
// Same shape as brainstorm.ts's controller registry: a run registers on entry
// and deletes on exit, so a cancel arriving late is a harmless no-op.

/** The error a cancelled generation rejects with. The processor recognises it to
 *  mark the task stopped-and-retryable rather than failed — a cancellation is not
 *  an error to show the user, it is a thing they asked for. */
export const CANCELLED_MESSAGE = 'Generation stopped.'

/** How a single in-flight generation is stopped. Cloud backends abort their
 *  request; Draw Things kills its child process. */
type CancelFn = () => void

const inFlight = new Map<string, CancelFn>()

/** Set while the queue is paused: the processor starts nothing new, but work
 *  already running is left alone to finish and save normally. This is the
 *  "stop, but let the current image complete" case — the common one, and the
 *  only stop that costs nothing (no partial output, no wasted API call). */
let paused = false

export function isQueuePaused(): boolean {
  return paused
}

export function setQueuePaused(next: boolean): void {
  if (paused === next) return
  paused = next
  log('info', next ? 'Queue paused' : 'Queue resumed', { inFlight: inFlight.size })
}

/** Register a running generation's canceller for the duration of the call. */
export function registerInFlight(taskId: string, cancel: CancelFn): void {
  inFlight.set(taskId, cancel)
}

export function clearInFlight(taskId: string): void {
  inFlight.delete(taskId)
}

/** Stop one running generation. The generation's own failure path then marks the
 *  task — a cancelled request rejects exactly like a failed one, and the caller
 *  decides what status it lands in. Returns false when the task was not running. */
export function cancelInFlight(taskId: string): boolean {
  const cancel = inFlight.get(taskId)
  if (!cancel) return false
  try {
    cancel()
  } catch (err) {
    // A canceller that throws must not stop the others being cancelled.
    log('warn', 'Cancelling a generation threw', { taskId, error: String(err) })
  }
  return true
}

/** Stop every running generation. Returns how many were signalled. */
export function cancelAllInFlight(): number {
  let count = 0
  for (const taskId of [...inFlight.keys()]) {
    if (cancelInFlight(taskId)) count++
  }
  return count
}

export function inFlightCount(): number {
  return inFlight.size
}

/** Test seam: drop all state between cases. */
export function resetCancellationState(): void {
  inFlight.clear()
  paused = false
}
