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
  }
  concurrency: number
}

export interface GoogleBackendConfig {
  api_key: string
  model: string
  default_params: {
    width: number
    height: number
  }
  concurrency: number
}

export interface FluxBackendConfig {
  api_key: string
  model: string
  default_params: {
    steps: number
    width: number
    height: number
  }
  concurrency: number
}

export interface LocalBackendConfig {
  cli_path: string
  model: string
  default_params: {
    steps: number
    width: number
    height: number
  }
  models_dir: string
}

export interface ImageBackendsConfig {
  openai: OpenAIBackendConfig
  google: GoogleBackendConfig
  flux: FluxBackendConfig
  local: LocalBackendConfig
}

export interface PromptsConfig {
  slug: string
}

export interface AppConfig {
  text_ai: TextAIConfig
  image_backends: ImageBackendsConfig
  prompts: PromptsConfig
}
