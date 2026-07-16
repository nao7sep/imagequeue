import { BrowserWindow, shell, dialog, app, clipboard, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { handle } from './ipc-boundary'
import { loadConfig, saveConfig, getDataDir } from './config'
import { getStoredApiKey, setStoredApiKey, IMAGE_BACKEND_SECRET } from './config/api-keys-store'
import { applyChangedFields } from './settings-changes'
import { getSessionDir } from './session'
import { assertSafeBaseName, assertImageExt } from './utils/file-output'
import { AppConfig } from './config/types'
import { checkModelExists } from './backends'
import {
  checkCli,
  listDownloadedModels,
  listAvailableModels,
  ensureModel,
  resolveModelsDir,
  resolveCliPath,
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
import { resolveRecommendedParams } from './recommendations'
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

// IPC handlers for reading/writing settings.
export function registerSettingsIpc(): void {
  handle('settings:get', () => {
    // Clone the cached config so we never mutate the in-memory instance, then
    // overlay the api_key fields from the separate secrets store (the only place
    // keys live). The stored — not the environment — value is surfaced so editing
    // never silently overwrites an env-supplied key.
    const config = JSON.parse(JSON.stringify(loadConfig())) as AppConfig
    config.text_ai.gemini.api_key = getStoredApiKey('gemini.text')
    config.text_ai.openai.api_key = getStoredApiKey('openai.text')
    for (const backend of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      config.image_backends[backend].api_key = getStoredApiKey(IMAGE_BACKEND_SECRET[backend])
    }
    return config
  })

  handle('settings:saveChangedFields', (_event, base: AppConfig, next: AppConfig) => {
    const config = loadConfig()
    const secretWrites = applyChangedFields(config as unknown as Record<string, unknown>, base, next)
    for (const { secret, value } of secretWrites) {
      setStoredApiKey(secret, value)
    }
    saveConfig(config)
    return { success: true }
  })

  handle('settings:saveBrainstorm', (_event, brainstorm: AppConfig['brainstorm']) => {
    const config = loadConfig()
    config.brainstorm = brainstorm
    saveConfig(config)
    return { success: true }
  })

  handle(
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

  handle('settings:saveNotificationField', (_event, field: string, value: unknown) => {
    if (!notificationFields.has(field)) {
      throw new Error(`Cannot save unsupported notification setting: ${field}`)
    }

    const config = loadConfig()
    const notifications = config.notifications as unknown as Record<string, unknown>
    notifications[field] = value
    saveConfig(config)
    return { success: true }
  })

  handle('settings:checkLocalModel', (_event, filename: string) => {
    return checkModelExists(filename)
  })

  // --- Draw Things CLI integration ---

  handle('local:checkCli', async () => {
    return checkCli()
  })

  handle('local:listDownloadedModels', async () => {
    return listDownloadedModels()
  })

  handle('local:listAvailableModels', async () => {
    return listAvailableModels()
  })

  handle('local:readCustomJsonImportedFiles', () => {
    return readCustomJsonImportedFiles()
  })

  handle('local:ensureModel', async (_event, modelFile: string) => {
    return ensureModel(modelFile)
  })

  handle('local:getModelsDir', () => {
    return resolveModelsDir()
  })

  handle('local:getDefaultModelsDir', () => {
    return getDefaultModelsDir()
  })

  // Opening the models directory doubles as the way to remove an imported model: the Draw Things
  // CLI has no models-delete verb (only `list`/`ensure`/`import`), so deletion is a manual file
  // removal here — and an import can drop companion files beside the checkpoint, so removing one
  // means deleting the whole artifact set, not just the .ckpt.
  handle('local:openModelsDir', () => {
    const dir = resolveModelsDir()
    fs.mkdirSync(dir, { recursive: true })
    shell.openPath(dir)
  })

  handle('cli-job:startImport', (event, artifactPath: string) => {
    const cliPath = resolveCliPath()
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

  handle('cli-job:startDownload', (event, modelFile: string) => {
    const cliPath = resolveCliPath()
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

  handle('cli-job:subscribe', (event, jobId: string) => {
    return subscribeCliJob(jobId, event.sender)
  })

  handle('cli-job:unsubscribe', (event, jobId: string) => {
    unsubscribeCliJob(jobId, event.sender)
  })

  handle('cli-job:kill', (_event, jobId: string) => {
    killCliJob(jobId)
  })

  handle('cli-job:getSnapshot', (_event, jobId: string) => {
    return getCliJobSnapshot(jobId)
  })

  handle('recommendations:resolve', (_event, modelFile: string) => {
    return resolveRecommendedParams(modelFile)
  })

  handle('dialog:openFile', async (event, filters: Electron.FileFilter[]) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  handle('shell:openExternal', (_event, url: string) => {
    let parsed: URL
    try { parsed = new URL(url) } catch { return }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    shell.openExternal(url)
  })

  handle('shell:openOutputFolder', () => {
    const outputDir = path.join(getDataDir(), 'output')
    fs.mkdirSync(outputDir, { recursive: true })
    shell.openPath(outputDir)
  })

  handle('shell:revealFile', (_event, baseName: string, ext: string) => {
    const safeBase = assertSafeBaseName(baseName)
    const safeExt = assertImageExt(ext)
    const filePath = path.join(getSessionDir(), `${safeBase}.${safeExt}`)
    shell.showItemInFolder(filePath)
  })

  handle('shell:exportImage', async (_event, baseName: string, ext: string) => {
    const safeBase = assertSafeBaseName(baseName)
    const safeExt = assertImageExt(ext)
    const config = loadConfig()
    const exportDir = config.general.export_dir || app.getPath('desktop')
    fs.mkdirSync(exportDir, { recursive: true })
    const src = path.join(getSessionDir(), `${safeBase}.${safeExt}`)
    let destName = `${safeBase}.${safeExt}`
    let destPath = path.join(exportDir, destName)
    let n = 2
    while (fs.existsSync(destPath)) {
      destName = `${safeBase}-${n}.${safeExt}`
      destPath = path.join(exportDir, destName)
      n++
    }
    fs.copyFileSync(src, destPath)
    return destPath
  })

  handle('shell:exportImageAs', async (event, baseName: string, ext: string) => {
    const safeBase = assertSafeBaseName(baseName)
    const safeExt = assertImageExt(ext)
    const config = loadConfig()
    const exportDir = config.general.export_dir || app.getPath('desktop')
    const src = path.join(getSessionDir(), `${safeBase}.${safeExt}`)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      defaultPath: path.join(exportDir, `${safeBase}.${safeExt}`),
      filters: [{ name: 'Images', extensions: [safeExt, 'png', 'jpg', 'webp'] }]
    }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    fs.mkdirSync(path.dirname(result.filePath), { recursive: true })
    fs.copyFileSync(src, result.filePath)
    return result.filePath
  })

  handle('clipboard:readText', () => {
    return readClipboardText()
  })

  handle('clipboard:hasText', () => {
    return readClipboardText().trim().length > 0
  })

  handle('clipboard:copyImage', (_event, baseName: string, ext: string) => {
    const filePath = path.join(getSessionDir(), `${assertSafeBaseName(baseName)}.${assertImageExt(ext)}`)
    const buffer = fs.readFileSync(filePath)
    clipboard.writeImage(nativeImage.createFromBuffer(buffer))
  })

  handle('dialog:openDirectory', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  handle('drawthings:getModelParams', (_event, modelFile: string) => {
    return getModelParams(modelFile)
  })

  handle('drawthings:getAllModelParams', () => {
    return getAllModelParams()
  })

  handle('drawthings:setModelParams', (_event, modelFile: string, params: DrawThingsModelParams) => {
    setModelParams(modelFile, params)
  })

  handle('drawthings:applyParamsToAll', (_event, modelFiles: string[], patch: DrawThingsDimensionPatch) => {
    applyDimensionsToModels(modelFiles, patch)
  })
}
