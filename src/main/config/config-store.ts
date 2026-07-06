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
  cachedConfig = merged
  return merged
}

// API keys live in the separate 0600 api-keys.json (config/api-keys-store.ts),
// never in config.json. This blanks any api_key field — including a stale one
// read from an older config.json — so the persisted settings file is always
// key-free. Mutates in place; callers pass a config they own (a fresh default,
// or the cache which is then re-cached key-free).
function scrubApiKeys(config: AppConfig): void {
  if (config.text_ai?.gemini) config.text_ai.gemini.api_key = ''
  if (config.text_ai?.openai) config.text_ai.openai.api_key = ''
  const backends = config.image_backends as unknown as Record<string, { api_key?: string }>
  for (const backend of Object.values(backends ?? {})) {
    if (backend && typeof backend === 'object' && 'api_key' in backend) backend.api_key = ''
  }
}

export function saveConfig(config: AppConfig): void {
  ensureDataDir()
  scrubApiKeys(config)
  const configPath = getConfigPath()
  // recorded: config.json is the durable user-settings store — the canonical
  // managed durable text this net exists to protect (data-backup conventions).
  writeJsonAtomic(configPath, config, true)
  cachedConfig = config
  log('info', 'Config saved', { path: configPath })
}
