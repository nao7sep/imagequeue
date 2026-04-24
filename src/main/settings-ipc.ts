import { ipcMain, shell, dialog, app, clipboard, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { loadConfig, saveConfig, encodeApiKey, decodeApiKey, getDataDir } from './config'
import { getSessionDir } from './session'
import { AppConfig } from './config/types'
import { checkModelExists } from './backends'
import {
  checkCli,
  listDownloadedModels,
  listAvailableModels,
  ensureModel,
  resolveModelsDir,
  getDefaultModelsDir,
  openTerminalForDownload,
  openTerminalForImport
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

  ipcMain.handle('local:openTerminalForDownload', async (_event, modelFile: string) => {
    return openTerminalForDownload(modelFile)
  })

  ipcMain.handle('local:openTerminalForImport', async (_event, artifactPath: string) => {
    return openTerminalForImport(artifactPath)
  })

  ipcMain.handle('dialog:openFile', async (_event, filters: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('shell:openOutputFolder', () => {
    const outputDir = path.join(getDataDir(), 'output')
    fs.mkdirSync(outputDir, { recursive: true })
    shell.openPath(outputDir)
  })

  ipcMain.handle('shell:revealFile', (_event, baseName: string, ext: string) => {
    const filePath = path.join(getSessionDir(), `${baseName}.${ext}`)
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('shell:exportImage', async (_event, baseName: string, ext: string) => {
    const config = loadConfig()
    const exportDir = config.general.export_dir || app.getPath('desktop')
    const src = path.join(getSessionDir(), `${baseName}.${ext}`)
    let destName = `${baseName}.${ext}`
    let destPath = path.join(exportDir, destName)
    let n = 2
    while (fs.existsSync(destPath)) {
      destName = `${baseName}-${n}.${ext}`
      destPath = path.join(exportDir, destName)
      n++
    }
    fs.copyFileSync(src, destPath)
    return destPath
  })

  ipcMain.handle('shell:exportImageAs', async (_event, baseName: string, ext: string) => {
    const config = loadConfig()
    const exportDir = config.general.export_dir || app.getPath('desktop')
    const src = path.join(getSessionDir(), `${baseName}.${ext}`)
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(exportDir, `${baseName}.${ext}`),
      filters: [{ name: 'Images', extensions: [ext, 'png', 'jpg', 'webp'] }]
    })
    if (result.canceled || !result.filePath) return null
    fs.copyFileSync(src, result.filePath)
    return result.filePath
  })

  ipcMain.handle('clipboard:copyImage', (_event, baseName: string, ext: string) => {
    const filePath = path.join(getSessionDir(), `${baseName}.${ext}`)
    const buffer = fs.readFileSync(filePath)
    clipboard.writeImage(nativeImage.createFromBuffer(buffer))
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
}
