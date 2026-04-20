import { ipcMain } from 'electron'
import { loadConfig, saveConfig, encodeApiKey } from './config'
import { AppConfig } from './config/types'
import { checkModelExists } from './backends'

// IPC handlers for reading/writing settings.
export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => {
    return loadConfig()
  })

  ipcMain.handle('settings:save', (_event, config: AppConfig) => {
    // Encode API keys before persisting
    if (config.text_ai.api_key && !isEncoded(config.text_ai.api_key)) {
      config.text_ai.api_key = encodeApiKey(config.text_ai.api_key)
    }
    for (const backend of ['openai', 'google', 'flux'] as const) {
      const key = config.image_backends[backend].api_key
      if (key && !isEncoded(key)) {
        config.image_backends[backend].api_key = encodeApiKey(key)
      }
    }

    saveConfig(config)
    return { success: true }
  })

  ipcMain.handle('settings:checkLocalModel', (_event, filename: string) => {
    return checkModelExists(filename)
  })
}

// Heuristic: encoded keys are valid base64 and decode to something that,
// when reversed, looks like a typical API key prefix (sk-, AI, etc.).
// Since encodeApiKey produces pure base64, we check if the value is already base64.
function isEncoded(value: string): boolean {
  return /^[A-Za-z0-9+/]+=*$/.test(value) && value.length > 20
}
