// Matches the config.json schema from the product spec.
//
// No api_key field appears anywhere in this type, and that is load-bearing: keys
// live only in the separate 0600 api-keys.json (config/api-keys-store.ts). A type
// that cannot hold a key needs no scrubbing on the way to disk, so there is no
// carve list to keep in step with a new provider — config.json is key-free by
// construction rather than by maintenance.

import { TextAIBackendId } from '../../shared/types'
import type { FormatDirectives } from '../../shared/session-draft'
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
  // Launch-time metadata check for the managed CLI. On by default; it never
  // downloads the binary, and versionless configs.json is not part of the check.
  check_updates_at_launch: boolean
}

export interface NanoBananaBackendConfig {
  model: string
  default_params: {
    aspectRatio: string
    imageSize: string
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
  // The app theme: 'system', 'light', or 'dark'. A `string`, not ThemePreference:
  // the store hands back whatever the file holds, and normalizeThemePreference
  // (shared/theme) resolves a missing or unknown value to System at use.
  theme: string
  // The interface language: 'system' follows the computer's language on every
  // launch; otherwise a supported language tag. A `string` for the same reason
  // as theme: normalizeLanguagePreference (shared/i18n) resolves it at use.
  language: string
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
}

export interface NotificationsConfig {
  notifications_enabled: boolean
  sounds_enabled: boolean
  // No volume here: whether sounds play is a setting, how loud they play is a
  // presentation adjustment and lives in state.json (shared/ui-state).
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
