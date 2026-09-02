import {
  ElaboratedPromptRecord,
  BackendId,
  BrainstormPhase,
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
  ApiKeyPresence,
  SecretId,
  QueueControlState,
  ConceptFacetSummary,
  ConceptProbeSummary,
  ConceptRow,
} from './types'
import type { SessionDraft, PromptFormat, PromptLength, FormatDirectives } from './session-draft'
import type { UiState } from './ui-state'
import type { CliJobSnapshot, CliChunkEvent, CliStatusEvent } from './cli-jobs'
import type { AppNotice } from './app-notice'

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

export type SessionDraftPersistenceState =
  | { status: 'saved' }
  | { status: 'failed'; message: string }

export const SESSION_DRAFT_PERSISTENCE_ERROR =
  'Recent session changes could not be saved. Keep ImageQueue open and make another edit to retry.'

export type DrawThingsParamsPersistenceState =
  | { status: 'saved' }
  | { status: 'failed'; message: string }

export const DRAW_THINGS_PARAMS_PERSISTENCE_ERROR =
  'Draw Things parameters could not be saved. Correct the storage problem, then change a parameter to retry.'

// The contextBridge API surface exposed to the renderer as `window.electronAPI`.
// It is an explicit interface in `shared` — not `typeof api` from the preload —
// so the renderer can reference the type without importing the preload module,
// whose `electron` import would otherwise drag @types/node into the renderer
// program and defeat its Node isolation. The preload implements this interface
// via `satisfies ElectronAPI`, so the two can never drift.
export interface ElectronAPI {
  platform: Platform
  onAppNotice: (callback: (notice: AppNotice) => void) => (() => void)

  // Queue operations
  enqueue: (request: EnqueueRequest) => Promise<Task[]>
  enqueueBatch: (units: EnqueueBatchUnit[]) => Promise<Task[]>
  getAllStoredTasks: () => Promise<Record<BackendId, Task[]>>
  removeTask: (backend: BackendId, taskId: string) => Promise<void>
  restoreTask: (backend: BackendId, taskId: string) => Promise<void>
  deleteWithFiles: (backend: BackendId, taskId: string) => Promise<void>
  retryTask: (backend: BackendId, taskId: string) => Promise<void>
  resumeInterruptedTasks: () => Promise<number>
  // Queue control (the queue mini-menu)
  setQueuePaused: (paused: boolean) => Promise<void>
  stopAllQueueWork: () => Promise<{ cancelled: number; queued: number }>
  clearPendingTasks: () => Promise<number>
  getQueueControlState: () => Promise<QueueControlState>
  onQueueControlState: (callback: (state: QueueControlState) => void) => (() => void)

  createSession: () => Promise<void>
  listSessions: () => Promise<SessionSummary[]>
  resumeSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  openSessionFolder: (sessionId: string) => Promise<void>
  getSessionDraft: () => Promise<SessionDraft>
  saveSessionDraft: (draft: SessionDraft) => Promise<void>
  getSessionDraftPersistenceState: () => Promise<SessionDraftPersistenceState>
  onSessionDraftPersistenceState: (
    callback: (state: SessionDraftPersistenceState) => void
  ) => (() => void)
  getSessionElaboratedPrompts: () => Promise<ElaboratedPromptRecord[]>
  appendSessionElaboratedPrompts: (prompts: ElaboratedPromptRecord[]) => Promise<ElaboratedPromptRecord[]>
  deleteSessionElaboratedPromptAt: (index: number) => Promise<ElaboratedPromptRecord[]>
  clearSessionElaboratedPrompts: () => Promise<ElaboratedPromptRecord[]>

