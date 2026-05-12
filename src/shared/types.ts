// Shared types between main and renderer processes.

export type BackendId = 'openai' | 'imagen' | 'nanobanana' | 'grok' | 'flux' | 'drawthings'

export const BACKEND_IDS_IN_UI_ORDER: BackendId[] = [
  'openai',
  'imagen',
  'nanobanana',
  'grok',
  'flux',
  'drawthings'
]

export const CLOUD_BACKEND_IDS_IN_UI_ORDER = BACKEND_IDS_IN_UI_ORDER.filter(
  (backend): backend is Exclude<BackendId, 'drawthings'> => backend !== 'drawthings'
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

export interface LocalModelInfo {
  file: string
  name: string
  source: string
  downloaded: boolean
  huggingFace: string | null
}

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

export type TextAIBackendId = 'gemini'
export type TaskStatus = 'queued' | 'generating' | 'completed' | 'kept' | 'failed' | 'interrupted'

export interface Elaborator {
  id: string
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
