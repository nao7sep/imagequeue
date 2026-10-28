import { spawn } from 'node:child_process'
import { CLI_HARD_KILL_DELAY_MS } from '../../shared/cli-jobs'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { getTempDir } from '../dependencies/paths'
import { CANCELLED_MESSAGE } from './cancellation'
import { DrawThingsOutOfMemoryError, ProviderTimeoutError } from '../provider-errors'
export { DrawThingsOutOfMemoryError } from '../provider-errors'
import { log, serializeError } from '../logger'
import { startAiCall } from '../records'
import { modelsDirArgs, resolveCliPath } from '../local-cli'
import { drawThingsDimension } from '../../shared/models'

// The CLI runs in its own process, so running out of memory ends it, never
// ImageQueue. Only explicit allocation evidence supports that diagnosis;
// a terminating signal alone could be a crash or an external stop. Allocation
// failures include the requested size in their presentation.
const OUT_OF_MEMORY = /out of memory|insufficient memory|outofmemory|failed to allocate|allocation fail/i

/** Whether a CLI exit that was not a stop or a timeout was a memory failure. */
export function isOutOfMemoryExit(_code: number | null, _signal: NodeJS.Signals | null, stderr: string): boolean {
  return OUT_OF_MEMORY.test(stderr)
}

export async function generateDrawThings(task: Task, signal: AbortSignal): Promise<{ buffer: Buffer; mimeType?: string; seed?: number }> {
  // Same guard as the cloud backends with manual wiring: an already-aborted
  // signal never fires its listener, so it must be answered before spawn.
  if (signal.aborted) throw new Error(CANCELLED_MESSAGE)
  return generateDrawThingsCli(task, signal)
}

