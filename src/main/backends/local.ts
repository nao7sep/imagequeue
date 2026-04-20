import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { getSessionDir } from '../session'
import { logApiRequest, logApiResponse } from '../logger'

// Runs draw-things-cli generate and returns the generated image as a Buffer.
export async function generateLocal(task: Task): Promise<Buffer> {
  const config = loadConfig()
  let cliPath = config.image_backends.local.cli_path

  if (!cliPath) {
    cliPath = 'draw-things-cli'
  }

  const modelsDir = config.image_backends.local.models_dir.replace('~', os.homedir())
  const outputPath = path.join(getSessionDir(), `_local_temp_${Date.now()}.png`)

  const args = [
    'generate',
    '--model', task.model,
    '--prompt', task.prompt,
    '--output', outputPath,
    '--steps', String((task.params.steps as number) || 20),
    '--width', String((task.params.width as number) || 1024),
    '--height', String((task.params.height as number) || 1024),
    '--disable-preview'
  ]

  if (task.params.seed != null && (task.params.seed as number) > 0) {
    args.push('--seed', String(task.params.seed))
  }

  if (task.params.guidance != null) {
    args.push('--guidance', String(task.params.guidance))
  }

  if (task.params.negativePrompt) {
    args.push('--negative_prompt', String(task.params.negativePrompt))
  }

  if (modelsDir) {
    args.push('--models-dir', modelsDir)
  }

  logApiRequest('local', 'draw-things-cli generate', {
    model: task.model,
    steps: task.params.steps,
    width: task.params.width,
    height: task.params.height,
    seed: task.params.seed,
    guidance: task.params.guidance
  })
  const startTime = Date.now()

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cliPath, args, { stdio: 'pipe' })
    let stderr = ''

    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`draw-things-cli exited with code ${code}: ${stderr}`))
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn draw-things-cli: ${err.message}`))
    })
  })

  if (!fs.existsSync(outputPath)) {
    throw new Error('draw-things-cli did not produce output file')
  }

  logApiResponse('local', 'ok', Date.now() - startTime)

  const buffer = fs.readFileSync(outputPath)
  fs.unlinkSync(outputPath)
  return buffer
}

// Check if a model file exists in the configured models directory.
export function checkModelExists(modelFilename: string): boolean {
  const config = loadConfig()
  const modelsDir = config.image_backends.local.models_dir.replace('~', os.homedir())
  if (!modelsDir) return false
  return fs.existsSync(path.join(modelsDir, modelFilename))
}
