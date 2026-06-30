// Shared types between main and renderer processes.

import type { SessionDraft } from './session-draft'

export type BackendId = 'openai' | 'imagen' | 'nanobanana' | 'grok' | 'flux' | 'drawthings'
export type CloudBackendId = Exclude<BackendId, 'drawthings'>

export const BACKEND_IDS_IN_UI_ORDER: BackendId[] = [
  'openai',
  'imagen',
  'nanobanana',
  'grok',
  'flux',
  'drawthings'
]

export const CLOUD_BACKEND_IDS_IN_UI_ORDER = BACKEND_IDS_IN_UI_ORDER.filter(
  (backend): backend is CloudBackendId => backend !== 'drawthings'
)

export const BACKEND_LABELS: Record<BackendId, string> = {
  openai: 'GPT Image',
  imagen: 'Google Imagen',
  nanobanana: 'Nano Banana',
  grok: 'Grok Imagine',
  flux: 'FLUX',
  drawthings: 'Draw Things'
}

export interface CliStatus {
  installed: boolean
  version: string | null
  path: string | null
  platform: 'darwin' | 'unsupported'
}

// The two managed runtime dependencies the app delivers and tracks for the
// Draw Things backend: the CLI binary it downloads itself, and the recommended-
// parameters file (configs.json). Both follow the managed-runtime-dependencies
// convention — app-owned acquisition, verify-once-at-download, check-not-apply.
export type DependencyId = 'cli' | 'recommendations'

// The four lifecycle states a managed dependency can be in. "installed-unchecked"
// is present-but-never-successfully-compared-to-latest (offline, or the launch
// check is disabled and none has been run) — distinct from a confirmed up-to-date.
export type DependencyState =
  | 'not-installed'
  | 'up-to-date'
  | 'update-available'
  | 'installed-unchecked'

// One dependency's surface state for the modal and the pane pointer. The labels
// are presentation-ready strings derived in main: for the CLI they are release
// tags; for configs.json the installed label summarizes the file (entry count +
// date) and there is no latest label (it is versionless — "update available"
// means a fetched copy differed byte-for-byte).
export interface DependencyInfo {
  id: DependencyId
  state: DependencyState
  installedLabel: string | null
  latestLabel: string | null
  // When the installed artifact was last written (configs.json's mtime); null for
  // the CLI, whose identity is its tag. ISO-8601 UTC; the renderer formats it.
  updatedAtUtc: string | null
  lastCheckedAtUtc: string | null
}

export interface DependenciesState {
  cli: DependencyInfo
  recommendations: DependencyInfo
  // The single launch-time check toggle gating both dependencies (default on).
  checkUpdatesAtLaunch: boolean
  // False off macOS, where the Draw Things backend (and so these dependencies)
  // does not exist; the renderer hides the whole surface.
  platformSupported: boolean
}

// Progress for the CLI binary download (the only long-running dependency op).
// Streamed over 'dependencies:progress' while installCli/updateCli runs.
export interface DependencyProgress {
  phase: 'downloading' | 'verifying' | 'installing'
  downloadedBytes: number
  totalBytes: number | null
}

export interface LocalModelInfo {
  file: string
  name: string
  source: string
  downloaded: boolean
  huggingFace: string | null
}

// Result of attempting to read the Draw Things `custom.json` file in the
// effective models directory. The three states are distinguished so the
// renderer can pick the right fallback: when the file is genuinely absent
// (a fresh install with no imports yet) we trust the CLI's source column;
// when it exists but can't be parsed we trust the CLI for usability but
// surface a warning, since imports there may be misclassified as official.
export type CustomJsonStatus =
  | { kind: 'present'; files: string[] }
  | { kind: 'absent' }
  | { kind: 'unreadable'; reason: string }

export interface RecommendationStatus {
  path: string
  directory: string
  exists: boolean
  valid: boolean
  entryCount: number
  fileSize: number | null
  updatedAt: string | null
  error: string | null
}

export interface RecommendationOperationResult extends RecommendationStatus {
  changed: boolean
  message: string
}

export interface RecommendedParams {
  width: number | null
  height: number | null
  steps: number | null
  guidance: number | null
  negativePrompt: string | null
  matchName: string
  matchModel: string | null
  matchType: 'exact' | 'prefix' | 'prefix-parent' | 'version'
}

export interface DrawThingsModelParams {
  width: number
  height: number
  steps: number
  guidance: number
  seed: string
  negativePrompt: string
}

export type TextAIBackendId = 'gemini' | 'openai'
export type TaskStatus = 'queued' | 'generating' | 'completed' | 'kept' | 'failed' | 'interrupted'
export type ElaboratorKind = 'content' | 'composition' | 'style'

export const ELABORATOR_KIND_LABELS: Record<ElaboratorKind, string> = {
  content: 'Content',
  composition: 'Composition',
  style: 'Style',
}

export interface Elaborator {
  id: string
  kind: ElaboratorKind
  name: string
  description?: string
  template: string
}

export interface Task {
  id: string
  prompt: string
  backend: BackendId
  model: string
  params: Record<string, unknown>
  status: TaskStatus
  estimatedCostUsd: number | null
  enqueuedAt: string
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  imagePath: string | null
  baseName: string | null
  error: string | null
}

export interface EnqueueRequest {
  prompt: string
  backend: BackendId
  model: string
  params: Record<string, unknown>
  count: number
}

export interface EnqueueBatchUnit {
  prompt: string
  backend: BackendId
  model: string
  params: Record<string, unknown>
}

export interface ColumnSettings {
  model: string
  params: Record<string, unknown>
  imageCount: number
}

export const SESSION_MANIFEST_VERSION = 1

export interface SessionTaskCounts {
  total: number
  queued: number
  generating: number
  completed: number
  kept: number
  failed: number
  interrupted: number
}

export interface SessionManifest {
  version: typeof SESSION_MANIFEST_VERSION
  sessionId: string
  createdAt: string
  updatedAt: string
  lastResumedAt: string | null
  taskCounts: SessionTaskCounts
  elaboratedPrompts: string[]
  // The renderer's working state for this session (prompt + Advanced Prompting
  // selections). Optional on disk: manifests written before this field existed,
  // or with a malformed draft, load fine and are backfilled with an empty draft
  // on read (see normalizeSessionDraft).
  draft: SessionDraft
  tasks: Record<BackendId, Task[]>
}

export interface SessionThumbnail {
  baseName: string
}

export interface SessionSummary {
  sessionId: string
  createdAt: string
  updatedAt: string
  lastResumedAt: string | null
  taskCounts: SessionTaskCounts
  completedCount: number
  retryCount: number
  keptCount: number
  thumbnails: SessionThumbnail[]
  isCurrent: boolean
}
