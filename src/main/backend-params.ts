import fs from 'fs'
import path from 'path'
import { dropRetiredConfigKeys, getDataDir, takeStoredImageBackendDefaults } from './config'
import { createCoalescedWriter } from './utils/coalesced-writer'
import { writeFileAtomicAsync } from './utils/atomic-write'
import { setAsideFile } from './utils/set-aside'
import { checkFormat, FORMAT_VERSIONS, NewerFormatError, StoreLeftInPlaceError } from './store-format'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER, type CloudBackendId } from '../shared/types'
import { getDefaultModelForBackend } from '../shared/ai-models'
import { IMAGE_DEFAULT_PARAMS, type SavedImageBackendParams } from '../shared/image-backend-defaults'
import { log, serializeError } from './logger'

// backend-params.json holds the model and parameters each cloud image column
// saves on its own as the user works, beside params.json, which holds Draw
// Things' per-model sets; config.json holds only what Settings edits
// (data-lifecycle-conventions, Storage boundaries).
function getBackendParamsPath(): string {
  return path.join(getDataDir(), 'backend-params.json')
}

let store: Partial<Record<CloudBackendId, SavedImageBackendParams>> | null = null
// What the file held beside the entries this build accepted: each entry that
// failed its check, and every other key of the envelope. A save writes them back
// as they are; an entry is dropped from here once its column saves.
let rejected: Record<string, unknown> = Object.create(null)
let otherKeys: Record<string, unknown> = Object.create(null)
const setAsidePaths: string[] = []

export function drainSetAsideBackendParamsPaths(): string[] {
  return setAsidePaths.splice(0)
}

// Which parameters a model takes, and their values, are the column's to judge
// per row, so an entry saved for a model or a field that has since changed
// still loads.
function isEntry(value: unknown): value is SavedImageBackendParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const { model, params } = value as Record<string, unknown>
  if (typeof model !== 'string' || !params || typeof params !== 'object' || Array.isArray(params)) return false
  return Object.values(params).every((item) =>
    item === null || typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)))
}

// Each column's entry is checked as it is read; one that fails reads as absent,
// so that column starts from its built-in model and parameters, and the entry
// stays in the file (config-sets conventions, Loading and fallback).
function acceptEntries(entries: Record<string, unknown>): Partial<Record<CloudBackendId, SavedImageBackendParams>> {
  const accepted: Partial<Record<CloudBackendId, SavedImageBackendParams>> = {}
  const known = new Set<string>(CLOUD_BACKEND_IDS_IN_UI_ORDER)
  for (const [backend, value] of Object.entries(entries)) {
    if (known.has(backend) && isEntry(value)) accepted[backend as CloudBackendId] = value
    else {
      rejected[backend] = value
      if (known.has(backend)) log('warn', 'Invalid image column parameters; using built-in', { backend })
    }
  }
  return accepted
}

// An authored file that does not parse or fit its shape is set aside and every
// column starts from its built-in, as on first run; one that cannot be read or
// set aside, or a newer one, stops launch and stays where it is
// (store-recovery conventions).
function readStored(file: string): Partial<Record<CloudBackendId, SavedImageBackendParams>> {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf-8')
  } catch (error) {
    throw new StoreLeftInPlaceError(file, { cause: error })
  }
  let backends: unknown
  let others: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('backend-params.json must be a JSON object')
    ;({ backends, ...others } = checkFormat(parsed as Record<string, unknown>, FORMAT_VERSIONS.backendParams, file))
    if (!backends || typeof backends !== 'object' || Array.isArray(backends)) throw new Error('backend-params.json must contain a backend map')
  } catch (error) {
    if (error instanceof NewerFormatError) throw error
    let movedTo: string
    try {
      movedTo = setAsideFile(file)
    } catch (renameError) {
      throw new StoreLeftInPlaceError(file, { cause: renameError })
    }
    setAsidePaths.push(movedTo)
    log('warn', 'Set aside an unusable backend-params.json; using built-in models and parameters', { from: file, to: movedTo, error: serializeError(error) })
    return {}
  }
  otherKeys = others
  return acceptEntries(backends as Record<string, unknown>)
}

/**
 * Loads backend-params.json once, at launch. The columns' choices lived in
 * config.json until they moved here: while there is no file, what config.json
 * still holds becomes the file's first contents, and config.json drops it on
 * its next save. The new file is written before that, so nothing the user set
 * is lost if either write fails.
 */
export async function loadBackendParams(): Promise<void> {
  if (store !== null) return
  const file = getBackendParamsPath()
  if (fs.existsSync(file)) {
    store = readStored(file)
    return
  }
  const moved = takeStoredImageBackendDefaults()
  store = acceptEntries(moved)
  if (Object.keys(moved).length === 0) return
  await writeNow()
  log('info', 'Moved image column parameters from config.json to backend-params.json', { backends: Object.keys(moved) })
  // The moved values are safe in their new file; config.json leaving them
  // behind until a later save loses nothing.
  await dropRetiredConfigKeys().catch((error: unknown) =>
    log('warn', 'config.json still holds the moved image column parameters', { error: serializeError(error) }))
}

/** Every cloud column's saved model and parameters, or its built-in ones. */
export function getImageBackendDefaults(): Record<CloudBackendId, SavedImageBackendParams> {
  if (store === null) throw new Error('backend-params.json is not loaded')
  const saved = store
  return Object.fromEntries(CLOUD_BACKEND_IDS_IN_UI_ORDER.map((backend) => [
    backend,
    structuredClone(saved[backend] ?? { model: getDefaultModelForBackend(backend)?.id ?? '', params: { ...IMAGE_DEFAULT_PARAMS[backend] } }),
  ])) as Record<CloudBackendId, SavedImageBackendParams>
}

async function writeNow(): Promise<void> {
  const backends = { ...rejected, ...store }
  // recorded: backend-params.json is durable, user-authored managed text, the
  // columns' model and parameter choices the user tunes and reloads as state
  // (data-backup conventions). Dedup absorbs the debounced autosave churn.
  await writeFileAtomicAsync(getBackendParamsPath(), JSON.stringify({ formatVersion: FORMAT_VERSIONS.backendParams, ...otherKeys, backends }, null, 2), true)
}

let waiters: { resolve: () => void; reject: (error: unknown) => void }[] = []
const writer = createCoalescedWriter({
  debounceMs: 800,
  async flush() {
    const completing = waiters
    waiters = []
    try {
      await writeNow()
      for (const waiter of completing) waiter.resolve()
    } catch (error) {
      for (const waiter of completing) waiter.reject(error)
      throw error
    }
  },
  onError: (error) => log('error', 'backend-params.json: write failed', { error: serializeError(error) }),
})

/** Captured at once: these edits belong to main even after a window closes. */
export function saveImageBackendDefaults(backend: CloudBackendId, model: string, params: Record<string, unknown>): Promise<void> {
  if (store === null) return Promise.reject(new Error('backend-params.json is not loaded'))
  const entry = { model, params: structuredClone(params) }
  if (!isEntry(entry)) return Promise.reject(new Error(`Cannot save invalid image column parameters for ${backend}`))
  store[backend] = entry
  delete rejected[backend]
  const saved = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }))
  writer.schedule()
  return saved
}
export function drainBackendDefaults(): Promise<void> { return writer.drain() }
