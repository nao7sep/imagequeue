import { authorizedSoundFile, grantPickedSoundFile } from './sound-file-grants'
import { BrowserWindow, ClipboardItem, shell, dialog, app, clipboard, nativeImage } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { ownExportDestination, waitForStorage } from './utils/storage-wait'
import { assertNotQuitting } from './quit-state'
import { handle } from './ipc-boundary'
import { saveImageBackendDefaults } from './backend-defaults'
import { loadConfig, updateConfig } from './config'
import { getStoredApiKey, setStoredApiKeys, hasApiKey, refreshApiKeys } from './config/api-keys-store'
import { applyChangedFields } from './settings-changes'
import { refreshMainWindowMinimumSize, setDrawThingsReady } from './main-window-layout'
import { getSessionDir } from './session'
import { assertSafeBaseName, assertImageExt, exportPathForFormat, imageFormatFilter, stageExportCopy } from './utils/file-output'
import { claimFinalNameAsync } from './utils/atomic-write'
import { syncDirectoryAsync } from './utils/fsync'
import { AppConfig } from './config/types'
import { openSessionsFolder } from './session/open-sessions-folder'
import { log, serializeError } from './logger'
import { mainTranslator } from './i18n'
import { systemAppearance } from './theme'
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
import { expandUserPath, resolveSettingsPath } from './utils/user-path'
import { applyDimensionsToModels, drainSetAsideModelParamsPaths, getAllModelParams, getModelParams, setModelParams, type DrawThingsDimensionPatch } from './model-params'
import { modelParamsResetPresentation } from './failure-presentation'
import { getModelParamsPersistenceState } from './model-params-persistence'
import {
  CLOUD_BACKEND_IDS_IN_UI_ORDER,
  IMAGE_BACKEND_SECRET,
  SECRET_IDS,
  type CloudBackendId,
  type DrawThingsModelParams,
  type SecretId,
} from '../shared/types'

// Absolute settings references remain literal; authored relative expressions
// resolve against Home. An unset export destination uses Desktop.
function configuredExportDir(): string {
  const configured = loadConfig().general.export_dir
  return configured ? resolveSettingsPath(configured, os.homedir()) : app.getPath('desktop')
}

// Native absolute selections remain literal. GUI-authored relative sources use
// Home so importing is independent of the launcher and the CLI's working directory.
// The CLI receives an argument, not shell text: variable names stay literal.
function importSourcePath(raw: string): string {
  if (path.isAbsolute(raw)) return raw
  const authored = raw.trim()
  if (authored === '~') return os.homedir()
  if (authored.startsWith('~/') || authored.startsWith('~\\')) return path.join(os.homedir(), authored.slice(2))
  return path.resolve(os.homedir(), authored)
}

