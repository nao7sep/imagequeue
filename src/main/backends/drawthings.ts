import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { getSessionDir } from '../session'
import { log, logApiRequest, logApiResponse } from '../logger'
import { modelsDirArgs, ensureModelsDir, resolveEffectiveModelsDir } from '../local-cli'

export async function generateDrawThings(task: Task): Promise<Buffer> {
  return generateDrawThingsCli(task)
}

async function generateDrawThingsCli(task: Task): Promise<Buffer> {
  const config = loadConfig()
  const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'

  ensureModelsDir()

  const outputPath = path.join(getSessionDir(), `_local_temp_${Date.now()}.png`)

  const args = [
    'generate',
    '--model', task.model,
    '--prompt', task.prompt,
    '--output', outputPath,
    '--steps', String((task.params.steps as number) || 4),
    '--cfg', String((task.params.guidance as number) || 1),
    '--width', String((task.params.width as number) || 1024),
    '--height', String((task.params.height as number) || 1024),
    '--disable-preview',
    ...modelsDirArgs()
  ]

  if (task.params.seed != null && (task.params.seed as number) > 0) {
    args.push('--seed', String(task.params.seed))
  }
  if (task.params.negativePrompt) {
    args.push('--negative-prompt', String(task.params.negativePrompt))
  }

  logApiRequest('drawthings', 'draw-things-cli generate', {
    model: task.model,
    steps: task.params.steps,
    guidance: task.params.guidance,
    width: task.params.width,
    height: task.params.height,
    seed: task.params.seed,
    negativePrompt: task.params.negativePrompt
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
  return buffer
}

// Check if a model file exists in the effective models directory.
export function checkModelExists(modelFilename: string): boolean {
  const dir = resolveEffectiveModelsDir()
  if (!dir) return false
  return fs.existsSync(path.join(dir, modelFilename))
}

