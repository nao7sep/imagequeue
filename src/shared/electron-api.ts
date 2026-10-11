import type { AppReleaseResult } from './app-release'
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
  CliInstallResult,
  TaskDeletionResult,
  DependencyProgress,
  DrawThingsModelParams,
  SessionListEntry,
  ApiKeyPresence,
  SecretId,
  QueueControlState,
  ConceptFacetSummary,
  ConceptProbeSummary,
  ConceptRow,
} from './types'
import type { SessionDraft, PromptFormat, PromptLength, FormatDirectives } from './session-draft'
import type { UiState } from './ui-state'
import type { BrainstormOutcome } from './text-provider-failure'
import type { CliJobSnapshot, CliChunkEvent, CliStatusEvent } from './cli-jobs'
import type { AppNotice } from './app-notice'
import type { StartupFailureMeasurement } from './startup-failure'
import type { Message } from './i18n/translate'
import type { LanguageEnvironment } from './i18n/languages'
import type { RecordDetail, RecordKind, RecordSources, RecordsPage, RecordsQuery } from './records'
import type { ConfirmOptions } from './confirm'
import type { ListKey, SelectedImage, SelectionSnapshot, SurfaceConfirmRequest, ViewingSurface } from './viewing'

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

// The renderer words each failed state itself, in the interface language.
export type DrawThingsParamsPersistenceState =
  | { status: 'saved' }
  | { status: 'failed' }

// The contextBridge API surface exposed to the renderer as `window.electronAPI`.
// It is an explicit interface in `shared` — not `typeof api` from the preload —
// so the renderer can reference the type without importing the preload module,
// whose `electron` import would otherwise drag @types/node into the renderer
// program and defeat its Node isolation. The preload implements this interface
// via `satisfies ElectronAPI`, so the two can never drift.
export interface ElectronAPI {
  appReleaseReady: () => Promise<void>
  checkAppRelease: () => Promise<AppReleaseResult | undefined>
  viewAppRelease: () => Promise<void>
  onAppReleaseResult: (callback: (result: AppReleaseResult) => void) => (() => void)
  chooseQuit(choice: 'retry' | 'quit' | 'cancel'): void
  reportQuitHeight(height: number): void
  platform: Platform
  // The interface language main settled on, and each saved change to it.
  getLanguageEnvironment: () => Promise<LanguageEnvironment>
  onLanguageChanged: (callback: (environment: LanguageEnvironment) => void) => (() => void)
  onAppNotice: (callback: (notice: AppNotice) => void) => (() => void)
  // Notices main raised before this window subscribed; each is handed out once.
  takePendingNotices: () => Promise<AppNotice[]>
  reportStartupFailureMeasurement: (measurement: StartupFailureMeasurement) => void
  // What the startup failure window says about the failure that stopped startup.
  getStartupFailureMessage: () => Promise<Message>

  // Queue operations
  enqueue: (request: EnqueueRequest) => Promise<Task[]>
  enqueueBatch: (units: EnqueueBatchUnit[]) => Promise<Task[]>
  getAllStoredTasks: () => Promise<Record<BackendId, Task[]>>
  removeTask: (backend: BackendId, taskId: string) => Promise<void>
  restoreTask: (backend: BackendId, taskId: string) => Promise<void>
  deleteWithFiles: (backend: BackendId, taskId: string) => Promise<TaskDeletionResult | void>
  retryTask: (backend: BackendId, taskId: string) => Promise<void>
  resumeInterruptedTasks: () => Promise<number>
  // Queue control (the queue mini-menu)
  setQueuePaused: (paused: boolean) => Promise<void>
  stopAllQueueWork: () => Promise<{ cancelled: number; queued: number }>
  clearPendingTasks: () => Promise<number>
  getQueueControlState: () => Promise<QueueControlState>
  onQueueControlState: (callback: (state: QueueControlState) => void) => (() => void)

