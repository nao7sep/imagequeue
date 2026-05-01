// Matches the config.json schema from the product spec.

import { TextAIBackendId } from '../../shared/types'

export interface TextAIConfig {
  backend: TextAIBackendId
  model: string
  api_key: string
  timeout_ms: number
}

export interface OpenAIBackendConfig {
  api_key: string
  model: string
  default_params: {
    quality: 'low' | 'medium' | 'high'
    width: number
    height: number
    outputFormat: 'png' | 'jpeg' | 'webp'
    background: 'opaque' | 'transparent'
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
  concurrency: number
  timeout_ms: number
}

export interface GrokBackendConfig {
  api_key: string
  model: string
  default_params: {
    aspectRatio: string
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

export interface GeneralConfig {
  auto_preview_idle_seconds: number
  export_dir: string
  confirm_remove: boolean
  confirm_delete: boolean
  delete_to_trash: boolean
}

export interface AppConfig {
  text_ai: TextAIConfig
  general: GeneralConfig
  image_backends: ImageBackendsConfig
  prompts: PromptsConfig
}
