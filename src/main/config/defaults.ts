import { AppConfig } from './types'

export function createDefaultConfig(): AppConfig {
  return {
    text_ai: {
      backend: 'gemini',
      model: 'gemini-3.1-flash-lite-preview',
      api_key: '',
      timeout_ms: 30000
    },
    general: {
      auto_preview_idle_seconds: 30,
      export_dir: '',
      confirm_remove: false,
      confirm_delete: false,
      delete_to_trash: true
    },
    image_backends: {
      openai: {
        api_key: '',
        model: 'gpt-image-2',
        default_params: {
          quality: 'medium',
          width: 1024,
          height: 1024,
          outputFormat: 'png',
          background: 'opaque'
        },
        concurrency: 3,
        timeout_ms: 180000
      },
      imagen: {
        api_key: '',
        model: 'imagen-4.0-generate-001',
        default_params: {
          aspectRatio: '1:1',
          imageSize: '1024x1024',
          personGeneration: 'allow_adult',
          numberOfImages: 1
        },
        concurrency: 3,
        timeout_ms: 180000
      },
      nanobanana: {
        api_key: '',
        model: 'gemini-3.1-flash-image-preview',
        concurrency: 3,
        timeout_ms: 180000
      },
      grok: {
        api_key: '',
        model: 'grok-imagine-image',
        default_params: {
          aspectRatio: '1:1'
        },
        concurrency: 3,
        timeout_ms: 180000
      },
      flux: {
        api_key: '',
        model: 'flux-2-pro',
        default_params: {
          width: 1024,
          height: 1024,
          steps: 40,
          guidance: 7,
          seed: null
        },
        concurrency: 3,
        timeout_ms: 180000
      },
      drawthings: {
        cli_path: '',
        default_params: {
          fallback_width: 1024,
          fallback_height: 1024,
          fallback_steps: 4,
          fallback_guidance: 1,
          fallback_negative_prompt: '',
          seed: null,
        },
        models_dir: '',
        auto_update_recommendations: true
      }
    },
    prompts: {
      slug: 'Generate a short filename slug (3-5 lowercase English words, hyphens only, no other characters) that captures the essence of this image prompt: {{prompt}}'
    }
  }
}