// A missing proposal should still open somewhere useful, without creating it.
async function existingPickerPath(candidate: string): Promise<string | undefined> {
  let current = candidate
  while (current) {
    if (await fs.promises.stat(current).then(() => true, () => false)) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

function readClipboardText(): Promise<string> {
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

function validateKeyChanges(changes: Record<string, string>): void {
  for (const [id, value] of Object.entries(changes ?? {})) {
    if (!secretIds.has(id) || typeof value !== 'string') throw new Error(`Cannot save unsupported api key: ${id}`)
  }
}

// IPC handlers for reading/writing settings.
export function registerSettingsIpc(
  onConfigSaved?: (config: AppConfig) => Promise<void> | void,
): void {
  handle('theme:systemAppearance', () => systemAppearance())

  handle('settings:get', () => {
    // The config carries no keys — they are neither in the type nor in this
    // payload — so the cached object is returned as-is (IPC serializes it).
    return loadConfig()
  })

  handle('settings:saveChangedFields', async (event, base: AppConfig, next: AppConfig, keys: Record<string, string> = {}, authoredPaths: string[] = []) => {
    validateKeyChanges(keys)
    for (const field of ['success_file', 'failure_file'] as const) {
      const raw = next.notifications[field]
      if (raw && raw !== base.notifications[field]) {
        const resolved = authoredPaths.includes(field) ? expandUserPath(raw, os.homedir()) : resolveSettingsPath(raw, os.homedir())
        if (!await authorizedSoundFile(resolved, event.sender)) throw new Error('Sound file access was not granted')
      }
    }
    // After native consent, both store owners capture the complete form before
    // waiting on writes. Quit can drain/retry that admitted submission.
    const results = await Promise.allSettled([
      updateConfig((draft) => {
        applyChangedFields(draft as unknown as Record<string, unknown>, base, next)
        // Expand text edits once at admission; native selections and unchanged
        // stored references must never be interpreted as expressions again.
        if (authoredPaths.includes('export_dir') && next.general.export_dir !== base.general.export_dir) {
          draft.general.export_dir = next.general.export_dir ? expandUserPath(next.general.export_dir, os.homedir()) : ''
        }
        for (const field of ['success_file', 'failure_file'] as const) {
          if (authoredPaths.includes(field) && next.notifications[field] !== base.notifications[field]) {
            draft.notifications[field] = next.notifications[field] ? expandUserPath(next.notifications[field], os.homedir()) : ''
          }
        }
      }),
      Object.keys(keys).length ? setStoredApiKeys(keys) : Promise.resolve(),
    ])
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    const config = loadConfig()
    if (Object.keys(keys).length) refreshMainWindowMinimumSize()
    if (onConfigSaved) {
      try {
        await onConfigSaved(config)
      } catch (err) {
        // The durable config write succeeded. A native presentation failure is
        // logged and degraded, never reported as a failed settings save.
        log('error', 'Post-settings-save reconciliation failed', { error: serializeError(err) })
      }
    }
    return { success: true }
  })

  // Keys are read and written by key id, separately from
  // the config payload. The STORED value is surfaced, not the resolved one: an
  // environment-supplied key must stay invisible to the form so that saving a
  // field the user never touched cannot overwrite it.
  handle('settings:getApiKeys', async () => {
    await refreshApiKeys()
    const keys = {} as Record<SecretId, string>
    for (const id of SECRET_IDS) keys[id] = getStoredApiKey(id)
    return keys
  })

  // Which secrets are actually resolvable, environment value included. The
  // renderer cannot work this out for itself: settings:get deliberately surfaces
  // only the STORED key, so that editing a field can never silently overwrite an
  // env-supplied one — which means a backend configured purely by environment
  // variable looks unconfigured to every UI check that reads that string. This
  // handler is the presence signal those checks need; it never carries a value.
  handle('settings:getApiKeyPresence', async () => {
    await refreshApiKeys()
    const image = {} as Record<CloudBackendId, boolean>
    for (const backend of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      image[backend] = hasApiKey(IMAGE_BACKEND_SECRET[backend])
    }
    return { image, geminiText: hasApiKey('gemini.text'), openaiText: hasApiKey('openai.text') }
  })

  handle('settings:saveBrainstorm', async (_event, brainstorm: AppConfig['brainstorm']) => {
    await updateConfig((draft) => {
      draft.brainstorm = brainstorm
    })
    return { success: true }
  })

  handle(
    'settings:saveImageBackendDefaults',
    async (_event, backend: CloudBackendId, model: string, params: Record<string, unknown>) => {
      if (!cloudBackendIds.has(backend)) {
        throw new Error(`Cannot save image backend defaults for unsupported backend: ${backend}`)
      }
      await saveImageBackendDefaults(backend, model, params)
      return { success: true }
    }
  )

  handle('settings:saveNotificationField', async (event, field: string, value: unknown) => {
    if (!notificationFields.has(field)) {
      throw new Error(`Cannot save unsupported notification setting: ${field}`)
    }

    if (field === 'success_file' || field === 'failure_file') {
      if (typeof value !== 'string') throw new Error('Invalid sound file path')
      if (value && !await authorizedSoundFile(resolveSettingsPath(value, os.homedir()), event.sender)) throw new Error('Sound file access was not granted')
    }
    await updateConfig((draft) => {
      const notifications = draft.notifications as unknown as Record<string, unknown>
      notifications[field] = value
    })
    return { success: true }
  })

  // --- Draw Things CLI integration ---

  handle('local:checkCli', async () => {
    const status = await checkCli()
    if (!status.installed) setDrawThingsReady(false)
    return status
  })

  handle('local:listDownloadedModels', async () => {
    const models = await listDownloadedModels()
    setDrawThingsReady(models.length > 0)
    return models
  })

  handle('local:listAvailableModels', async () => {
    return listAvailableModels()
  })

  handle('local:readCustomJsonImportedFiles', () => {
    return readCustomJsonImportedFiles()
  })

  handle('cli-job:startImport', async (event, artifactPath: string) => {
    artifactPath = importSourcePath(artifactPath)
    const cliPath = resolveCliPath()
    const dir = await ensureModelsDir()
    assertNotQuitting()
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

  handle('cli-job:startDownload', async (event, modelFile: string) => {
    const cliPath = resolveCliPath()
    const dir = await ensureModelsDir()
    assertNotQuitting()
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

  handle('dialog:openFile', async (event, filters: Electron.FileFilter[], currentPath?: string, purpose?: 'model-import', authored = false) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const resolved = currentPath
      ? purpose === 'model-import' ? importSourcePath(currentPath) : authored ? expandUserPath(currentPath, os.homedir()) : resolveSettingsPath(currentPath, os.homedir())
      : undefined
    const defaultPath = resolved ? await existingPickerPath(resolved) : undefined
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters, ...(defaultPath ? { defaultPath } : {}) }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    const selected = result.canceled ? null : result.filePaths[0]
    if (selected && purpose !== 'model-import') await grantPickedSoundFile(selected)
    return selected
  })

  handle('shell:openExternal', async (_event, url: string) => {
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new Error('External URL is invalid') }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('External URL scheme is not allowed')
    }
    await shell.openExternal(url)
  })

  handle('shell:openSessionsFolder', openSessionsFolder)

  handle('shell:revealFile', async (_event, baseName: string, ext: string) => {
    const safeBase = assertSafeBaseName(baseName)
    const safeExt = assertImageExt(ext)
    const filePath = path.join(getSessionDir(), `${safeBase}.${safeExt}`)
    if (!await fs.promises.stat(filePath).then(() => true, () => false)) {
      throw new Error(`Cannot reveal missing image: ${filePath}`)
    }
    shell.showItemInFolder(filePath)
  })

  handle('shell:exportImage', async (_event, baseName: string, ext: string) => {
    const safeBase = assertSafeBaseName(baseName)
    const safeExt = assertImageExt(ext)
    const exportDir = configuredExportDir()
    const src = path.join(getSessionDir(), `${safeBase}.${safeExt}`)
    const requestedDestination = path.join(exportDir, `${safeBase}.${safeExt}`)
    return ownExportDestination(requestedDestination, async () => {
      await fs.promises.mkdir(exportDir, { recursive: true })
      let destPath = requestedDestination
      const staging = await stageExportCopy(src, destPath)
      try {
        // An earlier export of the same image keeps its name; this one takes the next free one.
        for (let n = 2; !await claimFinalNameAsync(staging, destPath); n++) {
          destPath = path.join(exportDir, `${safeBase}-${n}.${safeExt}`)
        }
        await syncDirectoryAsync(exportDir)
      } finally {
        await fs.promises.rm(staging, { force: true }).catch(() => undefined)
      }
      return destPath
    })
  })

  handle('shell:exportImageAs', async (event, baseName: string, ext: string) => {
    const safeBase = assertSafeBaseName(baseName)
    const safeExt = assertImageExt(ext)
    const exportDir = configuredExportDir()
    const src = path.join(getSessionDir(), `${safeBase}.${safeExt}`)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      defaultPath: path.join(exportDir, `${safeBase}.${safeExt}`),
      filters: [imageFormatFilter(safeExt, mainTranslator())]
    }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    assertNotQuitting()
    const destPath = exportPathForFormat(result.filePath, safeExt)
    return waitForStorage(ownExportDestination(destPath, async () => {
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
      // The user chose this name, replacing any file there; it is replaced only
      // once the complete copy is in place beside it.
      const staging = await stageExportCopy(src, destPath)
      try {
        await fs.promises.rename(staging, destPath)
        await syncDirectoryAsync(path.dirname(destPath))
      } finally {
        await fs.promises.rm(staging, { force: true }).catch(() => undefined)
      }
      return destPath
    }))
  })

  handle('clipboard:readText', () => {
    return readClipboardText()
  })

  handle('clipboard:hasText', async () => {
    return (await readClipboardText()).trim().length > 0
  })

  handle('clipboard:copyImage', async (_event, baseName: string, ext: string) => {
    const filePath = path.join(getSessionDir(), `${assertSafeBaseName(baseName)}.${assertImageExt(ext)}`)
    const buffer = await fs.promises.readFile(filePath)
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) throw new Error(`Cannot copy unreadable image: ${filePath}`)
    const png = new Uint8Array(image.toPNG())
    await clipboard.write([
      new ClipboardItem({
        'image/png': new Blob([png], { type: 'image/png' })
      })
    ])
  })

  handle('dialog:openDirectory', async (event, currentPath?: string, authored = false) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const defaultPath = await existingPickerPath(currentPath ? (authored ? expandUserPath : resolveSettingsPath)(currentPath, os.homedir()) : app.getPath('desktop'))
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], ...(defaultPath ? { defaultPath } : {}) }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  // The first request to read params.json may set aside an unreadable file;
  // the window that made it names the preserved copy.
  const withParamsRecovery = <T>(event: Electron.IpcMainInvokeEvent, operation: () => T): T => {
    try {
      return operation()
    } finally {
      for (const movedTo of drainSetAsideModelParamsPaths()) {
        event.sender.send('app:notice', modelParamsResetPresentation(movedTo))
      }
    }
  }

  handle('drawthings:getModelParams', (event, modelFile: string) => {
    return withParamsRecovery(event, () => getModelParams(modelFile))
  })

  handle('drawthings:getAllModelParams', (event) => {
    return withParamsRecovery(event, getAllModelParams)
  })

  handle('drawthings:getParamsPersistenceState', () => {
    return getModelParamsPersistenceState()
  })

  handle('drawthings:setModelParams', (event, modelFile: string, params: DrawThingsModelParams) => {
    withParamsRecovery(event, () => setModelParams(modelFile, params))
  })

  handle('drawthings:applyParamsToAll', (event, modelFiles: string[], patch: DrawThingsDimensionPatch) => {
    withParamsRecovery(event, () => applyDimensionsToModels(modelFiles, patch))
  })
}
