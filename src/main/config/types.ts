// Matches the config.json schema from the product spec.

import { TextAIBackendId } from '../../shared/types'

export interface TextAIConfig {
  backend: TextAIBackendId
  api_key: string
  timeout_ms: number
  light_model: string
  main_model: string
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
  // Applied at queue time to combine an elaborated prompt with the user's
  // override. Placeholders: {{PROMPT}}, {{OVERRIDE}}.
  override_combine: string
}

export interface BrainstormConfig {
  batch_size: number
  max_retries_per_turn: number
  retry_backoff_ms: number[]
  templates: BrainstormTemplates
}

export interface GeneralConfig {
  auto_preview_idle_seconds: number
  export_dir: string
  confirm_remove: boolean
  confirm_delete: boolean
  delete_to_trash: boolean
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
