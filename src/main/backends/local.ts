import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { getSessionDir } from '../session'

// Runs Draw Things CLI and returns the generated image as a Buffer.
export async function generateLocal(task: Task): Promise<Buffer> {
  const config = loadConfig()
  let cliPath = config.image_backends.local.cli_path

  // If cli_path is empty, try to find draw-things-cli in PATH
  if (!cliPath) {
    cliPath = 'draw-things-cli'
  }

  const modelsDir = config.image_backends.local.models_dir.replace('~', os.homedir())
  fs.mkdirSync(modelsDir, { recursive: true })

  const outputPath = path.join(getSessionDir(), `_local_temp_${Date.now()}.png`)

  const args = [
    '--prompt', task.prompt,
    '--output', outputPath,
    '--model', task.model,
    '--models-dir', modelsDir,
    '--steps', String((task.params.steps as number) || 20),
    '--width', String((task.params.width as number) || 1024),
    '--height', String((task.params.height as number) || 1024)
  ]

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

  const buffer = fs.readFileSync(outputPath)
  fs.unlinkSync(outputPath)
  return buffer
}
