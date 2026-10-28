// AppConfig is the complete effective settings snapshot used by the app.
// config.json omits built-in sets, groups some values differently, and preserves
// unknown keys and rejected stored sets outside this type. The known settings
// fields exclude API keys, which live in the separate 0600 api-keys.json; this
// type does not guarantee that the raw persisted map contains no keys.

import { TextAIBackendId } from '../../shared/types'
import type { TextRole } from '../../shared/ai-models'

export interface TextProviderConfig {
  endpoint: string
  elaboration: string
  slug: string
  // Each role's chosen thinking value; empty means the default for the role's
  // selected model.
  thinking: Record<TextRole, string>
  timeout_ms: number
}

export interface OpenAIBackendConfig {
  model: string
  default_params: {
    width: number
    height: number
    quality: string
    outputFormat: 'png' | 'jpeg' | 'webp'
    outputCompression: number
    background: 'auto' | 'transparent' | 'opaque'
  }
  concurrency: number
  timeout_ms: number
}

export interface FluxBackendConfig {
  model: string
  // FLUX 3 takes a ratio and a resolution; FLUX.2 a size, format and seed, and
  // Flex steps and guidance.
  default_params: {
    aspectRatio?: string
    resolution?: string
    width?: number
    height?: number
    outputFormat?: string
    steps?: number
    guidance?: number
    seed?: number | null
  }
  concurrency: number
  timeout_ms: number
}

export interface DrawThingsBackendConfig {
  // The one bound on a generation run. Local rendering legitimately takes
  // minutes on big models, so the default is generous — but without ANY bound
  // a wedged CLI held its queue slot forever with no error, kept the wake
  // lock, and blocked every Draw Things task behind it (concurrency is 1).
  timeout_ms: number
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
  // Launch-time metadata check for the managed CLI and installed recommendations.
  // On by default; it never downloads the binary.
  check_updates_at_launch: boolean
}

export interface NanoBananaBackendConfig {
  model: string
  default_params: {
    aspectRatio: string
    imageSize: string
    thinking: string
  }
  concurrency: number
  timeout_ms: number
}

export interface GrokBackendConfig {
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

export type { BrainstormConfig, BrainstormTemplates } from '../../shared/brainstorm-config'
import type { BrainstormConfig } from '../../shared/brainstorm-config'

export interface GeneralConfig {
  // The store accepts 'system', 'light', or 'dark'; an invalid stored value
  // reads as the built-in, while an invalid changed value rejects the save.
  theme: string
  // 'system' follows the computer's language; otherwise a supported language
  // tag. The store validates loaded and changed values as it does theme.
  language: string
  // 'system' follows the computer's zone; otherwise a valid IANA zone. The
  // store validates loaded and changed values as it does theme.
  time_zone: string
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
  show_status_icon: boolean
  // Whether the preview also shows in its own window beside the main window.
  // Closing that window turns it off.
  show_preview_window: boolean
}

export interface NotificationsConfig {
  notifications_enabled: boolean
  // How loud completion sounds play, 0–1; zero mutes them.
  volume: number
  success_file: string
  failure_file: string
}

export interface AppConfig {
  provider: TextAIBackendId
  gemini: TextProviderConfig
  openai: TextProviderConfig
  general: GeneralConfig
  notifications: NotificationsConfig
  image_backends: ImageBackendsConfig
  prompts: PromptsConfig
  brainstorm: BrainstormConfig
}
