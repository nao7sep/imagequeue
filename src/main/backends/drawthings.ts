import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { getSessionDir } from '../session'
import { log, logApiRequest, logApiResponse, serializeError } from '../logger'
import { modelsDirArgs, ensureModelsDir, resolveModelsDir } from '../local-cli'

export async function generateDrawThings(task: Task): Promise<{ buffer: Buffer; mimeType?: string }> {
  return generateDrawThingsCli(task)
}

async function generateDrawThingsCli(task: Task): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const defaults = config.image_backends.drawthings.default_params
  const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'

  ensureModelsDir()

  const outputPath = path.join(getSessionDir(), `_local_temp_${Date.now()}.png`)
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

    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('close', (code) => {
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
  })

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
