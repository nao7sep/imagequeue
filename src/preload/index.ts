import { contextBridge, ipcRenderer } from 'electron'
import { BackendId, EnqueueRequest, Task } from '../shared/types'

export interface CliStatus {
  installed: boolean
  version: string | null
  path: string | null
  platform: 'darwin' | 'unsupported'
}

export interface LocalModelInfo {
  file: string
  name: string
  source: string
  downloaded: boolean
  huggingFace: string | null
}

export interface EnsureModelResult {
  success: boolean
  error?: string
}

const api = {
  platform: process.platform,

  // Queue operations
  enqueue: (request: EnqueueRequest): Promise<Task[]> =>
    ipcRenderer.invoke('queue:enqueue', request),

  getTasks: (backend: BackendId): Promise<Task[]> =>
    ipcRenderer.invoke('queue:getTasks', backend),

  getAllTasks: (): Promise<Record<BackendId, Task[]>> =>
    ipcRenderer.invoke('queue:getAllTasks'),

  removeTask: (backend: BackendId, taskId: string): Promise<void> =>
    ipcRenderer.invoke('queue:removeTask', backend, taskId),

  deleteWithFiles: (backend: BackendId, taskId: string): Promise<void> =>
    ipcRenderer.invoke('queue:deleteWithFiles', backend, taskId),

  retryTask: (backend: BackendId, taskId: string): Promise<void> =>
    ipcRenderer.invoke('queue:retryTask', backend, taskId),

  reorderTasks: (backend: BackendId, taskIds: string[]): Promise<void> =>
    ipcRenderer.invoke('queue:reorderTasks', backend, taskIds),

  // Preview operations
  getImage: (baseName: string): Promise<string | null> =>
    ipcRenderer.invoke('preview:getImage', baseName),

  getMetadata: (baseName: string): Promise<Record<string, unknown> | null> =>
    ipcRenderer.invoke('preview:getMetadata', baseName),

  // Settings operations
  getSettings: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('settings:get'),

  saveSettings: (config: Record<string, unknown>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:save', config),

  checkLocalModel: (filename: string): Promise<boolean> =>
    ipcRenderer.invoke('settings:checkLocalModel', filename),

  // Draw Things CLI operations (macOS only)
  localCheckCli: (): Promise<CliStatus> =>
    ipcRenderer.invoke('local:checkCli'),

  localListDownloadedModels: (): Promise<LocalModelInfo[]> =>
    ipcRenderer.invoke('local:listDownloadedModels'),

  localListAvailableModels: (): Promise<LocalModelInfo[]> =>
    ipcRenderer.invoke('local:listAvailableModels'),

  localEnsureModel: (modelFile: string): Promise<EnsureModelResult> =>
    ipcRenderer.invoke('local:ensureModel', modelFile),

  localGetModelsDir: (): Promise<string | null> =>
    ipcRenderer.invoke('local:getModelsDir'),

  localGetDefaultModelsDir: (): Promise<string> =>
    ipcRenderer.invoke('local:getDefaultModelsDir'),

  localOpenModelsDir: (): Promise<void> =>
    ipcRenderer.invoke('local:openModelsDir'),

  localDeleteModel: (modelFile: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('local:deleteModel', modelFile),

  localOpenTerminalForDownload: (modelFile: string): Promise<void> =>
    ipcRenderer.invoke('local:openTerminalForDownload', modelFile),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),

  // Event listener for queue updates pushed from main process
  onQueueUpdated: (callback: (tasks: Record<BackendId, Task[]>) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Record<BackendId, Task[]>): void => {
      callback(data)
    }
    ipcRenderer.on('queue:updated', handler)
    return () => { ipcRenderer.removeListener('queue:updated', handler) }
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api