  createSession: () => Promise<void>
  listSessions: () => Promise<SessionListEntry[]>
  resumeSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  openSessionFolder: (sessionId: string) => Promise<void>
  getSessionDraft: () => Promise<SessionDraft>
  saveSessionDraft: (draft: SessionDraft) => Promise<void>
  getSessionElaboratedPrompts: () => Promise<ElaboratedPromptRecord[]>
  appendSessionElaboratedPrompts: (prompts: ElaboratedPromptRecord[]) => Promise<ElaboratedPromptRecord[]>
  deleteSessionElaboratedPromptAt: (index: number) => Promise<ElaboratedPromptRecord[]>
  clearSessionElaboratedPrompts: () => Promise<ElaboratedPromptRecord[]>

  // Elaborators
  listElaborators: () => Promise<Elaborator[]>
  createElaborator: (input: { id?: string; kind: ElaboratorKind; name: string; description?: string; template: string }) => Promise<Elaborator>
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
  }) => Promise<BrainstormOutcome>
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

  // Settings operations
  getSettings: () => Promise<Record<string, unknown>>
  saveChangedSettings: (base: Record<string, unknown>, next: Record<string, unknown>, keys?: Partial<Record<SecretId, string>>) => Promise<{ success: boolean }>
  saveBrainstormSettings: (brainstorm: Record<string, unknown>) => Promise<{ success: boolean }>
  getApiKeyPresence: () => Promise<ApiKeyPresence>
  // Stored values are read separately and submitted as a separate changed-key
  // map with the form; config.json never receives keys.
  getApiKeys: () => Promise<Record<SecretId, string>>
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
  installCli: () => Promise<CliInstallResult>
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
  openSessionsFolder: () => Promise<void>
  revealFile: (baseName: string, ext: string) => Promise<void>
  exportImage: (baseName: string, ext: string) => Promise<string>
  exportImageAs: (baseName: string, ext: string) => Promise<string | null>
  readClipboardText: () => Promise<string>
  hasClipboardText: () => Promise<boolean>
  copyImageToClipboard: (baseName: string, ext: string) => Promise<void>
  openDirectoryDialog: () => Promise<string | null>
  // The main process changed a setting on its own (closing the preview window).
  onSettingsChanged: (callback: () => void) => (() => void)
  // The views of the selected image (shared/viewing). The main window publishes
  // the selection; the preview window and the fullscreen view follow it and hand
  // list keys and confirmations back and forth through the main process.
  publishSelection: (task: SelectedImage | null) => Promise<void>
  getLatestSelection: () => Promise<SelectionSnapshot>
  onSelectionSnapshot: (callback: (snapshot: SelectionSnapshot) => void) => (() => void)
  openFullscreenView: () => Promise<void>
  closeFullscreenView: () => Promise<void>
  reportFullscreenViewPainted: (version: number, painted: boolean) => Promise<void>
  onFullscreenViewStateChanged: (callback: (open: boolean) => void) => (() => void)
  sendListKey: (key: ListKey) => Promise<void>
  onListKey: (callback: (event: { key: ListKey; surface: ViewingSurface }) => void) => (() => void)
  // Null when the view is gone; the caller then asks in its own window.
  confirmInSurface: (surface: ViewingSurface, options: ConfirmOptions) => Promise<boolean | null>
  answerSurfaceConfirm: (id: number, ok: boolean) => Promise<void>
  onSurfaceConfirm: (callback: (request: SurfaceConfirmRequest) => void) => (() => void)
  onSurfaceConfirmDismissed: (callback: (id: number) => void) => (() => void)
  showNotification: (type: 'success' | 'failure') => Promise<void>
  loadAudioFile: (filePath: string) => Promise<string | null>

  onQueueUpdated: (callback: (tasks: Record<BackendId, Task[]>) => void) => (() => void)
  onSessionChanged: (callback: (event: { sessionId: string }) => void) => (() => void)
  onInterruptedTasksOnResume: (callback: (event: { count: number }) => void) => (() => void)

  // The Records window: opened from the main menu, it reads records.sqlite3.
  openRecordsWindow: () => Promise<void>
  readRecordsPage: (query: RecordsQuery) => Promise<RecordsPage>
  readRecordDetail: (kind: RecordKind, id: number) => Promise<RecordDetail | null>
  readRecordSources: () => Promise<RecordSources>
  // A record was stored in the records database.
  onRecordsChanged: (callback: () => void) => (() => void)
}
