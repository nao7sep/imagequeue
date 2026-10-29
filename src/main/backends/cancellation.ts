import type { BackendId } from '../../shared/types'
import { log } from '../logger'

// The generation lanes, one per backend, and the queue's paused flag. Each lane
// holds the generations it is running; a lane's width is how many of its runs
// are here. The session starts runs (processor.ts) and applies their results.

/** The error a cancelled generation rejects with. The processor recognises it to
 *  mark the task stopped-and-retryable rather than failed — a cancellation is not
 *  an error to show the user, it is a thing they asked for. */
export const CANCELLED_MESSAGE = 'Generation stopped.'

/** One running generation. A Stop reaches it through `generation` only while it
 *  is `cancellable`: once its image bytes arrive (and, on a cloud backend, are
 *  paid for) it is not, so a Stop neither counts it as cancelled nor reaches it.
 *  Quit also aborts `naming`, so the image is saved under a random name instead
 *  of waiting on the network. `done` settles once its outcome is saved and
 *  published. */
export interface GenerationRun {
  backend: BackendId
  generation: AbortController
  naming: AbortController
  cancellable: boolean
  done: Promise<void>
}

const runs = new Map<string, GenerationRun>()

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
  log('info', next ? 'Queue paused' : 'Queue resumed', { inFlight: generatingCount() })
}

export function addRun(taskId: string, run: GenerationRun): void {
  runs.set(taskId, run)
}

export function removeRun(taskId: string): void {
  runs.delete(taskId)
}

/** How many generations the backend's lane is running. */
export function laneWidth(backend: BackendId): number {
  let count = 0
  for (const run of runs.values()) if (run.backend === backend) count++
  return count
}

/** Every lane's runs together. */
export function runCount(): number {
  return runs.size
}

/** Runs a Stop can still reach: the menu's and the controls' "generating" count. */
export function generatingCount(): number {
  let count = 0
  for (const run of runs.values()) if (run.cancellable) count++
  return count
}

/** Stops every generation a Stop can still reach. Each run's own failure path
 *  then marks its task. Returns how many were signalled. */
export function stopGenerations(): number {
  let count = 0
  for (const run of runs.values()) {
    if (!run.cancellable) continue
    run.generation.abort()
    count++
  }
  return count
}

/** Quit: stop every generation, abort naming, and settle when every run has
 *  saved its outcome. The quit owner's exit deadline bounds the wait. */
export function stopAllRuns(): Promise<void> {
  stopGenerations()
  const done: Promise<void>[] = []
  for (const run of runs.values()) {
    run.naming.abort()
    done.push(run.done)
  }
  return Promise.all(done).then(() => undefined)
}

/** Test seam: drop all state between cases. */
export function resetCancellationState(): void {
  runs.clear()
  paused = false
}
