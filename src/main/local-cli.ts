// Draw Things CLI integration — detection, model management, generation helpers.
// macOS only. On other platforms, all functions return appropriate "unsupported" values.

import { execFile, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { loadConfig } from './config'
import { log } from './logger'

export interface CliStatus {
  installed: boolean
  version: string | null
  path: string | null
  platform: 'darwin' | 'unsupported'
}

export interface LocalModelInfo {
  file: string
  name: string
  source: string
  downloaded: boolean
  huggingFace: string | null
}

const DEFAULT_MODELS_DIR = path.join(os.homedir(), '.imagequeue', 'models')

/** Resolve the effective models directory. Empty string means use CLI's default (no --models-dir). */
export function resolveModelsDir(): string {
  const config = loadConfig()
  const dir = config.image_backends.drawthings.models_dir
  if (!dir) return '' // empty = let CLI use its own default
  return dir.replace(/^~/, os.homedir())
}

/** Ensure the models directory exists (creates if needed). Returns the resolved path, or empty for CLI default. */
export function ensureModelsDir(): string {
  const dir = resolveModelsDir()
  if (!dir) return '' // CLI default — don't create anything
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** Build the --models-dir arg pair if applicable. */
export function modelsDirArgs(): string[] {
  const dir = resolveModelsDir()
  if (!dir) return []
  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
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

/** Known Draw Things system model locations (probed in order when models_dir is not configured). */
const DRAW_THINGS_SYSTEM_DIRS = [
  path.join(os.homedir(), 'Library/Containers/com.liuliu.draw-things/Data/Documents/Models'),
  path.join(os.homedir(), 'Library/Containers/com.liuliu.draw-things/Data/Documents/models'),
]

/**
 * Resolve where Draw Things models actually live.
 * Priority: configured models_dir → known system paths → empty string.
 * Returns empty string only when no directory can be determined.
 */
export function resolveEffectiveModelsDir(): string {
  const configured = resolveModelsDir()
  if (configured) return configured // user set it explicitly — honour it
  for (const p of DRAW_THINGS_SYSTEM_DIRS) {
    if (fs.existsSync(p)) return p
  }
  return ''
}

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9/_.-]+$/.test(s)) return s
  return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * Open a Terminal.app window to import a model artifact via `draw-things-cli models import`.
 * artifactPath is the full absolute path to the file to import. macOS only.
 */
export async function openTerminalForImport(artifactPath: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Terminal launch only supported on macOS')
  }

  const config = loadConfig()
  const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'
  const dir = resolveEffectiveModelsDir()

  const parts = [shellQuote(cliPath), 'models', 'import', shellQuote(artifactPath)]
  if (dir) parts.push('--models-dir', shellQuote(dir))
  const cmd = parts.join(' ')

  const scriptContent = `#!/bin/sh\n${cmd}\n`
  const tmpFile = path.join(os.tmpdir(), `imagequeue-import-${Date.now()}.command`)
  fs.writeFileSync(tmpFile, scriptContent, { mode: 0o755 })

  return new Promise((resolve, reject) => {
    execFile('open', [tmpFile], (err) => {
      if (err) {
        log('error', 'Failed to open Terminal for model import', { artifactPath, message: err.message })
        reject(err)
      } else {
        log('info', 'Opened Terminal for model import', { artifactPath, cmd })
        resolve()
      }
    })
  })
}

/**
 * Open a Terminal.app window to download a model visibly. macOS only.
 * Writes a temporary .command file (auto-opened by Terminal) so the user can watch progress.
 */
export async function openTerminalForDownload(modelFile: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Terminal launch only supported on macOS')
  }

  const config = loadConfig()
  const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'
  const dir = resolveModelsDir()

  const parts = [shellQuote(cliPath), 'models', 'ensure', '--model', shellQuote(modelFile)]
  if (dir) parts.push('--models-dir', shellQuote(dir))
  const cmd = parts.join(' ')

  const scriptContent = `#!/bin/sh\n${cmd}\n`
  const tmpFile = path.join(os.tmpdir(), `imagequeue-download-${Date.now()}.command`)
  fs.writeFileSync(tmpFile, scriptContent, { mode: 0o755 })

  return new Promise((resolve, reject) => {
    execFile('open', [tmpFile], (err) => {
      if (err) {
        log('error', 'Failed to open Terminal for model download', { modelFile, message: err.message })
        reject(err)
      } else {
        log('info', 'Opened Terminal for model download', { modelFile, cmd })
        resolve()
      }
    })
  })
}
