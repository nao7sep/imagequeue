import { ipcMain, shell } from 'electron'
import path from 'path'
import os from 'os'
import { loadConfig, saveConfig, encodeApiKey } from './config'
import { AppConfig } from './config/types'
import { checkModelExists } from './backends'
import {
  checkCli,
  listDownloadedModels,
  listAvailableModels,
  ensureModel,
  resolveModelsDir,
  getDefaultModelsDir
} from './local-cli'

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
    for (const backend of ['openai', 'imagen', 'flux'] as const) {
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

  ipcMain.handle('settings:saveUi', (_event, ui: { leftPaneWidth: number }) => {
    const config = loadConfig()
    config.ui = { ...config.ui, ...ui }
    saveConfig(config)
    return { success: true }
  })

  // --- Draw Things CLI integration ---

  ipcMain.handle('local:checkCli', async () => {
    return checkCli()
  })

  ipcMain.handle('local:listDownloadedModels', async () => {
    return listDownloadedModels()
  })

  ipcMain.handle('local:listAvailableModels', async () => {
    return listAvailableModels()
  })

  ipcMain.handle('local:ensureModel', async (_event, modelFile: string) => {
    return ensureModel(modelFile)
  })

  ipcMain.handle('local:getModelsDir', () => {
    const dir = resolveModelsDir()
    return dir || null // null means CLI's own default
  })

  ipcMain.handle('local:getDefaultModelsDir', () => {
    return getDefaultModelsDir()
  })

  ipcMain.handle('local:openModelsDir', () => {
    const dir = resolveModelsDir()
    if (dir) {
      shell.openPath(dir)
    } else {
      // Open CLI's default location
      const cliDefault = path.join(os.homedir(), 'Library/Containers/com.liuliu.draw-things/Data/Documents/Models')
      shell.openPath(cliDefault)
    }
  })
}

// Heuristic: encoded keys are valid base64 and decode to something that,
// when reversed, looks like a typical API key prefix (sk-, AI, etc.).
// Since encodeApiKey produces pure base64, we check if the value is already base64.
function isEncoded(value: string): boolean {
  return /^[A-Za-z0-9+/]+=*$/.test(value) && value.length > 20
}
