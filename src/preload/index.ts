import { contextBridge, ipcRenderer } from 'electron'
import {
  BackendId,
  CloudBackendId,
  Elaborator,
  ElaboratorKind,
  EnqueueBatchUnit,
  EnqueueRequest,
  Task,
  CliStatus,
  CustomJsonStatus,
  LocalModelInfo,
  RecommendedParams,
  RecommendationOperationResult,
  RecommendationStatus,
  DrawThingsModelParams,
  SessionSummary,
} from '../shared/types'
import type { SessionDraft, PromptFormat, PromptLength } from '../shared/session-draft'
import type {
  CliJobSnapshot,
  CliChunkEvent,
  CliStatusEvent,
} from '../shared/cli-jobs'

export type { CliStatus, CustomJsonStatus, Elaborator, ElaboratorKind, LocalModelInfo, SessionSummary }
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

  enqueueBatch: (units: EnqueueBatchUnit[]): Promise<Task[]> =>
    ipcRenderer.invoke('queue:enqueueBatch', units),

  getTasks: (backend: BackendId): Promise<Task[]> =>
    ipcRenderer.invoke('queue:getTasks', backend),

  getAllTasks: (): Promise<Record<BackendId, Task[]>> =>
    ipcRenderer.invoke('queue:getAllTasks'),

  getAllStoredTasks: (): Promise<Record<BackendId, Task[]>> =>
    ipcRenderer.invoke('queue:getAllStoredTasks'),

  removeTask: (backend: BackendId, taskId: string): Promise<void> =>
    ipcRenderer.invoke('queue:removeTask', backend, taskId),

  restoreTask: (backend: BackendId, taskId: string): Promise<void> =>
    ipcRenderer.invoke('queue:restoreTask', backend, taskId),

  deleteWithFiles: (backend: BackendId, taskId: string): Promise<void> =>
    ipcRenderer.invoke('queue:deleteWithFiles', backend, taskId),

  retryTask: (backend: BackendId, taskId: string): Promise<void> =>
    ipcRenderer.invoke('queue:retryTask', backend, taskId),

  resumeInterruptedTasks: (): Promise<number> =>
    ipcRenderer.invoke('queue:resumeInterrupted'),

  reorderTasks: (backend: BackendId, taskIds: string[]): Promise<void> =>
    ipcRenderer.invoke('queue:reorderTasks', backend, taskIds),

  createSession: (): Promise<void> =>
    ipcRenderer.invoke('session:create'),

  listSessions: (): Promise<SessionSummary[]> =>
    ipcRenderer.invoke('session:list'),

  resumeSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('session:resume', sessionId),

  deleteSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('session:delete', sessionId),

  openSessionFolder: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('session:openFolder', sessionId),

  getSessionDraft: (): Promise<SessionDraft> =>
    ipcRenderer.invoke('session:getDraft'),

  saveSessionDraft: (draft: SessionDraft): Promise<void> =>
    ipcRenderer.invoke('session:saveDraft', draft),

  getSessionElaboratedPrompts: (): Promise<string[]> =>
    ipcRenderer.invoke('session:getElaboratedPrompts'),

  appendSessionElaboratedPrompts: (prompts: string[]): Promise<string[]> =>
    ipcRenderer.invoke('session:appendElaboratedPrompts', prompts),

  deleteSessionElaboratedPromptAt: (index: number): Promise<string[]> =>
    ipcRenderer.invoke('session:deleteElaboratedPromptAt', index),

  clearSessionElaboratedPrompts: (): Promise<string[]> =>
    ipcRenderer.invoke('session:clearElaboratedPrompts'),

  // Elaborators
  listElaborators: (): Promise<Elaborator[]> =>
    ipcRenderer.invoke('elaborators:list'),

  createElaborator: (input: { kind: ElaboratorKind; name: string; description?: string; template: string }): Promise<Elaborator> =>
    ipcRenderer.invoke('elaborators:create', input),

  updateElaborator: (id: string, patch: { name?: string; description?: string; template?: string }): Promise<Elaborator | null> =>
    ipcRenderer.invoke('elaborators:update', id, patch),

  deleteElaborator: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('elaborators:delete', id),

  resetElaborators: (kind?: ElaboratorKind): Promise<Elaborator[]> =>
    ipcRenderer.invoke('elaborators:reset', kind),

  brainstormPrompts: (req: {
    requestId: string
    contentElaboratorId: string
    compositionElaboratorId: string
    styleElaboratorId: string
    seed: string
    count: number
    previousPrompts: string[]
    format: PromptFormat
    length: PromptLength
  }): Promise<{ prompts: string[] }> =>
    ipcRenderer.invoke('elaborators:brainstorm', req),

  cancelBrainstorm: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('elaborators:brainstormCancel', requestId),

  brainstormGetDefaults: (): Promise<{
    batch_size: number
    max_retries_per_turn: number
    retry_backoff_ms: number[]
    templates: {
      first_no_previous: string
      first_with_previous: string
      continuation: string
    }
    format_directives: {
      formats: { sentences: string; phrases: string }
      lengths: { short: string; medium: string; long: string }
    }
  }> =>
    ipcRenderer.invoke('brainstorm:getDefaults'),

  promptsGetDefaultSlug: (): Promise<string> =>
    ipcRenderer.invoke('prompts:getDefaultSlug'),

  appLog: (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('app:log', level, message, data),

  onBrainstormProgress: (
    requestId: string,
    callback: (event: { done: number; total: number }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { requestId: string; done: number; total: number }
    ): void => {
      if (payload.requestId !== requestId) return
      callback({ done: payload.done, total: payload.total })
    }
    ipcRenderer.on('brainstorm:progress', handler)
    return () => { ipcRenderer.removeListener('brainstorm:progress', handler) }
  },

  // Preview operations
  getImage: (baseName: string): Promise<{ data: string; ext: 'png' | 'jpg' | 'webp' } | null> =>
    ipcRenderer.invoke('preview:getImage', baseName),

  getSessionImage: (sessionId: string, baseName: string): Promise<{ data: string; ext: 'png' | 'jpg' | 'webp' } | null> =>
    ipcRenderer.invoke('preview:getSessionImage', sessionId, baseName),

  getMetadata: (baseName: string): Promise<Record<string, unknown> | null> =>
    ipcRenderer.invoke('preview:getMetadata', baseName),

  // Settings operations
  getSettings: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('settings:get'),

  saveChangedSettings: (
    base: Record<string, unknown>,
    next: Record<string, unknown>
  ): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:saveChangedFields', base, next),

  saveBrainstormSettings: (brainstorm: Record<string, unknown>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:saveBrainstorm', brainstorm),

  saveImageBackendDefaults: (
    backend: CloudBackendId,
    model: string,
    params: Record<string, unknown>
  ): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:saveImageBackendDefaults', backend, model, params),

  saveNotificationField: (field: string, value: unknown): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:saveNotificationField', field, value),

  checkLocalModel: (filename: string): Promise<boolean> =>
    ipcRenderer.invoke('settings:checkLocalModel', filename),

  // Draw Things CLI operations (macOS only)
  localCheckCli: (): Promise<CliStatus> =>
    ipcRenderer.invoke('local:checkCli'),

  localListDownloadedModels: (): Promise<LocalModelInfo[]> =>
    ipcRenderer.invoke('local:listDownloadedModels'),

  localListAvailableModels: (): Promise<LocalModelInfo[]> =>
    ipcRenderer.invoke('local:listAvailableModels'),

  localReadCustomJsonImportedFiles: (): Promise<CustomJsonStatus> =>
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

  dtGetModelParams: (modelFile: string): Promise<DrawThingsModelParams | null> =>
    ipcRenderer.invoke('drawthings:getModelParams', modelFile),

  dtGetAllModelParams: (): Promise<Record<string, DrawThingsModelParams>> =>
    ipcRenderer.invoke('drawthings:getAllModelParams'),

  dtSaveModelParams: (modelFile: string, params: DrawThingsModelParams): Promise<void> =>
    ipcRenderer.invoke('drawthings:setModelParams', modelFile, params),

  dtApplyParamsToAllModels: (
    modelFiles: string[],
    patch: Pick<DrawThingsModelParams, 'width' | 'height' | 'steps' | 'guidance'>
  ): Promise<void> =>
    ipcRenderer.invoke('drawthings:applyParamsToAll', modelFiles, patch),

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

  readClipboardText: (): Promise<string> =>
    ipcRenderer.invoke('clipboard:readText'),

  hasClipboardText: (): Promise<boolean> =>
    ipcRenderer.invoke('clipboard:hasText'),

  copyImageToClipboard: (baseName: string, ext: string): Promise<void> =>
    ipcRenderer.invoke('clipboard:copyImage', baseName, ext),

  openDirectoryDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),

  openViewer: (dataUrl: string): Promise<void> =>
    ipcRenderer.invoke('viewer:open', dataUrl),

  closeViewer: (): Promise<void> =>
    ipcRenderer.invoke('viewer:close'),

  viewerNavigate: (dir: 'up' | 'down' | 'left' | 'right'): Promise<void> =>
    ipcRenderer.invoke('viewer:navigate', dir),

  viewerAction: (action: 'remove' | 'delete'): Promise<void> =>
    ipcRenderer.invoke('viewer:action', action),

  onViewerNavigate: (callback: (dir: 'up' | 'down' | 'left' | 'right') => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, dir: 'up' | 'down' | 'left' | 'right'): void => {
      callback(dir)
    }
    ipcRenderer.on('viewer:navigate', handler)
    return () => { ipcRenderer.removeListener('viewer:navigate', handler) }
  },

  onViewerAction: (callback: (action: 'remove' | 'delete') => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: 'remove' | 'delete'): void => {
      callback(action)
    }
    ipcRenderer.on('viewer:action', handler)
    return () => { ipcRenderer.removeListener('viewer:action', handler) }
  },

  onViewerStateChanged: (callback: (open: boolean) => void): (() => void) => {
    const opened = (): void => callback(true)
    const closed = (): void => callback(false)
    ipcRenderer.on('viewer:opened', opened)
    ipcRenderer.on('viewer:closed', closed)
    return () => {
      ipcRenderer.removeListener('viewer:opened', opened)
      ipcRenderer.removeListener('viewer:closed', closed)
    }
  },

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
  },

  // Fired when the active session changes (new session, resume into another).
  // Session-scoped renderer state (e.g. SessionDraftContext) re-hydrates here.
  onSessionChanged: (callback: (event: { sessionId: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string }): void => {
      callback(data)
    }
    ipcRenderer.on('session:changed', handler)
    return () => { ipcRenderer.removeListener('session:changed', handler) }
  },

  // Fired after resuming a session that still has unfinished (interrupted)
  // tasks, so the renderer can prompt the user to re-queue them all.
  onInterruptedTasksOnResume: (callback: (event: { count: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { count: number }): void => {
      callback(data)
    }
    ipcRenderer.on('session:interruptedTasks', handler)
    return () => { ipcRenderer.removeListener('session:interruptedTasks', handler) }
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
