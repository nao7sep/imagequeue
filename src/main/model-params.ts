import fs from 'fs'
import path from 'path'
import type { DrawThingsModelParams } from '../shared/types'
import { ensureDataDir, getDataDir } from './config'
import { log, serializeError } from './logger'
import { writeJsonAtomic } from './utils/atomic-write'
import { createCoalescedWriter } from './utils/coalesced-writer'

function getParamsFilePath(): string {
  ensureDataDir()
  return path.join(getDataDir(), 'params.json')
}

type ParamsStore = Record<string, DrawThingsModelParams>

const WRITE_DEBOUNCE_MS = 200

let store: ParamsStore | null = null
// When params.json exists but cannot be parsed, we refuse to write rather than
// overwrite the corrupted-but-possibly-recoverable file with an empty store.
// Reads degrade to empty (UI shows missing values) and writes throw with an
// actionable message naming the file. The bad file is left untouched so the
// user can inspect or repair it manually.
let loadFailed = false
let loadFailedMessage = ''

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
    const message = (err as Error).message
    loadFailed = true
    loadFailedMessage =
      `Cannot save Draw Things model parameters: ${file} is unreadable. ` +
      `Move or repair the file and restart ImageQueue. (parse error: ${message})`
    log('error', 'params.json: failed to parse; halting writes until resolved', {
      path: file,
      error: serializeError(err),
    })
    store = {}
  }
  return store
}

function writeNow(): void {
  if (store === null) return
  // Defensive: public setters already throw when loadFailed, so this branch
  // should be unreachable. Kept so drainPendingWrites on quit can't slip
  // through and clobber a corrupted file.
  if (loadFailed) return
  // recorded: params.json is durable, user-authored managed text — the
  // per-model Draw Things generation parameters the user tunes and reloads as
  // state (data-backup conventions). Dedup absorbs the debounced autosave churn.
  writeJsonAtomic(getParamsFilePath(), store, true)
}

const writer = createCoalescedWriter({
  flush: writeNow,
  debounceMs: WRITE_DEBOUNCE_MS,
  onError: (error) =>
    log('error', 'params.json: write failed', {
      error: serializeError(error),
    }),
  onDrain: () => log('info', 'Drained pending model param writes on quit'),
})

export function getModelParams(modelFile: string): DrawThingsModelParams | null {
  return ensureLoaded()[modelFile] ?? null
}

export function getAllModelParams(): ParamsStore {
  return structuredClone(ensureLoaded())
}

export function setModelParams(modelFile: string, params: DrawThingsModelParams): void {
  ensureLoaded()
  if (loadFailed) throw new Error(loadFailedMessage)
  const s = store as ParamsStore
  s[modelFile] = params
  writer.schedule()
}

export type DrawThingsDimensionPatch = Pick<DrawThingsModelParams, 'width' | 'height' | 'steps' | 'guidance'>

export function applyDimensionsToModels(modelFiles: string[], patch: DrawThingsDimensionPatch): void {
  if (modelFiles.length === 0) return
  ensureLoaded()
  if (loadFailed) throw new Error(loadFailedMessage)
  const s = store as ParamsStore
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
  writer.schedule()
}

// Cancel any pending debounced write and flush synchronously. Called from
// before-quit so an edit made just before Cmd+Q can't be lost in the timer gap.
export function drainPendingWrites(): void {
  writer.drain()
}
