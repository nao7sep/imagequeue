import { ipcMain, shell } from 'electron'
import path from 'path'
import os from 'os'
import { loadConfig, saveConfig, encodeApiKey, decodeApiKey } from './config'
import { AppConfig } from './config/types'
import { checkModelExists } from './backends'
import {
  checkCli,
  listDownloadedModels,
  listAvailableModels,
  ensureModel,
  resolveModelsDir,
  getDefaultModelsDir,
  deleteModel,
  openTerminalForDownload
} from './local-cli'

// IPC handlers for reading/writing settings.
export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => {
    // Clone before mutating so the in-memory cache keeps encoded keys.
    // (loadConfig returns a reference to its internal cache; mutating it directly
    //  causes the next call to decode an already-decoded key, producing garbage.)
    const config = JSON.parse(JSON.stringify(loadConfig())) as AppConfig
    config.text_ai.api_key = decodeApiKey(config.text_ai.api_key)
    for (const backend of ['openai', 'imagen', 'nanobanana', 'grok', 'flux'] as const) {
      config.image_backends[backend].api_key = decodeApiKey(config.image_backends[backend].api_key)
    }
    return config
  })

  ipcMain.handle('settings:save', (_event, config: AppConfig) => {
    // Always encode API keys before persisting (renderer sends plain text)
    config.text_ai.api_key = encodeApiKey(config.text_ai.api_key)
    for (const backend of ['openai', 'imagen', 'nanobanana', 'grok', 'flux'] as const) {
      config.image_backends[backend].api_key = encodeApiKey(config.image_backends[backend].api_key)
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

  ipcMain.handle('local:deleteModel', async (_event, modelFile: string) => {
    return deleteModel(modelFile)
  })

  ipcMain.handle('local:openTerminalForDownload', async (_event, modelFile: string) => {
    return openTerminalForDownload(modelFile)
  })

  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    shell.openExternal(url)
  })
}
