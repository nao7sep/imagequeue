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
import { applyDimensionsToModels, getAllModelParams, getModelParams, setModelParams, type DrawThingsDimensionPatch } from './model-params'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER, type CloudBackendId, type DrawThingsModelParams } from '../shared/types'

function readClipboardText(): string {
  return clipboard.readText()
}

const cloudBackendIds = new Set<string>(CLOUD_BACKEND_IDS_IN_UI_ORDER)
const notificationFields = new Set<string>([
  'notifications_enabled',
  'sounds_enabled',
  'volume',
  'success_file',
  'failure_file',
])
const settingsRootFields = new Set<string>([
  'text_ai',
  'general',
  'image_backends',
  'notifications',
  'prompts',
])
const encodedApiKeyPaths = new Set<string>([
  'text_ai.gemini.api_key',
  'text_ai.openai.api_key',
  ...CLOUD_BACKEND_IDS_IN_UI_ORDER.map((backend) => `image_backends.${backend}.api_key`),
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function valueForConfigPath(pathParts: string[], value: unknown): unknown {
  return encodedApiKeyPaths.has(pathParts.join('.')) ? encodeApiKey(String(value ?? '')) : value
}

function setConfigPath(target: Record<string, unknown>, pathParts: string[], value: unknown): void {
  if (pathParts.length === 0) return
  let cursor = target
  for (const part of pathParts.slice(0, -1)) {
    const next = cursor[part]
    if (!isPlainObject(next)) {
      cursor[part] = {}
    }
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[pathParts[pathParts.length - 1]] = valueForConfigPath(pathParts, value)
}

function applyChangedFields(
  target: Record<string, unknown>,
  base: unknown,
  next: unknown,
  pathParts: string[] = []
): void {
  if (valuesEqual(base, next)) return

  if (pathParts.length === 0) {
    if (!isPlainObject(next)) throw new Error('Settings changes must be an object')
    for (const key of Object.keys(next)) {
      const baseValue = isPlainObject(base) ? base[key] : undefined
      if (!settingsRootFields.has(key)) {
        if (valuesEqual(baseValue, next[key])) continue
        throw new Error(`Cannot save unsupported settings section: ${key}`)
      }
      applyChangedFields(target, baseValue, next[key], [key])
    }
    return
  }

  if (isPlainObject(next)) {
    for (const key of Object.keys(next)) {
      applyChangedFields(target, isPlainObject(base) ? base[key] : undefined, next[key], [...pathParts, key])
    }
    return
  }

  setConfigPath(target, pathParts, next)
}

// IPC handlers for reading/writing settings.
export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => {
    // Clone before mutating so the in-memory cache keeps encoded keys.
    // (loadConfig returns a reference to its internal cache; mutating it directly
    //  causes the next call to decode an already-decoded key, producing garbage.)
    const config = JSON.parse(JSON.stringify(loadConfig())) as AppConfig
    config.text_ai.gemini.api_key = decodeApiKey(config.text_ai.gemini.api_key)
    config.text_ai.openai.api_key = decodeApiKey(config.text_ai.openai.api_key)
    for (const backend of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      config.image_backends[backend].api_key = decodeApiKey(config.image_backends[backend].api_key)
    }
    return config
  })

  ipcMain.handle('settings:saveChangedFields', (_event, base: AppConfig, next: AppConfig) => {
    const config = loadConfig()
    applyChangedFields(config as unknown as Record<string, unknown>, base, next)
    saveConfig(config)
    return { success: true }
  })

  ipcMain.handle('settings:saveBrainstorm', (_event, brainstorm: AppConfig['brainstorm']) => {
    const config = loadConfig()
    config.brainstorm = brainstorm
    saveConfig(config)
    return { success: true }
  })

  ipcMain.handle(
    'settings:saveImageBackendDefaults',
    (_event, backend: CloudBackendId, model: string, params: Record<string, unknown>) => {
      if (!cloudBackendIds.has(backend)) {
        throw new Error(`Cannot save image backend defaults for unsupported backend: ${backend}`)
      }

      const config = loadConfig()
      const backends = config.image_backends as unknown as Record<
        CloudBackendId,
        { model: string; default_params: Record<string, unknown> } & Record<string, unknown>
      >
      const current = backends[backend]
      backends[backend] = {
        ...current,
        model,
        default_params: {
          ...current.default_params,
          ...params,
        },
      }

      saveConfig(config)
      return { success: true }
    }
  )

  ipcMain.handle('settings:saveNotificationField', (_event, field: string, value: unknown) => {
    if (!notificationFields.has(field)) {
      throw new Error(`Cannot save unsupported notification setting: ${field}`)
    }

    const config = loadConfig()
    const notifications = config.notifications as unknown as Record<string, unknown>
    notifications[field] = value
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
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters }
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
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('drawthings:getModelParams', (_event, modelFile: string) => {
    return getModelParams(modelFile)
  })

  ipcMain.handle('drawthings:getAllModelParams', () => {
    return getAllModelParams()
  })

  ipcMain.handle('drawthings:setModelParams', (_event, modelFile: string, params: DrawThingsModelParams) => {
    setModelParams(modelFile, params)
  })

  ipcMain.handle('drawthings:applyParamsToAll', (_event, modelFiles: string[], patch: DrawThingsDimensionPatch) => {
    applyDimensionsToModels(modelFiles, patch)
  })
}
