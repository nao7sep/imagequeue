import fs from 'fs'
import path from 'path'
import os from 'os'
import { AppConfig } from './types'
import { createDefaultConfig } from './defaults'
import { log } from '../logger'
import { shouldDeleteToTrash } from '../../shared/config'

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

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig

  ensureDataDir()

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = createDefaultConfig()
    saveConfig(defaults)
    return defaults
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  const loaded = JSON.parse(raw) as Partial<AppConfig>
  const defaults = createDefaultConfig()

  // Deep merge with defaults to handle missing/renamed fields from older configs
  const loadedBackends = (loaded.image_backends || {}) as Record<string, Record<string, unknown>>
  const defaultBackends = defaults.image_backends as unknown as Record<string, Record<string, unknown>>

  const mergedBackends: Record<string, unknown> = {}
  for (const key of Object.keys(defaultBackends)) {
    const defB = defaultBackends[key]
    const loadB = loadedBackends[key] || {}
    const defParams = (defB.default_params || {}) as Record<string, unknown>
    const loadParams = (loadB.default_params || {}) as Record<string, unknown>
    mergedBackends[key] = {
      ...defB,
      ...loadB,
      default_params: { ...defParams, ...loadParams }
    }
  }

  const loadedBrainstorm = (loaded.brainstorm ?? {}) as Partial<AppConfig['brainstorm']>
  const loadedBrainstormTemplates = (loadedBrainstorm.templates ?? {}) as Partial<AppConfig['brainstorm']['templates']>
  cachedConfig = {
    ...defaults,
    ...loaded,
    text_ai: { ...defaults.text_ai, ...(loaded.text_ai || {}) },
    general: {
      ...defaults.general,
      ...(loaded.general || {}),
      delete_to_trash: shouldDeleteToTrash((loaded.general as { delete_to_trash?: unknown } | undefined)?.delete_to_trash),
    },
    notifications: { ...defaults.notifications, ...(loaded.notifications || {}) },
    image_backends: mergedBackends as unknown as AppConfig['image_backends'],
    prompts: { ...defaults.prompts, ...(loaded.prompts || {}) },
    brainstorm: {
      ...defaults.brainstorm,
      ...loadedBrainstorm,
      templates: {
        ...defaults.brainstorm.templates,
        ...loadedBrainstormTemplates,
      },
    },
  }
  return cachedConfig
}

export function saveConfig(config: AppConfig): void {
  ensureDataDir()
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  cachedConfig = config
  log('info', 'Config saved', { path: CONFIG_PATH })
}
