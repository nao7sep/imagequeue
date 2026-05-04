// Draw Things CLI integration — detection, model management, generation helpers.
// macOS only. On other platforms, all functions return appropriate "unsupported" values.

import { execFile, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { loadConfig } from './config'
import { log } from './logger'
import { CliStatus, LocalModelInfo } from '../shared/types'

export type { CliStatus, LocalModelInfo }

const DEFAULT_MODELS_DIR = path.join(os.homedir(), '.imagequeue', 'models')

/** Resolve the effective models directory. Empty config uses ImageQueue's private models dir. */
export function resolveModelsDir(): string {
  const config = loadConfig()
  const dir = config.image_backends.drawthings.models_dir
  if (!dir) return DEFAULT_MODELS_DIR
  return dir.replace(/^~/, os.homedir())
}

/** Ensure the models directory exists (creates if needed). */
export function ensureModelsDir(): string {
  const dir = resolveModelsDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** Build the --models-dir arg pair used by every Draw Things model/generation command. */
export function modelsDirArgs(): string[] {
  const dir = ensureModelsDir()
  return ['--models-dir', dir]
}

/** Check if Draw Things CLI is available. */
export async function checkCli(): Promise<CliStatus> {
  if (process.platform !== 'darwin') {
    return { installed: false, version: null, path: null, platform: 'unsupported' }
  }

  const config = loadConfig()
  const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'

  return new Promise((resolve) => {
    execFile(cliPath, ['--version'], { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        log('warn', 'draw-things-cli check failed', { cliPath, message: error.message, stderr })
        resolve({ installed: false, version: null, path: null, platform: 'darwin' })
      } else {
        const version = stdout.trim() || null
        resolve({ installed: true, version, path: cliPath, platform: 'darwin' })
      }
    })
  })
}

/** Parse the tabular output of `draw-things-cli models list`. */
function parseModelList(output: string): LocalModelInfo[] {
  const lines = output.split('\n')
  const models: LocalModelInfo[] = []

  // Find the header separator line (dashes)
  let dataStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('---')) {
      dataStart = i + 1
      break
    }
  }
  if (dataStart < 0) return models

  // Find column positions from header separator
  const sepLine = lines[dataStart - 1]
  const cols: { start: number; end: number }[] = []
  let inCol = false
  let colStart = 0
  for (let i = 0; i <= sepLine.length; i++) {
    const ch = sepLine[i]
    if (ch === '-' && !inCol) {
      inCol = true
      colStart = i
    } else if (ch !== '-' && inCol) {
      cols.push({ start: colStart, end: i })
      inCol = false
    }
  }
  if (inCol) cols.push({ start: colStart, end: sepLine.length })

  // Parse data lines
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const values = cols.map((col) => line.slice(col.start, col.end).trim())
    const [file, name, source, downloaded, hf] = values

    if (!file) continue
    models.push({
      file,
      name: name || file,
      source: source || 'unknown',
      downloaded: downloaded === 'yes',
      huggingFace: hf && hf !== '-' ? hf : null
    })
  }

  return models
}

/** List downloaded models via CLI. */
export async function listDownloadedModels(): Promise<LocalModelInfo[]> {
  const config = loadConfig()
  const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'
  const args = ['models', 'list', '--downloaded-only', ...modelsDirArgs()]

  return new Promise((resolve) => {
    execFile(cliPath, args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        log('error', 'draw-things-cli models list (downloaded) failed', { cliPath, args, message: error.message, stderr })
        resolve([])
      } else {
        resolve(parseModelList(stdout))
      }
    })
  })
}

/** List all available models via CLI. */
export async function listAvailableModels(): Promise<LocalModelInfo[]> {
  const config = loadConfig()
  const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'
  const args = ['models', 'list', ...modelsDirArgs()]

  return new Promise((resolve) => {
    execFile(cliPath, args, { timeout: 30000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      if (error) {
        log('error', 'draw-things-cli models list (all) failed', { cliPath, args, message: error.message, stderr })
        resolve([])
      } else {
        resolve(parseModelList(stdout))
      }
    })
  })
}

export interface EnsureModelResult {
  success: boolean
  error?: string
}

/** Download/ensure a model via CLI. Returns a promise that resolves when complete. */
export async function ensureModel(modelFile: string): Promise<EnsureModelResult> {
  const config = loadConfig()
  const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'

  // Ensure models dir exists before downloading
  ensureModelsDir()

  const args = ['models', 'ensure', '--model', modelFile, ...modelsDirArgs()]

  return new Promise((resolve) => {
    log('info', 'Model download started', { modelFile })
    const proc = spawn(cliPath, args, { stdio: 'pipe' })
    let stderr = ''

    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.stdout.on('data', () => { /* consume stdout */ })

    proc.on('close', (code) => {
      if (code === 0) {
        log('info', 'Model download complete', { modelFile })
        resolve({ success: true })
      } else {
        log('error', 'Model download failed', { modelFile, code, stderr })
        resolve({ success: false, error: stderr || `exit code ${code}` })
      }
    })

    proc.on('error', (err) => {
      log('error', 'Model download spawn failed', { modelFile, message: err.message })
      resolve({ success: false, error: err.message })
    })
  })
}

/** Get the default models directory path (for display in UI/config). */
export function getDefaultModelsDir(): string {
  return DEFAULT_MODELS_DIR
}

/**
 * Read the `file` values from `custom.json` in the effective models directory.
 * Returns `null` when the file is absent or unreadable — callers should fall
 * back to heuristic detection in that case.
 * Returns a (possibly empty) array when the file exists and was parsed.
 * `custom.json` is the ground truth for locally-imported (external) models.
 */
export function readCustomJsonImportedFiles(): string[] | null {
  const dir = resolveEffectiveModelsDir()
  const customJsonPath = path.join(dir, 'custom.json')
  if (!fs.existsSync(customJsonPath)) return null

  try {
    const raw = fs.readFileSync(customJsonPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      log('warn', 'custom.json: top-level value is not an array', { customJsonPath })
      return null
    }
    return parsed
      .filter((entry): entry is { file: string } =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).file === 'string'
      )
      .map((entry) => entry.file)
  } catch (err) {
    log('warn', 'custom.json: failed to read or parse', { customJsonPath, message: (err as Error).message })
    return null
  }
}

/**
 * Resolve where Draw Things models actually live.
 * Empty config resolves to ImageQueue's private default models directory.
 */
export function resolveEffectiveModelsDir(): string {
  return resolveModelsDir()
}
