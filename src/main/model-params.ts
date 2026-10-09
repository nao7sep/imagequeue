import fs from 'fs'
import path from 'path'
import type { DrawThingsModelParams } from '../shared/types'
import { ensureDataDir, getDataDir } from './config'
import { log, serializeError } from './logger'
import { writeFileAtomicAsync } from './utils/atomic-write'
import { createCoalescedWriter } from './utils/coalesced-writer'
import {
  markModelParamsPersistenceFailed,
  markModelParamsPersistenceSaved,
} from './model-params-persistence'
import { checkFormat, FORMAT_VERSIONS, NewerFormatError, StoreLeftInPlaceError } from './store-format'
import { setAsideFile } from './utils/set-aside'

function getParamsFilePath(): string {
  ensureDataDir()
  return path.join(getDataDir(), 'params.json')
}

type ParamsStore = Record<string, DrawThingsModelParams>

const WRITE_DEBOUNCE_MS = 200

let store: ParamsStore | null = null
// What the file held beside the sets this build accepted: each set that failed
// its check, and every other key of the envelope. A save writes them back as
// they are; a set is dropped from here once the user changes that model.
let rejectedSets: Record<string, unknown> = Object.create(null)
let otherKeys: Record<string, unknown> = Object.create(null)
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
// the model takes its recommended or default set whole, and the set stays in
// the file (config-sets conventions, Loading and fallback).
function validSets(stored: Record<string, unknown>): ParamsStore {
  const sets: ParamsStore = Object.create(null)
  for (const [modelFile, value] of Object.entries(stored)) {
    if (isParamsSet(value)) sets[modelFile] = value
    else {
      rejectedSets[modelFile] = value
      log('warn', 'Invalid Draw Things parameter set; using recommended or default parameters', { modelFile })
    }
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
    const { models, ...others } = checkFormat(parsed as Record<string, unknown>, FORMAT_VERSIONS.modelParams, file)
    if (!models || typeof models !== 'object' || Array.isArray(models)) {
      throw new Error('params.json must contain a model parameter map')
    }
    const sets = validSets(models as Record<string, unknown>)
    otherKeys = others
    return sets
  } catch (err) {
    // A newer file refuses every request, reads included, and stays exactly
    // where it is; store stays null, so nothing is ever written over it.
    if (err instanceof NewerFormatError) throw err
    setAside(file, err)
    return Object.create(null)
  }
}

function setAside(file: string, error: unknown): void {
  let movedTo: string
  try {
    movedTo = setAsideFile(file)
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

// The file was checked when it was loaded, and the single-instance lock keeps
// every other writer out, so a write does not read it again.
async function writeNow(): Promise<void> {
  if (store === null) return
  // Loading established the directory. Do not re-enter synchronous mkdir on quit.
  const file = path.join(getDataDir(), 'params.json')
  // recorded: params.json is durable, user-authored managed text — the
  // per-model Draw Things generation parameters the user tunes and reloads as
  // state (data-backup conventions). Dedup absorbs the debounced autosave churn.
  await writeFileAtomicAsync(file, JSON.stringify({ formatVersion: FORMAT_VERSIONS.modelParams, ...otherKeys, models: { ...rejectedSets, ...store } }, null, 2), true)
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
  delete rejectedSets[modelFile]
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
    delete rejectedSets[modelFile]
  }
  log('info', 'Applied dimensions to all Draw Things models', {
    modelCount: modelFiles.length,
    patch,
  })
  writer.schedule()
}

// Flush pending or failed writes through the same asynchronous owner. Called from
// before-quit so an edit made just before Cmd+Q can't be lost in the timer gap.
export function drainPendingWrites(): Promise<void> {
  return writer.drain()
}
