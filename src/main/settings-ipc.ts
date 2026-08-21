import { BrowserWindow, shell, dialog, app, clipboard, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { handle } from './ipc-boundary'
import { loadConfig, saveConfig, getDataDir } from './config'
import { getStoredApiKey, setStoredApiKey, hasApiKey } from './config/api-keys-store'
import { applyChangedFields } from './settings-changes'
import { refreshMainWindowMinimumSize } from './main-window-layout'
import { getSessionDir } from './session'
import { assertSafeBaseName, assertImageExt } from './utils/file-output'
import { AppConfig } from './config/types'
import {
  checkCli,
  listDownloadedModels,
  listAvailableModels,
  resolveCliPath,
  readCustomJsonImportedFiles,
  ensureModelsDir,
} from './local-cli'
import {
  startCliJob,
  subscribeCliJob,
  unsubscribeCliJob,
  killCliJob,
} from './cli-jobs'
import { resolveRecommendedParams } from './recommendations'
import { applyDimensionsToModels, getAllModelParams, getModelParams, setModelParams, type DrawThingsDimensionPatch } from './model-params'
import {
  CLOUD_BACKEND_IDS_IN_UI_ORDER,
  IMAGE_BACKEND_SECRET,
  SECRET_IDS,
  type CloudBackendId,
  type DrawThingsModelParams,
  type SecretId,
} from '../shared/types'

function readClipboardText(): string {
  return clipboard.readText()
}

const cloudBackendIds = new Set<string>(CLOUD_BACKEND_IDS_IN_UI_ORDER)
const secretIds = new Set<string>(SECRET_IDS)
const notificationFields = new Set<string>([
  'notifications_enabled',
  'sounds_enabled',
  'success_file',
  'failure_file',
])

// IPC handlers for reading/writing settings.
export function registerSettingsIpc(): void {
  handle('settings:get', () => {
    // The config carries no keys — they are neither in the type nor in this
    // payload — so the cached object is returned as-is (IPC serializes it).
    return loadConfig()
  })

  handle('settings:saveChangedFields', (_event, base: AppConfig, next: AppConfig) => {
    const config = loadConfig()
    applyChangedFields(config as unknown as Record<string, unknown>, base, next)
    saveConfig(config)
    return { success: true }
  })

  // Keys are read and written by key id, on their own channels, never as part of
  // the config payload. The STORED value is surfaced, not the resolved one: an
  // environment-supplied key must stay invisible to the form so that saving a
  // field the user never touched cannot overwrite it.
  handle('settings:getApiKeys', () => {
    const keys = {} as Record<SecretId, string>
    for (const id of SECRET_IDS) keys[id] = getStoredApiKey(id)
    return keys
  })

  handle('settings:saveApiKeys', (_event, changes: Record<string, string>) => {
    // Trust boundary: ids come from the renderer's payload, so each is checked
    // against the known set before it reaches the store.
    const entries = Object.entries(changes ?? {})
    for (const [id] of entries) {
      if (!secretIds.has(id)) throw new Error(`Cannot save unsupported api key: ${id}`)
    }
    for (const [id, value] of entries) {
      setStoredApiKey(id as SecretId, String(value ?? ''))
    }
    // Storing or clearing a key can add or remove a column, which moves the
    // window's derived minimum.
    if (entries.length > 0) refreshMainWindowMinimumSize()
    return { success: true }
  })

  // Which secrets are actually resolvable, environment value included. The
  // renderer cannot work this out for itself: settings:get deliberately surfaces
  // only the STORED key, so that editing a field can never silently overwrite an
  // env-supplied one — which means a backend configured purely by environment
  // variable looks unconfigured to every UI check that reads that string. This
  // handler is the presence signal those checks need; it never carries a value.
  handle('settings:getApiKeyPresence', () => {
    const image = {} as Record<CloudBackendId, boolean>
    for (const backend of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      image[backend] = hasApiKey(IMAGE_BACKEND_SECRET[backend])
    }
    return { image, geminiText: hasApiKey('gemini.text'), openaiText: hasApiKey('openai.text') }
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
