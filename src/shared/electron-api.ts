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
  DependenciesState,
  DependencyProgress,
  DrawThingsModelParams,
  SessionSummary,
} from './types'
import type { SessionDraft, PromptFormat, PromptLength, FormatDirectives } from './session-draft'
import type { UiState } from './ui-state'
import type { CliJobSnapshot, CliChunkEvent, CliStatusEvent } from './cli-jobs'

// The Node platform string (member set of NodeJS.Platform), spelled out as a
// portable union so this shared contract carries no @types/node dependency — it
// is imported by the renderer, which is typechecked without Node types.
export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

export interface EnsureModelResult {
  success: boolean
  error?: string
}

// The contextBridge API surface exposed to the renderer as `window.electronAPI`.
// It is an explicit interface in `shared` — not `typeof api` from the preload —
// so the renderer can reference the type without importing the preload module,
// whose `electron` import would otherwise drag @types/node into the renderer
// program and defeat its Node isolation. The preload implements this interface
// via `satisfies ElectronAPI`, so the two can never drift.
export interface ElectronAPI {
  platform: Platform

  // Queue operations
  enqueue: (request: EnqueueRequest) => Promise<Task[]>
  enqueueBatch: (units: EnqueueBatchUnit[]) => Promise<Task[]>
  getTasks: (backend: BackendId) => Promise<Task[]>
  getAllTasks: () => Promise<Record<BackendId, Task[]>>
  getAllStoredTasks: () => Promise<Record<BackendId, Task[]>>
  removeTask: (backend: BackendId, taskId: string) => Promise<void>
  restoreTask: (backend: BackendId, taskId: string) => Promise<void>
  deleteWithFiles: (backend: BackendId, taskId: string) => Promise<void>
  retryTask: (backend: BackendId, taskId: string) => Promise<void>
  resumeInterruptedTasks: () => Promise<number>
  reorderTasks: (backend: BackendId, taskIds: string[]) => Promise<void>

  createSession: () => Promise<void>
  listSessions: () => Promise<SessionSummary[]>
  resumeSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  openSessionFolder: (sessionId: string) => Promise<void>
  getSessionDraft: () => Promise<SessionDraft>
  saveSessionDraft: (draft: SessionDraft) => Promise<void>
  getSessionElaboratedPrompts: () => Promise<string[]>
  appendSessionElaboratedPrompts: (prompts: string[]) => Promise<string[]>
  deleteSessionElaboratedPromptAt: (index: number) => Promise<string[]>
  clearSessionElaboratedPrompts: () => Promise<string[]>

