import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { getSessionDir } from '../session'
import { log, logApiRequest, logApiResponse } from '../logger'
import { modelsDirArgs, ensureModelsDir, resolveEffectiveModelsDir } from '../local-cli'

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

  const width = (task.params.width as number | undefined) ?? defaults.fallback_width
  const height = (task.params.height as number | undefined) ?? defaults.fallback_height
  const steps = (task.params.steps as number | undefined) ?? defaults.fallback_steps
  const cfg = (task.params.cfg as number | undefined) ?? defaults.fallback_cfg
  const seed = (task.params.seed as number | undefined | null) ?? defaults.seed
  const negativePrompt = (task.params.negativePrompt as string | undefined) ?? defaults.negativePrompt

  const args = [
    'generate',
    '--model', task.model,
    '--prompt', task.prompt,
    '--output', outputPath,
    '--width', String(width),
    '--height', String(height),
    '--steps', String(steps),
    '--cfg', String(cfg),
    '--disable-preview',
    ...modelsDirArgs()
  ]

  if (seed != null && seed > 0) {
    args.push('--seed', String(seed))
  }
  if (negativePrompt) {
    args.push('--negative-prompt', negativePrompt)
  }

  logApiRequest('drawthings', 'draw-things-cli generate', {
    model: task.model,
    width,
    height,
    steps,
    cfg,
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
      log('error', 'draw-things-cli spawn failed', { cliPath, message: err.message })
      reject(new Error(`Failed to spawn draw-things-cli: ${err.message}`))
    })
  })

  if (!fs.existsSync(outputPath)) {
    log('error', 'draw-things-cli produced no output file', { model: task.model, outputPath })
    throw new Error('draw-things-cli did not produce output file')
  }

  logApiResponse('drawthings', 'ok', Date.now() - startTime)

  const buffer = fs.readFileSync(outputPath)
  fs.unlinkSync(outputPath)
  return { buffer }
}

// Check if a model file exists in the effective models directory.
export function checkModelExists(modelFilename: string): boolean {
  const dir = resolveEffectiveModelsDir()
  if (!dir) return false
  return fs.existsSync(path.join(dir, modelFilename))
}
