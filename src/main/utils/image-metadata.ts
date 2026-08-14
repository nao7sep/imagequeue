// Sidecar JSON metadata written alongside each generated image.

import type { BackendId } from '../../shared/types'

export interface ImageMetadata {
  prompt: string
  backend: BackendId
  model: string
  params: Record<string, unknown>
  slug: string
  status: 'completed'
  enqueued_at: string
  started_at: string
  completed_at: string
  file_timestamp: string
  duration_ms: number
  seed: number | null
  error: null
}
