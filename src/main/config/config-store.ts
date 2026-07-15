import fs from 'fs'
import path from 'path'
import { AppConfig } from './types'
import { createDefaultConfig } from './defaults'
import { DEFAULT_GEMINI_TEXT_MODELS } from '../../shared/models'
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

// text_ai.gemini.models is a user-owned, user-edited list, so it reaches the
// store dirty from two directions: a hand-edited config.json on load, and the
// renderer's draft on save. Trim, drop empties, and de-duplicate so every reader
// gets a list it can render and select from; a non-array (or a list with nothing
// usable left) falls back to the built-ins rather than leaving the editor and
// both selects empty.
//
// It deliberately does NOT check that light_model/main_model are members of the
// list: the store never judges a selection (the validity boundary). A retired or
// unsupported id is reported by the feature that uses it — fast, at the API call
// — so this stays a dumb, version-unaware normalizer.
export function normalizeGeminiTextModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_GEMINI_TEXT_MODELS]
  const cleaned = [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  ]
  return cleaned.length > 0 ? cleaned : [...DEFAULT_GEMINI_TEXT_MODELS]
}

// Mutates in place, mirroring scrubApiKeys: callers pass a config they own (the
// merged load result, or the cache being saved). Guarded like scrubApiKeys so a
// structurally broken text_ai in a hand-edited file can't throw here.
function normalizeGeminiModels(config: AppConfig): void {
  if (!config.text_ai?.gemini) return
  config.text_ai.gemini.models = normalizeGeminiTextModels(config.text_ai.gemini.models)
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
  // deepMergeDefaults keeps a loaded array verbatim, so the user's list arrives
  // exactly as the file has it — clean it before anything reads it.
  normalizeGeminiModels(merged)
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
  normalizeGeminiModels(config)
  const configPath = getConfigPath()
  // recorded: config.json is the durable user-settings store — the canonical
  // managed durable text this net exists to protect (data-backup conventions).
  writeJsonAtomic(configPath, config, true)
  cachedConfig = config
  log('info', 'Config saved', { path: configPath })
}