  // Elaborators
  listElaborators: () => Promise<Elaborator[]>
  createElaborator: (input: { kind: ElaboratorKind; name: string; description?: string; template: string }) => Promise<Elaborator>
  updateElaborator: (id: string, patch: { name?: string; description?: string; template?: string }) => Promise<Elaborator | null>
  deleteElaborator: (id: string) => Promise<boolean>
  resetElaborators: (kind?: ElaboratorKind) => Promise<Elaborator[]>
  brainstormPrompts: (req: {
    requestId: string
    compositionElaboratorId: string
    styleElaboratorId: string
    seed: string
    count: number
    format: PromptFormat
    length: PromptLength
  }) => Promise<{ prompts: ElaboratedPromptRecord[] }>
  cancelBrainstorm: (requestId: string) => Promise<void>
  brainstormGetDefaults: () => Promise<{
    batch_size: number
    concurrency: number
    max_retries_per_turn: number
    retry_backoff_ms: number[]
    prefer_new_concepts: boolean
    templates: {
      expansion: string
    }
    format_directives: FormatDirectives
  }>
  // Concept ledger (the Concept Library modal)
  listConceptFacets: () => Promise<ConceptFacetSummary[]>
  listConceptRows: (facetId: number) => Promise<ConceptRow[]>
  listConceptProbes: (facetId: number) => Promise<ConceptProbeSummary[]>
  deleteConceptProbe: (probeId: number) => Promise<void>
  deleteConceptRow: (conceptId: number) => Promise<void>
  deleteConceptFacet: (facetId: number) => Promise<void>
  promptsGetDefaultSlug: () => Promise<string>
  appLog: (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>) => Promise<void>
  onBrainstormProgress: (
    requestId: string,
    callback: (event: { done: number; total: number; phase: BrainstormPhase }) => void
  ) => (() => void)

  // Preview operations
  getImage: (baseName: string) => Promise<{ data: string; ext: 'png' | 'jpg' | 'webp' } | null>
  getSessionImage: (sessionId: string, baseName: string) => Promise<{ data: string; ext: 'png' | 'jpg' | 'webp' } | null>

  // Settings operations
  getSettings: () => Promise<Record<string, unknown>>
  saveChangedSettings: (base: Record<string, unknown>, next: Record<string, unknown>) => Promise<{ success: boolean }>
  saveBrainstormSettings: (brainstorm: Record<string, unknown>) => Promise<{ success: boolean }>
  getApiKeyPresence: () => Promise<ApiKeyPresence>
  // Stored key values, by key id — their own channels, never part of the config
  // payload. saveApiKeys takes only the ids the user actually changed.
  getApiKeys: () => Promise<Record<SecretId, string>>
  saveApiKeys: (changes: Partial<Record<SecretId, string>>) => Promise<{ success: boolean }>
  saveImageBackendDefaults: (backend: CloudBackendId, model: string, params: Record<string, unknown>) => Promise<{ success: boolean }>
  saveNotificationField: (field: string, value: unknown) => Promise<{ success: boolean }>

  // Draw Things CLI operations (macOS only)
  localCheckCli: () => Promise<CliStatus>
  localListDownloadedModels: () => Promise<LocalModelInfo[]>
  localListAvailableModels: () => Promise<LocalModelInfo[]>
  localReadCustomJsonImportedFiles: () => Promise<CustomJsonStatus>
  cliStartImport: (artifactPath: string) => Promise<string>
  cliStartDownload: (modelFile: string) => Promise<string>
  cliSubscribeJob: (jobId: string) => Promise<CliJobSnapshot | null>
  cliUnsubscribeJob: (jobId: string) => Promise<void>
  cliKillJob: (jobId: string) => Promise<void>
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
  setCheckUpdatesAtLaunch: (value: boolean) => Promise<DependenciesState>
  cancelDependencyOperations: () => Promise<void>
  onDependencyProgress: (callback: (progress: DependencyProgress) => void) => (() => void)

  resolveRecommendation: (modelFile: string) => Promise<RecommendedParams | null>
  dtGetModelParams: (modelFile: string) => Promise<DrawThingsModelParams | null>
  dtGetAllModelParams: () => Promise<Record<string, DrawThingsModelParams>>
  dtSaveModelParams: (modelFile: string, params: DrawThingsModelParams) => Promise<void>
  getDrawThingsParamsPersistenceState: () => Promise<DrawThingsParamsPersistenceState>
  onDrawThingsParamsPersistenceState: (
    callback: (state: DrawThingsParamsPersistenceState) => void
  ) => (() => void)
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
