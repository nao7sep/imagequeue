// Matches the config.json schema from the product spec.

import { TextAIBackendId } from '../../shared/types'
import type { FormatDirectives } from '../../shared/session-draft'

export interface GeminiTextAIConfig {
  api_key: string
  timeout_ms: number
  // The two tier selections into the app-owned closed list (GEMINI_TEXT_MODELS in
  // shared/models). The list itself is not stored — it has one home — so the config
  // carries only the picks. main_model is the general/elaboration tier, light_model
  // the throwaway/slug tier; main leads because it is the more consequential choice.
  //
  // Both are `string`, not GeminiTextModel: a config from an older build (when the list
  // was editable) or a hand-edited file can name anything, and the store never judges a
  // selection (the validity boundary). A retired or unsupported id fails fast at the API
  // call, never snapped to a valid one here.
  main_model: string
  light_model: string
}

export interface OpenAITextAIConfig {
  // Empty string means the official OpenAI endpoint (https://api.openai.com/v1).
  endpoint: string
  api_key: string
  timeout_ms: number
  // main leads light, matching the Gemini config and the UI order.
  main_model: string
  light_model: string
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

export interface FluxBackendConfig {
  api_key: string
  model: string
  default_params: {
    width: number
    height: number
    // Present only once the user has used a model that exposes them (FLUX Flex).
    steps?: number
    guidance?: number
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
    quality: string
  }
  concurrency: number
  timeout_ms: number
}

export interface ImageBackendsConfig {
  openai: OpenAIBackendConfig
  nanobanana: NanoBananaBackendConfig
  grok: GrokBackendConfig
  flux: FluxBackendConfig
  drawthings: DrawThingsBackendConfig
}

export interface PromptsConfig {
  slug: string
}

export interface BrainstormTemplates {
  // The one prose template: each turn is a FRESH call (no conversation history)
  // that expands a batch of concept assignments into prompts. Placeholders:
  // {{ELABORATOR}}, {{SEED}}, {{CONCEPTS}}, {{FORMAT}}, {{N}}, {{JSON}}.
  // The planning messages (facet resolution, probe generation, cluster
  // expansion) are app-owned constants in concepts/planner.ts — their output
  // feeds a parser, so a template edit must not be able to break the mechanism.
  expansion: string
}

export interface BrainstormConfig {
  // Prompts per expansion call. Each call is independent, so this trades
  // fewer/larger calls against progress granularity, nothing else.
  batch_size: number
  // Expansion calls in flight at once. Concurrent turns hold disjoint concept
  // assignments by construction (draws serialize before any call fires), so
  // this trades only wall time against provider rate limits — an overshoot
  // lands in the retry path as a 429, never in a correctness failure.
  concurrency: number
  max_retries_per_turn: number
  retry_backoff_ms: number[]
  // Mint new concept values in preference to reusing ones whose last use has
  // aged out of the reuse window. Off: stale values are reused first and the
  // text AI is only asked for more when nothing at all is eligible.
  prefer_new_concepts: boolean
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
