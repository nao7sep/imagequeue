import { AppConfig } from './types'

export function createDefaultConfig(): AppConfig {
  return {
    text_ai: {
      backend: 'gemini',
      api_key: '',
      timeout_ms: 30000,
      light_model: 'gemini-3.1-flash-lite-preview',
      main_model: 'gemini-3-flash-preview'
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
    notifications: {
      notifications_enabled: true,
      sounds_enabled: true,
      volume: 0.7,
      success_file: '',
      failure_file: ''
    },
    prompts: {
      slug: 'Generate a short filename slug (3-5 lowercase English words, hyphens only, no other characters) that captures the essence of this image prompt: {{prompt}}'
    },
    brainstorm: {
      batch_size: 10,
      max_retries_per_turn: 3,
      retry_backoff_ms: [1000, 2000, 4000],
      templates: {
        first_no_previous: `{{ELABORATOR}}

User's seed prompt: {{SEED}}

Produce {{N}} distinct prompt(s). Reply as JSON: { "prompts": [string, ...] }.`,
        first_with_previous: `{{ELABORATOR}}

User's seed prompt: {{SEED}}

Previously generated prompts (do not repeat any of these and do not produce minor variations of them):
{{PREVIOUS}}

Produce {{N}} distinct prompt(s). Reply as JSON: { "prompts": [string, ...] }.`,
        continuation: `Produce {{N}} more distinct prompt(s) that don't repeat the prompts you've already produced. Reply as JSON: { "prompts": [string, ...] }.`,
        override_combine: `{{PROMPT}}

Override: {{OVERRIDE}}`,
      }
    }
  }
}
