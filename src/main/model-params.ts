import fs from 'fs'
import path from 'path'
import type { DrawThingsModelParams } from '../shared/types'
import { ensureDataDir, getDataDir } from './config'
import { log } from './logger'

function getParamsFilePath(): string {
  ensureDataDir()
  return path.join(getDataDir(), 'params.json')
}

type ParamsStore = Record<string, DrawThingsModelParams>

const WRITE_DEBOUNCE_MS = 200

let store: ParamsStore | null = null
let writeTimer: NodeJS.Timeout | null = null

function ensureLoaded(): ParamsStore {
  if (store !== null) return store
  const file = getParamsFilePath()
  if (!fs.existsSync(file)) {
    store = {}
    return store
  }
  try {
    store = JSON.parse(fs.readFileSync(file, 'utf-8')) as ParamsStore
  } catch (err) {
    // Surface the parse failure so a subsequent debounced write that
    // overwrites the file with an empty store doesn't happen silently.
    log('warn', 'params.json: failed to read or parse; starting with empty store', {
      path: file,
      message: (err as Error).message,
    })
    store = {}
  }
  return store
}

function writeNow(): void {
  if (store === null) return
  const file = getParamsFilePath()
  fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf-8')
}

function scheduleWrite(): void {
  if (writeTimer !== null) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    writeNow()
  }, WRITE_DEBOUNCE_MS)
}

export function getModelParams(modelFile: string): DrawThingsModelParams | null {
  return ensureLoaded()[modelFile] ?? null
}

export function getAllModelParams(): ParamsStore {
  return structuredClone(ensureLoaded())
}

export function setModelParams(modelFile: string, params: DrawThingsModelParams): void {
  const s = ensureLoaded()
  s[modelFile] = params
  scheduleWrite()
}

export type DrawThingsDimensionPatch = Pick<DrawThingsModelParams, 'width' | 'height' | 'steps' | 'guidance'>

export function applyDimensionsToModels(modelFiles: string[], patch: DrawThingsDimensionPatch): void {
  if (modelFiles.length === 0) return
  const s = ensureLoaded()
  for (const modelFile of modelFiles) {
    const existing = s[modelFile]
    s[modelFile] = existing
      ? { ...existing, ...patch }
      : { ...patch, seed: '', negativePrompt: '' }
  }
  log('info', 'Applied dimensions to all Draw Things models', {
    modelCount: modelFiles.length,
    patch,
  })
  scheduleWrite()
}

// Cancel any pending debounced write and flush synchronously. Called from
// before-quit so an edit made just before Cmd+Q can't be lost in the timer gap.
export function drainPendingWrites(): void {
  const hadPending = writeTimer !== null
  if (writeTimer !== null) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  writeNow()
  if (hadPending) {
    log('info', 'Drained pending model param writes on quit')
  }
}
