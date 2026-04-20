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
          height: 1024,
          outputFormat: 'png',
          background: 'opaque'
        },
        concurrency: 3
      },
      google: {
        api_key: '',
        model: 'imagen-4.0-generate-001',
        default_params: {
          aspectRatio: '1:1',
          imageSize: '1024x1024',
          personGeneration: 'allow_adult',
          numberOfImages: 1
        },
        concurrency: 3
      },
      flux: {
        api_key: '',
        model: 'flux-2-max',
        default_params: {
          steps: 40,
          guidance: 7,
          width: 1024,
          height: 1024,
          seed: null
        },
        concurrency: 3
      },
      local: {
        cli_path: '',
        model: 'flux_2_klein_4b_q6p.ckpt',
        default_params: {
          steps: 4,
          cfg: 1,
          width: 1024,
          height: 1024,
          seed: null,
          negativePrompt: ''
        },
        models_dir: '~/.imagequeue/models'
      },
      nanobanana: {
        model: 'gemini-3.1-flash-image-preview',
        concurrency: 3
      }
    },
    prompts: {
      slug: 'Generate a short filename slug (3-5 lowercase English words, hyphens only, no other characters) that captures the essence of this image prompt: {{prompt}}'
    },
    ui: {
      leftPaneWidth: 360
    }
  }
}