  // Elaborators
  listElaborators: () => Promise<Elaborator[]>
  createElaborator: (input: { kind: ElaboratorKind; name: string; description?: string; template: string }) => Promise<Elaborator>
  updateElaborator: (id: string, patch: { name?: string; description?: string; template?: string }) => Promise<Elaborator | null>
  deleteElaborator: (id: string) => Promise<boolean>
  resetElaborators: (kind?: ElaboratorKind) => Promise<Elaborator[]>
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
  }) => Promise<{ prompts: string[] }>
  cancelBrainstorm: (requestId: string) => Promise<void>
  brainstormGetDefaults: () => Promise<{
    batch_size: number
    max_retries_per_turn: number
    retry_backoff_ms: number[]
    templates: {
      first_no_previous: string
      first_with_previous: string
      continuation: string
    }
    format_directives: FormatDirectives
  }>
  promptsGetDefaultSlug: () => Promise<string>
  appLog: (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>) => Promise<void>
  onBrainstormProgress: (
    requestId: string,
    callback: (event: { done: number; total: number }) => void
  ) => (() => void)

  // Preview operations
  getImage: (baseName: string) => Promise<{ data: string; ext: 'png' | 'jpg' | 'webp' } | null>
  getSessionImage: (sessionId: string, baseName: string) => Promise<{ data: string; ext: 'png' | 'jpg' | 'webp' } | null>
  getMetadata: (baseName: string) => Promise<Record<string, unknown> | null>

  // Settings operations
  getSettings: () => Promise<Record<string, unknown>>
  saveChangedSettings: (base: Record<string, unknown>, next: Record<string, unknown>) => Promise<{ success: boolean }>
  saveBrainstormSettings: (brainstorm: Record<string, unknown>) => Promise<{ success: boolean }>
  saveImageBackendDefaults: (backend: CloudBackendId, model: string, params: Record<string, unknown>) => Promise<{ success: boolean }>
  saveNotificationField: (field: string, value: unknown) => Promise<{ success: boolean }>
  checkLocalModel: (filename: string) => Promise<boolean>

  // Draw Things CLI operations (macOS only)
  localCheckCli: () => Promise<CliStatus>
  localListDownloadedModels: () => Promise<LocalModelInfo[]>
  localListAvailableModels: () => Promise<LocalModelInfo[]>
  localReadCustomJsonImportedFiles: () => Promise<CustomJsonStatus>
  localEnsureModel: (modelFile: string) => Promise<EnsureModelResult>
  localGetModelsDir: () => Promise<string>
  localGetDefaultModelsDir: () => Promise<string>
  localOpenModelsDir: () => Promise<void>
  cliStartImport: (artifactPath: string) => Promise<string>
  cliStartDownload: (modelFile: string) => Promise<string>
  cliSubscribeJob: (jobId: string) => Promise<CliJobSnapshot | null>
  cliUnsubscribeJob: (jobId: string) => Promise<void>
  cliKillJob: (jobId: string) => Promise<void>
  cliGetJobSnapshot: (jobId: string) => Promise<CliJobSnapshot | null>
  onCliJobChunk: (callback: (e: CliChunkEvent) => void) => (() => void)
  onCliJobStatus: (callback: (e: CliStatusEvent) => void) => (() => void)

  // Ephemeral UI state (state.json): persisted view adjustments — currently the
  // per-provider column width. Hydrated once on mount, written back on a drag.
  getUiState: () => Promise<UiState>
  updateUiState: (patch: Partial<UiState>) => Promise<UiState>

  // Managed dependencies surface (the modal + pane pointer). Every mutating call
  // returns the full DependenciesState so the renderer re-renders from one snapshot.
  getDependenciesState: () => Promise<DependenciesState>
  checkDependencies: () => Promise<DependenciesState>
  installCli: () => Promise<DependenciesState>
  downloadRecommendations: () => Promise<DependenciesState>
  applyRecommendationsUpdate: () => Promise<DependenciesState>
  setCheckUpdatesAtLaunch: (value: boolean) => Promise<DependenciesState>
  onDependencyProgress: (callback: (progress: DependencyProgress) => void) => (() => void)

  resolveRecommendation: (modelFile: string) => Promise<RecommendedParams | null>
  dtGetModelParams: (modelFile: string) => Promise<DrawThingsModelParams | null>
  dtGetAllModelParams: () => Promise<Record<string, DrawThingsModelParams>>
  dtSaveModelParams: (modelFile: string, params: DrawThingsModelParams) => Promise<void>
  dtApplyParamsToAllModels: (
    modelFiles: string[],
    patch: Pick<DrawThingsModelParams, 'width' | 'height' | 'steps' | 'guidance'>
  ) => Promise<void>

  openFileDialog: (filters: { name: string; extensions: string[] }[]) => Promise<string | null>
  openExternal: (url: string) => Promise<void>
  openOutputFolder: () => Promise<void>
  revealFile: (baseName: string, ext: string) => Promise<void>
  exportImage: (baseName: string, ext: string) => Promise<string>
  exportImageAs: (baseName: string, ext: string) => Promise<string | null>
  readClipboardText: () => Promise<string>
  hasClipboardText: () => Promise<boolean>
  copyImageToClipboard: (baseName: string, ext: string) => Promise<void>
  openDirectoryDialog: () => Promise<string | null>
  openViewer: (dataUrl: string) => Promise<void>
  closeViewer: () => Promise<void>
  viewerNavigate: (dir: 'up' | 'down' | 'left' | 'right') => Promise<void>
  viewerAction: (action: 'remove' | 'delete') => Promise<void>
  onViewerNavigate: (callback: (dir: 'up' | 'down' | 'left' | 'right') => void) => (() => void)
  onViewerAction: (callback: (action: 'remove' | 'delete') => void) => (() => void)
  onViewerStateChanged: (callback: (open: boolean) => void) => (() => void)
  showNotification: (type: 'success' | 'failure') => Promise<void>
  loadAudioFile: (filePath: string) => Promise<string | null>

  onQueueUpdated: (callback: (tasks: Record<BackendId, Task[]>) => void) => (() => void)
  onSessionChanged: (callback: (event: { sessionId: string }) => void) => (() => void)
  onInterruptedTasksOnResume: (callback: (event: { count: number }) => void) => (() => void)
}
