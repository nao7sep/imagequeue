import fs from 'fs'
import path from 'path'
import os from 'os'
import { AppConfig } from './types'
import { createDefaultConfig } from './defaults'

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
  cachedConfig = JSON.parse(raw) as AppConfig
  return cachedConfig
}

export function saveConfig(config: AppConfig): void {
  ensureDataDir()
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  cachedConfig = config
}
