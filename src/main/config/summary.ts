import { AppConfig } from './types'
import { PROVIDER_ENDPOINTS } from '../../shared/ai-models'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER, IMAGE_BACKEND_SECRET } from '../../shared/types'
import { hasApiKey } from './api-keys-store'

// A summary of the effective configuration for the startup log line.
//
// Cloud backends are derived from the shared id list rather than hand-listed,
// so a new backend appears here automatically.
export function summarizeConfig(config: AppConfig): Record<string, unknown> {
  const cloudBackends: Record<string, unknown> = {}
  for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
    const backend = config.image_backends[id]
    cloudBackends[id] = {
      // Keys live in the separate secrets store (env-first), not config.json.
      apiKeyPresent: hasApiKey(IMAGE_BACKEND_SECRET[id]),
      model: backend.model,
      concurrency: backend.concurrency,
      timeoutMs: backend.timeout_ms,
    }
  }

  const drawthings = config.image_backends.drawthings

  return {
    textAi: {
      backend: config.provider,
      geminiApiKeyPresent: hasApiKey('gemini.text'),
      geminiElaborationModel: config.gemini.elaboration,
      geminiSlugModel: config.gemini.slug,
      openaiApiKeyPresent: hasApiKey('openai.text'),
      openaiElaborationModel: config.openai.elaboration,
      openaiSlugModel: config.openai.slug,
      openaiEndpointOverride: Boolean(config.openai.endpoint && config.openai.endpoint !== PROVIDER_ENDPOINTS.openai),
    },
    imageBackends: {
      ...cloudBackends,
      drawthings: {
        modelsDir: drawthings.models_dir,
        checkUpdatesAtLaunch: drawthings.check_updates_at_launch,
      },
    },
    general: {
      deleteToTrash: config.general.delete_to_trash,
      dropEmptySessions: config.general.drop_empty_sessions,
      keepAwakeDuringWork: config.general.keep_awake_during_work,
      showStatusIcon: config.general.show_status_icon,
    },
    notifications: {
      enabled: config.notifications.notifications_enabled,
      soundsEnabled: config.notifications.sounds_enabled,
    },
  }
}
