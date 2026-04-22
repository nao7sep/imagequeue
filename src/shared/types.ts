// Shared types between main and renderer processes.

export type BackendId = 'openai' | 'imagen' | 'nanobanana' | 'grok' | 'flux' | 'drawthings'

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

export type TextAIBackendId = 'gemini'
export type TaskStatus = 'queued' | 'generating' | 'completed' | 'failed'

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
  thumbnailPath: string | null
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

export interface ColumnSettings {
  model: string
  params: Record<string, unknown>
  imageCount: number
}
