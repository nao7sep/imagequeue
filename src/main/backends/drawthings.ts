import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { getTempDir } from '../dependencies/paths'
import { CANCELLED_MESSAGE, clearInFlight, registerInFlight } from './cancellation'
import { log, logApiRequest, logApiResponse, serializeError } from '../logger'
import { modelsDirArgs, ensureModelsDir, resolveModelsDir, resolveCliPath } from '../local-cli'

export async function generateDrawThings(task: Task): Promise<{ buffer: Buffer; mimeType?: string }> {
  return generateDrawThingsCli(task)
}

async function generateDrawThingsCli(task: Task): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const defaults = config.image_backends.drawthings.default_params
  const cliPath = resolveCliPath()

  ensureModelsDir()

  // Staged in the app's temp directory, NEVER the session directory. Draw
  // Things is the one backend where an external process owns the file: the CLI
  // writes it, we read it in and delete it. Cloud backends return bytes over
  // HTTP and touch disk only as their final named output, so they cannot strand
  // anything. If the app dies (or is killed) between spawn and read, the CLI
  // finishes writing into a directory nobody is watching — in the session folder
  // that left a permanent `drawthings-<id>.png` the app never handled; here it
  // is a staging file that clearTempDir sweeps at the next launch.
  const outputPath = path.join(getTempDir(), `drawthings-${nanoid()}.png`)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  const width = task.params.width as number | undefined
  const height = task.params.height as number | undefined
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
    ...modelsDirArgs()
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

  logApiRequest('drawthings', 'draw-things-cli generate', {
    model: task.model,
    width,
    height,
    steps,
    guidance,
    seed,
    negativePrompt
  })
  const startTime = Date.now()

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cliPath, args, { stdio: 'pipe' })
    let stderr = ''
    let cancelled = false

    // The child process is the ONLY handle that can stop a Draw Things
    // generation: there is no request to abort and the CLI runs to completion
    // otherwise. Registered for the duration of the run so the queue can reach
    // it, with the same SIGTERM-then-SIGKILL escalation cli-jobs uses for
    // downloads — a CLI mid-write ignores a polite signal often enough to matter.
    registerInFlight(task.id, () => {
      cancelled = true
      try { proc.kill('SIGTERM') } catch { /* already gone */ }
      setTimeout(() => {
        try { proc.kill('SIGKILL') } catch { /* already gone */ }
      }, 2000)
    })

    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('close', (code) => {
      if (cancelled) {
        reject(new Error(CANCELLED_MESSAGE))
        return
      }
      if (code === 0) resolve()
      else {
        log('error', 'draw-things-cli exited with error', { code, model: task.model, stderr })
        reject(new Error(`draw-things-cli exited with code ${code}: ${stderr}`))
      }
    })
    proc.on('error', (err) => {
      log('error', 'draw-things-cli spawn failed', { cliPath, error: serializeError(err) })
      reject(new Error(`Failed to spawn draw-things-cli: ${err.message}`))
    })
  }).finally(() => clearInFlight(task.id))

  if (!fs.existsSync(outputPath)) {
    log('error', 'draw-things-cli produced no output file', { model: task.model, outputPath })
    throw new Error('draw-things-cli did not produce output file')
  }

  logApiResponse('drawthings', 'ok', Date.now() - startTime)

  try {
    const buffer = fs.readFileSync(outputPath)
    return { buffer }
  } finally {
    try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
  }
}

// Check if a model file exists in the configured models directory.
export function checkModelExists(modelFilename: string): boolean {
  const dir = resolveModelsDir()
  if (!dir) return false
  return fs.existsSync(path.join(dir, modelFilename))
}
