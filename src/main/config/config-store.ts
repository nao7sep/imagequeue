import fs from 'fs'
import path from 'path'
import os from 'os'
import { AppConfig } from './types'
import { createDefaultConfig } from './defaults'
import { log } from '../logger'
import { writeJsonAtomic } from '../utils/atomic-write'

const DATA_DIR = path.join(os.homedir(), '.imagequeue')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')

let cachedConfig: AppConfig | null = null

export function getDataDir(): string {
  return DATA_DIR
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
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

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = createDefaultConfig()
    saveConfig(defaults)
    return defaults
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  const parsed = JSON.parse(raw) as unknown
  const merged = deepMergeDefaults(parsed, createDefaultConfig())
  // If the merge filled in any new keys (e.g., a setting added since this
  // file was last written), persist the canonical form so the on-disk file
  // stays in sync with the schema.
  if (JSON.stringify(parsed) !== JSON.stringify(merged)) {
    saveConfig(merged)
  } else {
    cachedConfig = merged
  }
  return merged
}

export function saveConfig(config: AppConfig): void {
  ensureDataDir()
  writeJsonAtomic(CONFIG_PATH, config)
  cachedConfig = config
  log('info', 'Config saved', { path: CONFIG_PATH })
}
