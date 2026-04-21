// Matches the config.json schema from the product spec.

export interface TextAIConfig {
  backend: string
  model: string
  api_key: string
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
}

export interface FluxBackendConfig {
  api_key: string
  model: string
  default_params: {
    steps: number
    guidance: number
    width: number
    height: number
    seed: number | null
  }
  concurrency: number
}

export interface DrawThingsBackendConfig {
  cli_path: string
  model: string
  default_params: {
    steps: number
    cfg: number
    width: number
    height: number
    seed: number | null
    negativePrompt: string
  }
  models_dir: string
}

export interface NanoBananaBackendConfig {
  api_key: string
  model: string
  concurrency: number
}

export interface ImageBackendsConfig {
  openai: OpenAIBackendConfig
  imagen: ImagenBackendConfig
  nanobanana: NanoBananaBackendConfig
  flux: FluxBackendConfig
  drawthings: DrawThingsBackendConfig
}

export interface PromptsConfig {
  slug: string
}

export interface AppConfig {
  text_ai: TextAIConfig
  image_backends: ImageBackendsConfig
  prompts: PromptsConfig
  ui: UiConfig
}

export interface UiConfig {
  leftPaneWidth: number
}
