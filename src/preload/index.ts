import { contextBridge, ipcRenderer } from 'electron'
import {
  BackendId,
  EnqueueRequest,
  Task,
  CliStatus,
  LocalModelInfo,
  RecommendedParams,
  RecommendationOperationResult,
  RecommendationStatus
} from '../shared/types'
import type {
  CliJobSnapshot,
  CliChunkEvent,
  CliStatusEvent,
} from '../shared/cli-jobs'

export type { CliStatus, LocalModelInfo }
export type { CliJobSnapshot, CliChunkEvent, CliStatusEvent }

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
  getImage: (baseName: string): Promise<{ data: string; ext: 'png' | 'jpg' | 'webp' } | null> =>
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

  localReadCustomJsonImportedFiles: (): Promise<string[] | null> =>
    ipcRenderer.invoke('local:readCustomJsonImportedFiles'),

  localEnsureModel: (modelFile: string): Promise<EnsureModelResult> =>
    ipcRenderer.invoke('local:ensureModel', modelFile),

  localGetModelsDir: (): Promise<string> =>
    ipcRenderer.invoke('local:getModelsDir'),

  localGetDefaultModelsDir: (): Promise<string> =>
    ipcRenderer.invoke('local:getDefaultModelsDir'),

  localOpenModelsDir: (): Promise<void> =>
    ipcRenderer.invoke('local:openModelsDir'),

  cliStartImport: (artifactPath: string): Promise<string> =>
    ipcRenderer.invoke('cli-job:startImport', artifactPath),

  cliStartDownload: (modelFile: string): Promise<string> =>
    ipcRenderer.invoke('cli-job:startDownload', modelFile),

  cliSubscribeJob: (jobId: string): Promise<CliJobSnapshot | null> =>
    ipcRenderer.invoke('cli-job:subscribe', jobId),

  cliUnsubscribeJob: (jobId: string): Promise<void> =>
    ipcRenderer.invoke('cli-job:unsubscribe', jobId),

  cliKillJob: (jobId: string): Promise<void> =>
    ipcRenderer.invoke('cli-job:kill', jobId),

  cliGetJobSnapshot: (jobId: string): Promise<CliJobSnapshot | null> =>
    ipcRenderer.invoke('cli-job:getSnapshot', jobId),

  onCliJobChunk: (callback: (e: CliChunkEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, e: CliChunkEvent): void => callback(e)
    ipcRenderer.on('cli-job:chunk', handler)
    return () => { ipcRenderer.removeListener('cli-job:chunk', handler) }
  },

  onCliJobStatus: (callback: (e: CliStatusEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, e: CliStatusEvent): void => callback(e)
    ipcRenderer.on('cli-job:status', handler)
    return () => { ipcRenderer.removeListener('cli-job:status', handler) }
  },

  getRecommendationsStatus: (): Promise<RecommendationStatus> =>
    ipcRenderer.invoke('recommendations:getStatus'),

  downloadRecommendations: (): Promise<RecommendationOperationResult> =>
    ipcRenderer.invoke('recommendations:downloadLatest'),

  importRecommendations: (filePath: string): Promise<RecommendationOperationResult> =>
    ipcRenderer.invoke('recommendations:import', filePath),

  resolveRecommendation: (modelFile: string): Promise<RecommendedParams | null> =>
    ipcRenderer.invoke('recommendations:resolve', modelFile),

  openFileDialog: (filters: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openFile', filters),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),

  openOutputFolder: (): Promise<void> =>
    ipcRenderer.invoke('shell:openOutputFolder'),

  revealFile: (baseName: string, ext: string): Promise<void> =>
    ipcRenderer.invoke('shell:revealFile', baseName, ext),

  exportImage: (baseName: string, ext: string): Promise<string> =>
    ipcRenderer.invoke('shell:exportImage', baseName, ext),

  exportImageAs: (baseName: string, ext: string): Promise<string | null> =>
    ipcRenderer.invoke('shell:exportImageAs', baseName, ext),

  copyImageToClipboard: (baseName: string, ext: string): Promise<void> =>
    ipcRenderer.invoke('clipboard:copyImage', baseName, ext),

  openDirectoryDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),

  openViewer: (dataUrl: string): Promise<void> =>
    ipcRenderer.invoke('viewer:open', dataUrl),

  closeViewer: (): Promise<void> =>
    ipcRenderer.invoke('viewer:close'),

  showNotification: (type: 'success' | 'failure'): Promise<void> =>
    ipcRenderer.invoke('notification:show', type),

  loadAudioFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('notification:loadAudioFile', filePath),

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