async function generateDrawThingsCli(task: Task, signal: AbortSignal): Promise<{ buffer: Buffer; mimeType?: string; seed?: number }> {
  const config = loadConfig()
  const defaults = config.image_backends.drawthings.default_params
  const cliPath = resolveCliPath()


  // Staged in the app's temp directory, NEVER the session directory. Draw
  // Things is the one backend where an external process owns the file: the CLI
  // writes it, we read it in and delete it. Cloud backends return bytes over
  // HTTP and touch disk only as their final named output, so they cannot strand
  // anything. If the app dies (or is killed) between spawn and read, the CLI
  // finishes writing into a directory nobody is watching — in the session folder
  // that left a permanent `drawthings-<id>.png` the app never handled; here it
  // is a staging file that clearTempDir sweeps at the next launch.
  const outputPath = path.join(getTempDir(), `drawthings-${nanoid()}.png`)
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })

  const requestedWidth = task.params.width as number | undefined
  const requestedHeight = task.params.height as number | undefined
  const width = requestedWidth == null ? undefined : drawThingsDimension(requestedWidth)
  const height = requestedHeight == null ? undefined : drawThingsDimension(requestedHeight)
  const steps = task.params.steps as number | undefined
  const guidance = task.params.guidance as number | undefined
  const seed = (task.params.seed as number | undefined | null) ?? defaults.seed
  const hasNegativePrompt = Object.prototype.hasOwnProperty.call(task.params, 'negativePrompt')
  const negativePrompt = task.params.negativePrompt as string | undefined

  const args = [
    'generate',
    '--model', task.model,
    '--prompt', task.prompt,
    '--output', outputPath,
    '--disable-preview',
    // A missing model is the Models window's to download, never a silent part
    // of generating: the user decides when gigabytes are fetched.
    '--no-download-missing',
    // Decoding the finished image in tiles roughly halves the peak memory at
    // 2048×1152 (measured 8.8 GB to 4.4 GB) with the same image and time, and
    // decoding is the stage whose memory grows fastest with size. Tiled
    // diffusion stays off: it can change the composition.
    '--config-json', JSON.stringify({ tiledDecoding: true }),
    ...await modelsDirArgs()
  ]

  if (width != null) args.push('--width', String(width))
  if (height != null) args.push('--height', String(height))
  if (steps != null) args.push('--steps', String(steps))
  if (guidance != null) args.push('--cfg', String(guidance))
  if (seed != null && seed > 0) {
    args.push('--seed', String(seed))
  }
  if (hasNegativePrompt) {
    args.push('--negative-prompt', negativePrompt ?? '')
  }

  const { timeout_ms } = loadConfig().image_backends.drawthings
  const record = startAiCall({ backend: 'drawthings', model: task.model, purpose: 'image', taskId: task.id, request: { command: cliPath, args } })

  if (signal.aborted) throw new Error(CANCELLED_MESSAGE)
  // A failed or stopped run may leave a partial image; it goes at once rather
  // than waiting for the next launch's temp sweep.
  const removePartial = (): Promise<void> => fs.promises.rm(outputPath, { force: true }).catch(() => undefined)
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(cliPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let cancelled = false
      let timedOut = false

      let closed = false
      let stopping = false
      let spawnError: Error | undefined
      let hardKillTimer: ReturnType<typeof setTimeout> | undefined
      const stop = (): void => {
        if (closed || stopping) return
        stopping = true
        proc.kill('SIGTERM')
        hardKillTimer = setTimeout(() => {
          if (!closed) proc.kill('SIGKILL')
        }, CLI_HARD_KILL_DELAY_MS)
      }
      const timer = setTimeout(() => {
        timedOut = true
        stop()
      }, timeout_ms)
      const onAbort = (): void => {
        cancelled = true
        stop()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      // Preparation can yield before listener registration.
      if (signal.aborted) onAbort()

      // Both pipes are drained as the CLI writes: an unread pipe fills and the
      // CLI blocks on its next write until the timeout kills it.
      proc.stdout.setEncoding('utf8')
      proc.stderr.setEncoding('utf8')
      proc.stdout.on('data', (chunk: string) => { stdout += chunk })
      proc.stderr.on('data', (chunk: string) => { stderr += chunk })
      proc.on('close', (code, exitSignal) => {
        closed = true
        clearTimeout(timer)
        clearTimeout(hardKillTimer)
        signal.removeEventListener('abort', onAbort)
        const answer = { exitCode: code, signal: exitSignal, stdout, stderr }
        const fail = (err: Error): void => {
          record.fail(err, answer)
          reject(err)
        }
        if (spawnError) {
          fail(new Error(`Failed to spawn draw-things-cli: ${spawnError.message}`, { cause: spawnError }))
          return
        }
        if (cancelled) {
          fail(new Error(CANCELLED_MESSAGE))
          return
        }
        if (timedOut) {
          log('error', 'draw-things-cli timed out', { model: task.model, timeoutMs: timeout_ms })
          fail(new ProviderTimeoutError('Draw Things generation', timeout_ms))
          return
        }
        if (code === 0) {
          record.finish(answer)
          resolve()
        } else if (isOutOfMemoryExit(code, exitSignal, stderr)) {
          log('error', 'draw-things-cli ran out of memory', { code, signal: exitSignal, model: task.model, width, height, stderr })
          fail(new DrawThingsOutOfMemoryError(width, height, exitSignal ? `killed by ${exitSignal}` : stderr))
        } else {
          log('error', 'draw-things-cli exited with error', { code, signal: exitSignal, model: task.model, stderr })
          fail(new Error(`draw-things-cli exited with ${exitSignal ? `signal ${exitSignal}` : `code ${code}`}: ${stderr}`))
        }
      })
      proc.on('error', (err) => {
        log('error', 'draw-things-cli spawn failed', { cliPath, error: serializeError(err) })
        spawnError = err
      })
    })
  } catch (error) {
    await removePartial()
    throw error
  }

  if (!await fs.promises.stat(outputPath).then(() => true, () => false)) {
    log('error', 'draw-things-cli produced no output file', { model: task.model, outputPath })
    throw new Error('draw-things-cli did not produce output file')
  }

  try {
    const buffer = await fs.promises.readFile(outputPath)
    return { buffer, ...(seed != null && seed > 0 ? { seed } : {}) }
  } finally {
    try { await fs.promises.unlink(outputPath) } catch { /* ignore */ }
  }
}
