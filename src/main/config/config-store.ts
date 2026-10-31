import fs from 'fs'
import path from 'path'
import { AppConfig } from './types'
import { createDefaultConfig } from './defaults'
import { log, serializeError } from '../logger'
import { writeFileAtomicAsync } from '../utils/atomic-write'
import { resolveStorageRoot, ensureStorageRoot } from './storage-root'
import { configSetDefaults, readPath, writePath, readConfigSet, applyConfigSet, hasSetShape, isObject, cleanConfigSet, equalsBuiltIn } from './config-sets'
import { valuesEqual } from '../settings-changes'
import { FILE_FORMATS, readHeaderedJson, withHeader } from '../store-format'

let cachedConfig: AppConfig | null = null
// The map of sets the config in memory stands for, as of the last load or
// accepted change, and the map config.json holds as of the last load or write;
// each is null while there is no file to write.
// Writes compare against them and never re-read the file, so config.json is
// read only at load.
let storedMap: Record<string, unknown> | null = null
let writtenMap: Record<string, unknown> | null = null
let rejectedStoredSets = new Set<string>()

// Resolve after the environment is known, without filesystem work. Directory
// setup belongs to startup rather than cached-key reads or runtime save paths.
export function getDataDir(): string {
  return resolveStorageRoot()
}

export function getConfigPath(): string {
  return path.join(getDataDir(), 'config.json')
}

export function ensureDataDir(): void {
  ensureStorageRoot()
}

// config.json is the user's settings: a file that cannot be read, or one a
// newer version wrote, stops the launch and stays exactly as it is
// (store-recovery-conventions, What a refused file does). Until it loads,
// nothing is written to it.
function readStoredMap(): Record<string, unknown> | null {
  return readHeaderedJson(getConfigPath(), FILE_FORMATS.config)
}

// Each set is checked as it is read (config-sets conventions, Loading and
// fallback); one that fails reads as its built-in and stays in the file.
function effectiveConfig(stored: Record<string, unknown>): AppConfig {
  const config = createDefaultConfig()
  rejectedStoredSets = new Set()
  for (const [key, builtIn] of Object.entries(configSetDefaults())) {
    const value = readPath(stored, key)
    if (value === undefined) continue
    if (!hasSetShape(value, builtIn, key)) {
      rejectedStoredSets.add(key)
      log('warn', 'Invalid config set; using built-in', { key })
      continue
    }
    applyConfigSet(config, key, value)
  }
  return config
}

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig

  ensureDataDir()

  storedMap = readStoredMap()
  writtenMap = storedMap
  cachedConfig = effectiveConfig(storedMap ?? {})
  return cachedConfig
}

/**
 * The one way to change settings. The config in memory is what the processor,
 * backends and windows read, so an accepted change applies to it at once and
 * config.json is written behind it, in order. A write that fails leaves the
 * change applied and the file behind; the next write, or quit's retry, writes
 * the latest accepted map. A change of the wrong shape is refused before it
 * applies.
 */
let saving: Promise<unknown> = Promise.resolve()
export async function retryConfigSaves(): Promise<void> {
  const result = saving.catch(() => undefined).then(writeAccepted)
  saving = result
  await result
}

export function updateConfig(apply: (draft: AppConfig) => void): Promise<AppConfig> {
  try {
    const draft = structuredClone(loadConfig())
    apply(draft)
    acceptConfig(draft)
  } catch (error) {
    return Promise.reject(error)
  }
  const result = saving.catch(() => undefined).then(writeAccepted).then(() => loadConfig())
  saving = result
  return result
}

// Writes each key `stored` holds outside the known sets into `next`, unchanged.
// A container of known sets is walked into; anything else is kept whole, unless
// a known set was written at or below the same place.
function carryUnknownKeys(stored: Record<string, unknown>, next: Record<string, unknown>, known: readonly string[], prefix = ''): void {
  for (const [name, value] of Object.entries(stored)) {
    const key = prefix ? `${prefix}.${name}` : name
    // Stored member names are literal, including dots and __proto__. Only
    // declared paths have path semantics; unknown data must never traverse a
    // prototype or be reinterpreted as a different nested property.
    const pathMember = !name.includes('.')
    if (pathMember && known.includes(key)) continue
    const container = pathMember && known.some((set) => set.startsWith(`${key}.`))
    if (container && isObject(value)) {
      const child = Object.hasOwn(next, name) && isObject(next[name]) ? next[name] : {}
      carryUnknownKeys(value, child, known, key)
      if (Object.keys(child).length > 0) Object.defineProperty(next, name, { value: child, enumerable: true, configurable: true, writable: true })
    } else if (!Object.hasOwn(next, name)) {
      Object.defineProperty(next, name, { value: structuredClone(value), enumerable: true, configurable: true, writable: true })
    }
  }
}

/**
 * The one owner of what config.json holds. The file is written from the config
 * in memory: every known set is stored, cleaned, only while it differs from its
 * built-in. A stored set this build rejected, and every key it does not know,
 * is written back as it is, until a save changes that set. A changed set of the
 * wrong shape rejects the change. A map equal to the one last loaded or
 * written writes nothing, and so does an empty map while there is no file.
 */
function acceptConfig(config: AppConfig): void {
  const before = loadConfig()
  const builtIns = configSetDefaults()
  const next: Record<string, unknown> = {}
  const effective = createDefaultConfig()
  const rejected = new Set<string>()
  for (const [key, builtIn] of Object.entries(builtIns)) {
    const value = readConfigSet(config, key)
    const stored = storedMap === null ? undefined : readPath(storedMap, key)
    if (rejectedStoredSets.has(key) && valuesEqual(value, readConfigSet(before, key))) {
      writePath(next, key, stored)
      rejected.add(key)
      continue
    }
    if (!hasSetShape(value, builtIn, key)) throw Object.assign(new Error(`Cannot save invalid config set: ${key}`), { name: 'InvalidConfigSetError' })
    const cleaned = cleanConfigSet(key, value)
    if (!equalsBuiltIn(key, cleaned, builtIn, config)) {
      writePath(next, key, cleaned)
      applyConfigSet(effective, key, cleaned)
    }
  }
  if (storedMap !== null) carryUnknownKeys(storedMap, next, Object.keys(builtIns))
  if (storedMap !== null || Object.keys(next).length > 0) storedMap = next
  cachedConfig = effective
  rejectedStoredSets = rejected
  for (const listener of savedListeners) {
    try { listener() } catch (error) { log('error', 'A config listener failed', { error: serializeError(error) }) }
  }
}

async function writeAccepted(): Promise<void> {
  const map = storedMap
  if (map === null || (writtenMap !== null && valuesEqual(map, writtenMap))) return
  const file = getConfigPath()
  await writeFileAtomicAsync(file, JSON.stringify(withHeader(map, FILE_FORMATS.config), null, 2), true)
  writtenMap = map
  log('info', 'Config saved', { path: file })
}

// Native surfaces that show a setting (the status icon's Notifications item)
// follow every accepted change, whichever window or menu made it.
const savedListeners = new Set<() => void>()
export function onConfigSaved(listener: () => void): () => void {
  savedListeners.add(listener)
  return () => { savedListeners.delete(listener) }
}
