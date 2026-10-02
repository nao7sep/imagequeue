import fs from 'fs'
import path from 'path'
import { AppConfig } from './types'
import { createDefaultConfig } from './defaults'
import { log, serializeError } from '../logger'
import { writeJsonAtomic } from '../utils/atomic-write'
import { resolveStorageRoot } from './storage-root'
import { configSetDefaults, readPath, writePath, readConfigSet, applyConfigSet, hasSetShape, isObject, cleanConfigSet, equalsBuiltIn } from './config-sets'
import { valuesEqual } from '../settings-changes'

let cachedConfig: AppConfig | null = null
const warnedSets = new Set<string>()

// The storage root is resolved lazily (honoring IMAGEQUEUE_DATA_DIR) rather than
// frozen into a module-level constant at import time, so the override is read
// once the environment is fully known. resolveStorageRoot mkdir -p's the root.
export function getDataDir(): string {
  return resolveStorageRoot()
}

export function getConfigPath(): string {
  return path.join(getDataDir(), 'config.json')
}

// One log file per launch lives here, per the logging-conventions. The logger
// creates the directory; this only names it.
export function getLogsDir(): string {
  return path.join(getDataDir(), 'logs')
}

export function ensureDataDir(): void {
  // resolveStorageRoot already creates the root (and throws on an unusable
  // override); calling it here keeps ensureDataDir an idempotent startup
  // checkpoint that fails loudly on an unusable IMAGEQUEUE_DATA_DIR.
  resolveStorageRoot()
}

function readStoredMap(): Record<string, unknown> {
  const file = getConfigPath()
  if (!fs.existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!isObject(parsed)) throw new Error('Config file must be a JSON object')
    return parsed
  } catch (err) {
    log('error', 'Failed to read config file', { path: file, error: serializeError(err) })
    throw new Error(`Config file is not a valid JSON object: ${file}`, { cause: err })
  }
}

function effectiveConfig(stored: Record<string, unknown>): AppConfig {
  const config = createDefaultConfig()
  for (const [key, builtIn] of Object.entries(configSetDefaults())) {
    const value = readPath(stored, key)
    if (value === undefined) continue
    if (!hasSetShape(value, builtIn, key)) {
      if (!warnedSets.has(key)) {
        warnedSets.add(key)
        log('warn', 'Invalid config set; using built-in', { key })
      }
      continue
    }
    applyConfigSet(config, key, value)
  }
  return config
}

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig

  ensureDataDir()

  cachedConfig = effectiveConfig(readStoredMap())
  return cachedConfig
}

/**
 * The one way to change settings. The cached config is what the processor and
 * backends read, so a change is applied to a copy, the copy is written, and it
 * becomes the cached config only once the write succeeded — a failed save
 * leaves the running app on the settings that are on disk.
 */
export function updateConfig(apply: (draft: AppConfig) => void): AppConfig {
  const draft = structuredClone(loadConfig())
  apply(draft)
  saveConfig(draft)
  return loadConfig()
}

/**
 * The one owner of what config.json holds. Every known set is stored, cleaned,
 * only while it differs from its built-in; a set equal to its built-in has its
 * key removed, whether or not this save changed it. A set this save leaves
 * unchanged is taken from the file as it is now; a copy there the reader
 * rejected stays as the user left it. A changed set of the wrong shape rejects
 * the save. A result equal to the file writes nothing.
 */
export function saveConfig(config: AppConfig): void {
  const before = loadConfig()
  const current = readStoredMap()
  const next: Record<string, unknown> = {}
  for (const [key, builtIn] of Object.entries(configSetDefaults())) {
    let value = readConfigSet(config, key)
    if (valuesEqual(value, readConfigSet(before, key))) {
      value = readPath(current, key)
      if (value === undefined) continue
      if (!hasSetShape(value, builtIn, key)) {
        writePath(next, key, value)
        continue
      }
    } else if (!hasSetShape(value, builtIn, key)) {
      throw new Error(`Cannot save invalid config set: ${key}`)
    }
    const cleaned = cleanConfigSet(key, value)
    if (!equalsBuiltIn(key, cleaned, builtIn, config)) writePath(next, key, cleaned)
  }
  if (!valuesEqual(next, current)) {
    const file = getConfigPath()
    writeJsonAtomic(file, next, true)
    log('info', 'Config saved', { path: file })
  }
  cachedConfig = effectiveConfig(next)
}
