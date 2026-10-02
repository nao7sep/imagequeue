import { AppConfig } from './types'
import { PROVIDER_ENDPOINTS } from '../../shared/ai-models'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER, IMAGE_BACKEND_SECRET } from '../../shared/types'
import { hasApiKey } from './api-keys-store'

// A secret-free summary of the effective configuration for the startup log
// line. API keys are reduced to presence booleans and never logged — the raw
// values are stored obfuscated but still reversible, so even the stored form
// must not reach the log.
//
// Every field is read defensively (optional chaining). config.json is
// user-editable and callers may supply a malformed nested section
// (e.g. `"gemini": null`) verbatim, so a deep, unguarded dereference here would
// throw inside app startup and leave the app running with no window. Cloud
// backends are derived from the shared id list rather than hand-listed, so a new
// backend appears here automatically.
export function summarizeConfig(config: AppConfig): Record<string, unknown> {
  const cloudBackends: Record<string, unknown> = {}
  for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
    const backend = config.image_backends?.[id]
    cloudBackends[id] = {
      // Keys live in the separate secrets store (env-first), not config.json.
      apiKeyPresent: hasApiKey(IMAGE_BACKEND_SECRET[id]),
      model: backend?.model,
      concurrency: backend?.concurrency,
      timeoutMs: backend?.timeout_ms,
    }
  }

  const drawthings = config.image_backends?.drawthings

  return {
    textAi: {
      backend: config.provider,
      geminiApiKeyPresent: hasApiKey('gemini.text'),
      geminiElaborationModel: config.gemini?.elaboration,
      geminiSlugModel: config.gemini?.slug,
      openaiApiKeyPresent: hasApiKey('openai.text'),
      openaiElaborationModel: config.openai?.elaboration,
      openaiSlugModel: config.openai?.slug,
      openaiEndpointOverride: Boolean(config.openai?.endpoint && config.openai.endpoint !== PROVIDER_ENDPOINTS.openai),
    },
    imageBackends: {
      ...cloudBackends,
      drawthings: {
        modelsDir: drawthings?.models_dir,
        checkUpdatesAtLaunch: drawthings?.check_updates_at_launch,
      },
    },
    general: {
      deleteToTrash: config.general?.delete_to_trash,
      dropEmptySessions: config.general?.drop_empty_sessions,
      keepAwakeDuringWork: config.general?.keep_awake_during_work,
      showStatusIcon: config.general?.show_status_icon,
    },
    notifications: {
      enabled: config.notifications?.notifications_enabled,
      soundsEnabled: config.notifications?.sounds_enabled,
    },
  }
}
