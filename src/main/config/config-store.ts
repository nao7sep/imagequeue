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
import { checkFormat, FORMAT_VERSIONS, markFormat, NewerFormatError } from '../store-format'

let cachedConfig: AppConfig | null = null
// The map of sets config.json holds as of the last load or write; null while
// there is no file, including after a set-aside. Save compares against it and never
// re-reads the file, so config.json is read only at load.
let storedMap: Record<string, unknown> | null = null

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

/**
 * config.json exists but can be neither read nor set aside. Startup halts and
 * names the file, which is left exactly where it is (store-recovery conventions).
 */
export class ConfigFileHaltError extends Error {
  constructor(readonly path: string, options: { cause: unknown }) {
    super(`The settings file could not be used and was left in place: ${path}`, options)
    this.name = 'ConfigFileHaltError'
  }
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

// A file that does not parse or is not a map of sets is set aside
// (store-recovery conventions); a failed rename halts.
function setAsideUnusableFile(file: string, error: unknown): void {
  const movedTo = path.join(path.dirname(file), `${path.basename(file, '.json')}-${utcStampForFilename()}.invalid`)
  try {
    fs.renameSync(file, movedTo)
  } catch (renameError) {
    throw new ConfigFileHaltError(file, { cause: renameError })
  }
  setAsidePaths.push(movedTo)
  log('warn', 'Set aside an unusable config file; using built-in settings', {
    from: file,
    to: movedTo,
    error: serializeError(error),
  })
}

// A file that exists but cannot be read halts: moving it would not fix a
// permission problem, and a passing I/O error would move a good file.
function readStoredMap(): Record<string, unknown> | null {
  const file = getConfigPath()
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (isMissingFile(err)) return null
    throw new ConfigFileHaltError(file, { cause: err })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    setAsideUnusableFile(file, err)
    return null
  }
  if (!isObject(parsed)) {
    setAsideUnusableFile(file, new Error('Config file must be a JSON object'))
    return null
  }
  try {
    return checkFormat(parsed, FORMAT_VERSIONS.config, file)
  } catch (err) {
    // A newer file halts startup and stays exactly where it is.
    if (err instanceof NewerFormatError) throw err
    setAsideUnusableFile(file, err)
    return null
  }
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

  storedMap = readStoredMap()
  cachedConfig = effectiveConfig(storedMap ?? {})
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
 * map last loaded or written writes nothing, and so does an empty result while
 * there is no file.
 */
export function saveConfig(config: AppConfig): void {
  const next: Record<string, unknown> = {}
  for (const [key, builtIn] of Object.entries(configSetDefaults())) {
    const value = readConfigSet(config, key)
    if (!hasSetShape(value, builtIn, key)) throw new Error(`Cannot save invalid config set: ${key}`)
    const cleaned = cleanConfigSet(key, value)
    if (!equalsBuiltIn(key, cleaned, builtIn, config)) writePath(next, key, cleaned)
  }
  const unchanged = storedMap === null ? Object.keys(next).length === 0 : valuesEqual(next, storedMap)
  if (!unchanged) {
    const file = getConfigPath()
    writeJsonAtomic(file, markFormat(next, FORMAT_VERSIONS.config), true)
    storedMap = next
    log('info', 'Config saved', { path: file })
  }
  cachedConfig = effectiveConfig(next)
}
