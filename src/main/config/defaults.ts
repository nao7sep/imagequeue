import { AppConfig } from './types'

export function createDefaultConfig(): AppConfig {
  return {
    text_ai: {
      backend: 'google',
      model: 'gemini-3.1-flash-lite-preview',
      api_key: ''
    },
    image_backends: {
      openai: {
        api_key: '',
        model: 'gpt-image-1.5',
        default_params: {
          quality: 'high',
          width: 1024,
          height: 1024
        },
        concurrency: 3
      },
      google: {
        api_key: '',
        model: 'imagen-4.0-generate-001',
        default_params: {
          width: 1024,
          height: 1024
        },
        concurrency: 3
      },
      flux: {
        api_key: '',
        model: 'flux-2-max',
        default_params: {
          steps: 28,
          width: 1024,
          height: 1024
        },
        concurrency: 3
      },
      local: {
        cli_path: '',
        model: 'flux_1_schnell_q5p.ckpt',
        default_params: {
          steps: 20,
          width: 1024,
          height: 1024
        },
        models_dir: '~/.imagequeue/models'
      }
    },
    prompts: {
      slug: 'Generate a short filename slug (3-5 lowercase English words, hyphens only, no other characters) that captures the essence of this image prompt: {{prompt}}'
    }
  }
}
