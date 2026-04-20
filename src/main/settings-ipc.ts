import { ipcMain } from 'electron'
import { loadConfig, saveConfig } from './config'
import { AppConfig } from './config/types'

// IPC handlers for reading/writing settings.
export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => {
    return loadConfig()
  })

  ipcMain.handle('settings:save', (_event, config: AppConfig) => {
    saveConfig(config)
    return { success: true }
  })
}
