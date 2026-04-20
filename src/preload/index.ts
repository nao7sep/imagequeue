import { contextBridge, ipcRenderer } from 'electron'
import { BackendId, EnqueueRequest, Task } from '../shared/types'

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

  getPromptHistory: (): Promise<string[]> =>
    ipcRenderer.invoke('queue:getPromptHistory'),

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

  saveUi: (ui: { leftPaneWidth: number }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:saveUi', ui),

  listLocalModels: (): Promise<string[]> =>
    ipcRenderer.invoke('settings:listLocalModels'),

  openModelsDir: (): Promise<void> =>
    ipcRenderer.invoke('settings:openModelsDir'),

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

