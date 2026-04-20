// Sidecar JSON metadata written alongside each generated image.

export interface ImageMetadata {
  prompt: string
  backend: 'openai' | 'google' | 'flux' | 'local' | 'nanobanana'
  model: string
  params: Record<string, unknown>
  slug: string
  status: 'completed'
  enqueued_at: string
  started_at: string
  completed_at: string
  file_timestamp: string
  duration_ms: number
  estimated_cost_usd: number | null
  seed: number | null
  error: null
}
