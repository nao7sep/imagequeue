// Matches the config.json schema from the product spec.

import { TextAIBackendId } from '../../shared/types'
import type { PromptFormat, PromptLength } from '../../shared/session-draft'

export interface GeminiTextAIConfig {
  api_key: string
  timeout_ms: number
  light_model: string
  main_model: string
}

export interface OpenAITextAIConfig {
  // Empty string means the official OpenAI endpoint (https://api.openai.com/v1).
  endpoint: string
  api_key: string
  timeout_ms: number
  light_model: string
  main_model: string
}

export interface TextAIConfig {
  backend: TextAIBackendId
  gemini: GeminiTextAIConfig
  openai: OpenAITextAIConfig
}

export interface OpenAIBackendConfig {
  api_key: string
  model: string
  default_params: {
    width: number
    height: number
    moderation: 'low' | 'auto'
    quality: 'low' | 'medium' | 'high' | 'auto'
    outputFormat: 'png' | 'jpeg' | 'webp'
    background: 'opaque' | 'transparent' | 'auto'
  }
  concurrency: number
  timeout_ms: number
}

export interface ImagenBackendConfig {
  api_key: string
  model: string
  default_params: {
    aspectRatio: string
    imageSize: string
    personGeneration: string
    numberOfImages: number
  }
  concurrency: number
  timeout_ms: number
}

export interface FluxBackendConfig {
  api_key: string
  model: string
  default_params: {
    width: number
    height: number
    steps: number
    guidance: number
    seed: number | null
  }
  concurrency: number
  timeout_ms: number
}

export interface DrawThingsBackendConfig {
  cli_path: string
  default_params: {
    fallback_width: number
    fallback_height: number
    fallback_steps: number
    fallback_guidance: number
    fallback_negative_prompt: string
    seed: number | null
  }
  models_dir: string
  auto_update_recommendations: boolean
}

export interface NanoBananaBackendConfig {
  api_key: string
  model: string
  default_params: {
    aspectRatio: string
    imageSize: string
  }
  concurrency: number
  timeout_ms: number
}

export interface GrokBackendConfig {
  api_key: string
  model: string
  default_params: {
    aspectRatio: string
    resolution: string
  }
  concurrency: number
  timeout_ms: number
}

export interface ImageBackendsConfig {
  openai: OpenAIBackendConfig
  imagen: ImagenBackendConfig
  nanobanana: NanoBananaBackendConfig
  grok: GrokBackendConfig
  flux: FluxBackendConfig
  drawthings: DrawThingsBackendConfig
}

export interface PromptsConfig {
  slug: string
}

export interface BrainstormTemplates {
  // Sent on the first turn when the renderer's session has no prior prompts.
  // Placeholders: {{ELABORATOR}}, {{SEED}}, {{N}}.
  first_no_previous: string
  // Sent on the first turn when there ARE prior prompts to avoid.
  // Placeholders: {{ELABORATOR}}, {{SEED}}, {{PREVIOUS}}, {{N}}.
  first_with_previous: string
  // Sent on turns 2+ within the same conversation. Placeholder: {{N}}.
  continuation: string
}

// The pieces that compose the {{FORMAT}} directive: one sentence per format and
// one per length. At call time the chosen format part and length part are joined
// with a single space. Split this way (2 + 3 instead of 6 full strings) so the
// shared wording isn't duplicated. Held in config so both are editable from
// Elaboration Settings.
export interface FormatDirectives {
  formats: Record<PromptFormat, string>
  lengths: Record<PromptLength, string>
}

export interface BrainstormConfig {
  batch_size: number
  max_retries_per_turn: number
  retry_backoff_ms: number[]
  templates: BrainstormTemplates
  format_directives: FormatDirectives
}

export interface GeneralConfig {
  auto_preview_idle_seconds: number
  export_dir: string
  confirm_remove: boolean
  confirm_delete: boolean
  delete_to_trash: boolean
  drop_empty_sessions: boolean
}

export interface NotificationsConfig {
  notifications_enabled: boolean
  sounds_enabled: boolean
  volume: number
  success_file: string
  failure_file: string
}

export interface AppConfig {
  text_ai: TextAIConfig
  general: GeneralConfig
  notifications: NotificationsConfig
  image_backends: ImageBackendsConfig
  prompts: PromptsConfig
  brainstorm: BrainstormConfig
}
