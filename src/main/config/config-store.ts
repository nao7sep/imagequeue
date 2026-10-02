import fs from 'fs'
import path from 'path'
import { AppConfig } from './types'
import { createDefaultConfig } from './defaults'
import { log, serializeError } from '../logger'
import { writeJsonAtomic } from '../utils/atomic-write'
import { resolveStorageRoot } from './storage-root'
import { utcStampForFilename } from '../../shared/utc-stamp'
import { configSetDefaults, readPath, writePath, readConfigSet, applyConfigSet, hasSetShape, isObject, cleanConfigSet, equalsBuiltIn } from './config-sets'
import { valuesEqual } from '../settings-changes'

let cachedConfig: AppConfig | null = null

// The storage root is resolved lazily (honoring IMAGEQUEUE_DATA_DIR) rather than
// frozen into a module-level constant at import time, so the override is read
// once the environment is fully known. resolveStorageRoot mkdir -p's the root.
export function getDataDir(): string {
  return resolveStorageRoot()
}

export function getConfigPath(): string {
  return path.join(getDataDir(), 'config.json')
}

export function ensureDataDir(): void {
  // resolveStorageRoot already creates the root (and throws on an unusable
  // override); calling it here keeps ensureDataDir an idempotent startup
  // checkpoint that fails loudly on an unusable IMAGEQUEUE_DATA_DIR.
  resolveStorageRoot()
}

// Where each set-aside file went, until the window takes them to tell the user.
const setAsidePaths: string[] = []

export function drainSetAsideConfigPaths(): string[] {
  return setAsidePaths.splice(0)
}

// An unreadable file is set aside (store-recovery conventions); a failed rename
// propagates.
function setAsideUnreadableFile(file: string, error: unknown): void {
  const movedTo = path.join(path.dirname(file), `${path.basename(file, '.json')}-${utcStampForFilename()}.invalid`)
  fs.renameSync(file, movedTo)
  setAsidePaths.push(movedTo)
  log('warn', 'Set aside an unreadable config file; using built-in settings', {
    from: file,
    to: movedTo,
    error: serializeError(error),
  })
}

function readStoredMap(): Record<string, unknown> {
  const file = getConfigPath()
  if (!fs.existsSync(file)) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!isObject(parsed)) throw new Error('Config file must be a JSON object')
  } catch (err) {
    setAsideUnreadableFile(file, err)
    return {}
  }
  return parsed
}

// Each set is checked as it is read (config-sets conventions, Reading and healing).
function effectiveConfig(stored: Record<string, unknown>): AppConfig {
  const config = createDefaultConfig()
  for (const [key, builtIn] of Object.entries(configSetDefaults())) {
    const value = readPath(stored, key)
    if (value === undefined) continue
    if (!hasSetShape(value, builtIn, key)) {
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
 * The one owner of what config.json holds. The file is written from the config
 * in memory: every known set is stored, cleaned, only while it differs from its
 * built-in. A set of the wrong shape rejects the save. A result equal to the
 * file writes nothing.
 */
export function saveConfig(config: AppConfig): void {
  const next: Record<string, unknown> = {}
  for (const [key, builtIn] of Object.entries(configSetDefaults())) {
    const value = readConfigSet(config, key)
    if (!hasSetShape(value, builtIn, key)) throw new Error(`Cannot save invalid config set: ${key}`)
    const cleaned = cleanConfigSet(key, value)
    if (!equalsBuiltIn(key, cleaned, builtIn, config)) writePath(next, key, cleaned)
  }
  if (!valuesEqual(next, readStoredMap())) {
    const file = getConfigPath()
    writeJsonAtomic(file, next, true)
    log('info', 'Config saved', { path: file })
  }
  cachedConfig = effectiveConfig(next)
}
