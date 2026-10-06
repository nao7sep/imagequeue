import fs from 'fs'
import path from 'path'
import type { DrawThingsModelParams } from '../shared/types'
import { ensureDataDir, getDataDir } from './config'
import { log, serializeError } from './logger'
import { writeJsonAtomic } from './utils/atomic-write'
import { createCoalescedWriter } from './utils/coalesced-writer'
import {
  markModelParamsPersistenceFailed,
  markModelParamsPersistenceSaved,
} from './model-params-persistence'
import { checkFormat, FORMAT_VERSIONS, markFormat, NewerFormatError, StoreLeftInPlaceError } from './store-format'
import { utcStampForFilename } from '../shared/utc-stamp'

function getParamsFilePath(): string {
  ensureDataDir()
  return path.join(getDataDir(), 'params.json')
}

type ParamsStore = Record<string, DrawThingsModelParams>

const WRITE_DEBOUNCE_MS = 200

let store: ParamsStore | null = null
// params.json is authored settings, so a file that does not parse or fit its
// shape is set aside and the store starts empty, as on first run; a file that
// cannot be read or set aside stops the request and stays where it is
// (store-recovery conventions). Each set-aside path waits here for the window
// that made the request to name it.
const setAsidePaths: string[] = []

export function drainSetAsideModelParamsPaths(): string[] {
  return setAsidePaths.splice(0)
}

function readStoredParams(file: string): ParamsStore {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf-8')
  } catch (err) {
    throw new StoreLeftInPlaceError(file, { cause: err })
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('params.json must be a JSON object')
    return checkFormat(parsed as Record<string, unknown>, FORMAT_VERSIONS.modelParams, file) as ParamsStore
  } catch (err) {
    // A newer file refuses every request, reads included, and stays exactly
    // where it is; store stays null, so nothing is ever written over it.
    if (err instanceof NewerFormatError) throw err
    setAside(file, err)
    return {}
  }
}

function setAside(file: string, error: unknown): void {
  const movedTo = path.join(path.dirname(file), `${path.basename(file, '.json')}-${utcStampForFilename()}.invalid`)
  try {
    fs.renameSync(file, movedTo)
  } catch (renameError) {
    throw new StoreLeftInPlaceError(file, { cause: renameError })
  }
  setAsidePaths.push(movedTo)
  log('warn', 'Set aside an unusable params.json; using recommended or default parameters', {
    from: file,
    to: movedTo,
    error: serializeError(error),
  })
}

function ensureLoaded(): ParamsStore {
  if (store !== null) return store
  const file = getParamsFilePath()
  store = fs.existsSync(file) ? readStoredParams(file) : {}
  return store
}

function writeNow(): void {
  if (store === null) return
  // recorded: params.json is durable, user-authored managed text — the
  // per-model Draw Things generation parameters the user tunes and reloads as
  // state (data-backup conventions). Dedup absorbs the debounced autosave churn.
  writeJsonAtomic(getParamsFilePath(), markFormat(store, FORMAT_VERSIONS.modelParams), true)
  markModelParamsPersistenceSaved()
}

const writer = createCoalescedWriter({
  flush: writeNow,
  debounceMs: WRITE_DEBOUNCE_MS,
  onError: (error) => {
    log('error', 'params.json: write failed', {
      error: serializeError(error),
    })
    markModelParamsPersistenceFailed()
  },
  onDrain: () => log('info', 'Drained pending model param writes on quit'),
})

export function getModelParams(modelFile: string): DrawThingsModelParams | null {
  return ensureLoaded()[modelFile] ?? null
}

export function getAllModelParams(): ParamsStore {
  return structuredClone(ensureLoaded())
}

export function setModelParams(modelFile: string, params: DrawThingsModelParams): void {
  const s = ensureLoaded()
  s[modelFile] = params
  writer.schedule()
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
  writer.schedule()
}

// Cancel any pending debounced write and flush synchronously. Called from
// before-quit so an edit made just before Cmd+Q can't be lost in the timer gap.
export function drainPendingWrites(): void {
  writer.drain()
}
