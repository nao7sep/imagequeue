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
import { checkFormat, FORMAT_VERSIONS, NewerFormatError, StoreLeftInPlaceError } from './store-format'
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

function isParamsSet(value: unknown): value is DrawThingsModelParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const set = value as Record<string, unknown>
  return (['width', 'height', 'steps', 'guidance'] as const).every((key) => typeof set[key] === 'number' && Number.isFinite(set[key]))
    && typeof set.seed === 'string'
    && typeof set.negativePrompt === 'string'
}

// Each model's set is checked as it is read; one that fails reads as absent, so
// the model takes its recommended or default set whole, and the next save drops
// it (config-sets conventions, Reading and healing).
function validSets(stored: Record<string, unknown>): ParamsStore {
  const sets: ParamsStore = Object.create(null)
  for (const [modelFile, value] of Object.entries(stored)) {
    if (isParamsSet(value)) sets[modelFile] = value
    else log('warn', 'Invalid Draw Things parameter set; using recommended or default parameters', { modelFile })
  }
  return sets
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
    const envelope = checkFormat(parsed as Record<string, unknown>, FORMAT_VERSIONS.modelParams, file)
    if (!Object.hasOwn(envelope, 'models') || !envelope.models || typeof envelope.models !== 'object' || Array.isArray(envelope.models)) {
      throw new Error('params.json must contain a model parameter map')
    }
    return validSets(envelope.models as Record<string, unknown>)
  } catch (err) {
    // A newer file refuses every request, reads included, and stays exactly
    // where it is; store stays null, so nothing is ever written over it.
    if (err instanceof NewerFormatError) throw err
    setAside(file, err)
    return Object.create(null)
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
  store = fs.existsSync(file) ? readStoredParams(file) : Object.create(null) as ParamsStore
  return store
}

function writeNow(): void {
  if (store === null) return
  const file = getParamsFilePath()
  if (fs.existsSync(file)) {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new StoreLeftInPlaceError(file, { cause: new Error('Invalid model parameter store') })
    }
    checkFormat(raw as Record<string, unknown>, FORMAT_VERSIONS.modelParams, file)
  }
  // recorded: params.json is durable, user-authored managed text — the
  // per-model Draw Things generation parameters the user tunes and reloads as
  // state (data-backup conventions). Dedup absorbs the debounced autosave churn.
  writeJsonAtomic(file, { formatVersion: FORMAT_VERSIONS.modelParams, models: store }, true)
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
  const s = ensureLoaded()
  return Object.hasOwn(s, modelFile) ? s[modelFile] : null
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
    const existing = Object.hasOwn(s, modelFile) ? s[modelFile] : undefined
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
