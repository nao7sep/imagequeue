import { BrowserWindow, ipcMain, shell, dialog, app, clipboard, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
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
  readCustomJsonImportedFiles,
  ensureModelsDir,
} from './local-cli'
import {
  startCliJob,
  subscribeCliJob,
  unsubscribeCliJob,
  killCliJob,
  getCliJobSnapshot,
} from './cli-jobs'
import {
  downloadLatestRecommendations,
  getRecommendationsStatus,
  importRecommendations,
  resolveRecommendedParams
} from './recommendations'
import { getModelParams, setModelParams } from './model-params'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER, type DrawThingsModelParams } from '../shared/types'

function readClipboardText(): string {
  return clipboard.readText()
}

// IPC handlers for reading/writing settings.
export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => {
    // Clone before mutating so the in-memory cache keeps encoded keys.
    // (loadConfig returns a reference to its internal cache; mutating it directly
    //  causes the next call to decode an already-decoded key, producing garbage.)
    const config = JSON.parse(JSON.stringify(loadConfig())) as AppConfig
    config.text_ai.api_key = decodeApiKey(config.text_ai.api_key)
    for (const backend of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      config.image_backends[backend].api_key = decodeApiKey(config.image_backends[backend].api_key)
    }
    return config
  })

  ipcMain.handle('settings:save', (_event, config: AppConfig) => {
    // Always encode API keys before persisting (renderer sends plain text)
    config.text_ai.api_key = encodeApiKey(config.text_ai.api_key)
    for (const backend of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
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

  ipcMain.handle('local:readCustomJsonImportedFiles', () => {
    return readCustomJsonImportedFiles()
  })

  ipcMain.handle('local:ensureModel', async (_event, modelFile: string) => {
    return ensureModel(modelFile)
  })

  ipcMain.handle('local:getModelsDir', () => {
    return resolveModelsDir()
  })

  ipcMain.handle('local:getDefaultModelsDir', () => {
    return getDefaultModelsDir()
  })

  ipcMain.handle('local:openModelsDir', () => {
    const dir = resolveModelsDir()
    fs.mkdirSync(dir, { recursive: true })
    shell.openPath(dir)
  })

  ipcMain.handle('cli-job:startImport', (event, artifactPath: string) => {
    const config = loadConfig()
    const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'
    const dir = ensureModelsDir()
    const jobId = startCliJob({
      kind: 'import',
      cliPath,
      args: ['models', 'import', artifactPath, '--models-dir', dir],
      target: path.basename(artifactPath),
      logContext: { artifactPath },
    })
    subscribeCliJob(jobId, event.sender)
    return jobId
  })

  ipcMain.handle('cli-job:startDownload', (event, modelFile: string) => {
    const config = loadConfig()
    const cliPath = config.image_backends.drawthings.cli_path || 'draw-things-cli'
    const dir = ensureModelsDir()
    const jobId = startCliJob({
      kind: 'download',
      cliPath,
      args: ['models', 'ensure', '--model', modelFile, '--models-dir', dir],
      target: modelFile,
      logContext: { modelFile },
    })
    subscribeCliJob(jobId, event.sender)
    return jobId
  })

  ipcMain.handle('cli-job:subscribe', (event, jobId: string) => {
    return subscribeCliJob(jobId, event.sender)
  })

  ipcMain.handle('cli-job:unsubscribe', (event, jobId: string) => {
    unsubscribeCliJob(jobId, event.sender)
  })

  ipcMain.handle('cli-job:kill', (_event, jobId: string) => {
    killCliJob(jobId)
  })

  ipcMain.handle('cli-job:getSnapshot', (_event, jobId: string) => {
    return getCliJobSnapshot(jobId)
  })

  ipcMain.handle('recommendations:getStatus', () => {
    return getRecommendationsStatus()
  })

  ipcMain.handle('recommendations:downloadLatest', async () => {
    return downloadLatestRecommendations()
  })

  ipcMain.handle('recommendations:import', (_event, filePath: string) => {
    return importRecommendations(filePath)
  })

  ipcMain.handle('recommendations:resolve', (_event, modelFile: string) => {
    return resolveRecommendedParams(modelFile)
  })

  ipcMain.handle('dialog:openFile', async (event, filters: Electron.FileFilter[]) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openFile'] as const, filters }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    let parsed: URL
    try { parsed = new URL(url) } catch { return }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
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
    fs.mkdirSync(exportDir, { recursive: true })
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

  ipcMain.handle('shell:exportImageAs', async (event, baseName: string, ext: string) => {
    const config = loadConfig()
    const exportDir = config.general.export_dir || app.getPath('desktop')
    const src = path.join(getSessionDir(), `${baseName}.${ext}`)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      defaultPath: path.join(exportDir, `${baseName}.${ext}`),
      filters: [{ name: 'Images', extensions: [ext, 'png', 'jpg', 'webp'] }]
    }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    fs.mkdirSync(path.dirname(result.filePath), { recursive: true })
    fs.copyFileSync(src, result.filePath)
    return result.filePath
  })

  ipcMain.handle('clipboard:readText', () => {
    return readClipboardText()
  })

  ipcMain.handle('clipboard:hasText', () => {
    return readClipboardText().trim().length > 0
  })

  ipcMain.handle('clipboard:copyImage', (_event, baseName: string, ext: string) => {
    const filePath = path.join(getSessionDir(), `${baseName}.${ext}`)
    const buffer = fs.readFileSync(filePath)
    clipboard.writeImage(nativeImage.createFromBuffer(buffer))
  })

  ipcMain.handle('dialog:openDirectory', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory', 'createDirectory'] as const }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('drawthings:getModelParams', (_event, modelFile: string) => {
    return getModelParams(modelFile)
  })

  ipcMain.handle('drawthings:setModelParams', (_event, modelFile: string, params: DrawThingsModelParams) => {
    setModelParams(modelFile, params)
  })
}
