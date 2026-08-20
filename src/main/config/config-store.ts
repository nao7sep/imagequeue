import fs from 'fs'
import path from 'path'
import { AppConfig } from './types'
import { createDefaultConfig } from './defaults'
import { log, serializeError } from '../logger'
import { writeJsonAtomic } from '../utils/atomic-write'
import { resolveStorageRoot } from './storage-root'

let cachedConfig: AppConfig | null = null

// The storage root is resolved lazily (honoring IMAGEQUEUE_HOME) rather than
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
  // checkpoint that fails loudly on an unusable IMAGEQUEUE_HOME.
  resolveStorageRoot()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Fills missing keys in `loaded` from `defaults`, recursively for plain
// objects. Existing keys in `loaded` are preserved as-is, including explicit
// false/0/""/null and arrays — only structurally absent keys are filled.
export function deepMergeDefaults<T>(loaded: unknown, defaults: T): T {
  if (!isPlainObject(loaded) || !isPlainObject(defaults)) {
    return (loaded === undefined ? defaults : (loaded as T))
  }
  const result: Record<string, unknown> = { ...loaded }
  for (const key of Object.keys(defaults)) {
    const defaultValue = (defaults as Record<string, unknown>)[key]
    if (!(key in loaded)) {
      result[key] = defaultValue
    } else if (isPlainObject(loaded[key]) && isPlainObject(defaultValue)) {
      result[key] = deepMergeDefaults(loaded[key], defaultValue)
    }
    // else: keep loaded[key] verbatim
  }
  return result as T
}

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig

  ensureDataDir()

  const configPath = getConfigPath()
  if (!fs.existsSync(configPath)) {
    const defaults = createDefaultConfig()
    saveConfig(defaults)
    return defaults
  }

  const raw = fs.readFileSync(configPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    // A corrupt config.json is an unexpected failure at a file boundary, not a
    // normal branch, so it is logged with full fidelity and propagated. We do
    // NOT fall back to defaults: that would silently discard the user's
    // settings, and the next saveConfig would overwrite the still-recoverable
    // file. The caller — app startup, or an IPC handler via the boundary
    // wrapper — surfaces the clear error.
    log('error', 'Failed to parse config file', { path: configPath, error: serializeError(err) })
    throw new Error(`Config file is not valid JSON: ${configPath}`, { cause: err })
  }
  // Fill any missing keys from the defaults in memory only. An existing config is never rewritten to
  // sync the schema (write-if-missing, storage-path conventions): a good or hand-edited file is never
  // exposed to an overwrite bug, and it picks up newly added keys on the next real save — the in-code
  // default for any absent key already drives behavior in the meantime.
  const merged = deepMergeDefaults(parsed, createDefaultConfig())
  dropLegacyConfigKeys(merged)
  cachedConfig = merged
  return merged
}

// Keys an older build wrote that have no home in the current schema. deepMergeDefaults
// preserves anything already in the loaded file, so without this they would persist
// forever as dead data. Dropped on both load and save; each entry names why it is gone.
function dropLegacyConfigKeys(config: AppConfig): void {
  // The Gemini text list, from before it was closed — the list lives in shared/models
  // now. The two tier selections are untouched: a legacy pick survives even if it names
  // a model no longer on the shipped list, and fails fast at the API call if gone.
  const gemini = config.text_ai?.gemini as unknown as Record<string, unknown> | undefined
  if (gemini && 'models' in gemini) delete gemini.models

  // The Imagen backend, removed before release: the whole Imagen 4 family shut down
  // 2026-08-17, so the backend stopped working rather than degrading. Its config block
  // can no longer be reached by any UI, and its stored API key (gemini.imagen) is
  // deliberately NOT touched here — a credential is the user's to delete.
  const backends = config.image_backends as unknown as Record<string, unknown> | undefined
  if (backends && 'imagen' in backends) delete backends.imagen

  // The notification volume, from before it moved to state.json — how loud this
  // machine plays a sound is a presentation adjustment, not an authored setting
  // (persisted-store-separation conventions). Dropped rather than migrated: the
  // app is pre-release, so it takes the default once instead of carrying
  // migration scaffolding forever.
  const notifications = config.notifications as unknown as Record<string, unknown> | undefined
  if (notifications && 'volume' in notifications) delete notifications.volume

  // api_key fields, from before keys moved out of the config type entirely (they
  // live only in api-keys.json). This is housekeeping, NOT a guard: no current
  // code path can put a key into the config object, so the only api_key that can
  // exist here is one already sitting in an older file on disk. Removing it also
  // clears any non-empty key an old build may have left behind.
  for (const section of [config.text_ai, config.image_backends] as unknown as Array<
    Record<string, Record<string, unknown>> | undefined
  >) {
    for (const entry of Object.values(section ?? {})) {
      if (entry && typeof entry === 'object' && 'api_key' in entry) delete entry.api_key
    }
  }
}

export function saveConfig(config: AppConfig): void {
  ensureDataDir()
  dropLegacyConfigKeys(config)
  const configPath = getConfigPath()
  // recorded: config.json is the durable user-settings store — the canonical
  // managed durable text this net exists to protect (data-backup conventions).
  writeJsonAtomic(configPath, config, true)
  cachedConfig = config
  log('info', 'Config saved', { path: configPath })
}
