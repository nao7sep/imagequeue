// Matches the config.json schema from the product spec.

import { TextAIBackendId } from '../../shared/types'
import type { FormatDirectives } from '../../shared/session-draft'

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
  default_params: {
    fallback_width: number
    fallback_height: number
    fallback_steps: number
    fallback_guidance: number
    fallback_negative_prompt: string
    seed: number | null
  }
  // Where the app-owned CLI looks for models. Empty uses the app's private dir;
  // a Draw Things user can point it at the GUI app's models to reuse downloads.
  models_dir: string
  // The single launch-time check toggle for both managed dependencies (the CLI
  // binary and configs.json). On by default; nothing auto-downloads or installs.
  check_updates_at_launch: boolean
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
  // Placeholders: {{ELABORATOR}}, {{SEED}}, {{FORMAT}}, {{N}}, {{JSON}}.
  first_no_previous: string
  // Sent on the first turn when there ARE prior prompts to avoid.
  // Placeholders: {{ELABORATOR}}, {{SEED}}, {{PREVIOUS}}, {{FORMAT}}, {{N}}, {{JSON}}.
  first_with_previous: string
  // Sent on turns 2+ within the same conversation. Placeholders: {{FORMAT}}, {{N}}, {{JSON}}.
  continuation: string
}

export interface BrainstormConfig {
  batch_size: number
  max_retries_per_turn: number
  retry_backoff_ms: number[]
  templates: BrainstormTemplates
  format_directives: FormatDirectives
}

export interface GeneralConfig {
  // The app's UI (chrome) font family. Family only; blank means the built-in default stack (the
  // renderer's `--font-ui` variable). Applied app-wide via that variable.
  ui_font_family: string
  auto_preview_idle_seconds: number
  export_dir: string
  confirm_remove: boolean
  confirm_delete: boolean
  delete_to_trash: boolean
  drop_empty_sessions: boolean
  keep_awake_during_work: boolean
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
