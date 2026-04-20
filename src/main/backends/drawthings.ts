import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { getSessionDir } from '../session'
import { log, logApiRequest, logApiResponse } from '../logger'
import { modelsDirArgs, ensureModelsDir } from '../local-cli'

// Runs draw-things-cli generate and returns the generated image as a Buffer.
export async function generateDrawThings(task: Task): Promise<Buffer> {
  const config = loadConfig()
  const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'

  // Ensure models directory exists
  ensureModelsDir()

  const outputPath = path.join(getSessionDir(), `_local_temp_${Date.now()}.png`)

  const args = [
    'generate',
    '--model', task.model,
    '--prompt', task.prompt,
    '--output', outputPath,
    '--steps', String((task.params.steps as number) || 4),
    '--width', String((task.params.width as number) || 1024),
    '--height', String((task.params.height as number) || 1024),
    '--disable-preview',
    ...modelsDirArgs()
  ]

  if (task.params.seed != null && (task.params.seed as number) > 0) {
    args.push('--seed', String(task.params.seed))
  }

  if (task.params.cfg != null && (task.params.cfg as number) > 0) {
    args.push('--cfg', String(task.params.cfg))
  }

  if (task.params.negativePrompt) {
    args.push('--negative-prompt', String(task.params.negativePrompt))
  }

  logApiRequest('drawthings', 'draw-things-cli generate', {
    model: task.model,
    steps: task.params.steps,
    width: task.params.width,
    height: task.params.height,
    seed: task.params.seed,
    cfg: task.params.cfg,
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
        log('error', 'draw-things-cli exited with error', {
          code,
          model: task.model,
          steps: task.params.steps,
          width: task.params.width,
          height: task.params.height,
          stderr
        })
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

// Check if a model file exists in the configured models directory.
export function checkModelExists(modelFilename: string): boolean {
  const config = loadConfig()
  const dir = config.image_backends.drawthings.models_dir
  if (!dir) return false
  const resolved = dir.replace(/^~/, require('os').homedir())
  if (!fs.existsSync(resolved)) return false
  return fs.existsSync(path.join(resolved, modelFilename))
}
