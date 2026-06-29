import { AppConfig } from './types'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../../shared/types'
import { hasApiKey, type SecretId } from './api-keys-store'

// A secret-free summary of the effective configuration for the startup log
// line. API keys are reduced to presence booleans and never logged — the raw
// values are stored obfuscated but still reversible, so even the stored form
// must not reach the log. The logger's redactor is a backstop; this summary is
// the primary "summarize, don't dump" defense for config.
//
// Every field is read defensively (optional chaining). config.json is
// user-editable and deepMergeDefaults preserves a malformed nested section
// (e.g. `"text_ai": null`) verbatim, so a deep, unguarded dereference here would
// throw inside app startup and leave the app running with no window. Cloud
// backends are derived from the shared id list rather than hand-listed, so a new
// backend appears here automatically.
export function summarizeConfig(config: AppConfig): Record<string, unknown> {
  const cloudBackends: Record<string, unknown> = {}
  for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
    const backend = config.image_backends?.[id]
    cloudBackends[id] = {
      // Keys live in the separate secrets store (env-first), not config.json.
      apiKeyPresent: hasApiKey(`image.${id}` as SecretId),
      model: backend?.model,
      concurrency: backend?.concurrency,
      timeoutMs: backend?.timeout_ms,
    }
  }

  const drawthings = config.image_backends?.drawthings
  const textAi = config.text_ai

  return {
    textAi: {
      backend: textAi?.backend,
      geminiApiKeyPresent: hasApiKey('text_ai.gemini'),
      geminiMainModel: textAi?.gemini?.main_model,
      openaiApiKeyPresent: hasApiKey('text_ai.openai'),
      openaiMainModel: textAi?.openai?.main_model,
      openaiEndpointOverride: Boolean(textAi?.openai?.endpoint),
    },
    imageBackends: {
      ...cloudBackends,
      drawthings: {
        cliPathSet: Boolean(drawthings?.cli_path),
        modelsDir: drawthings?.models_dir,
        autoUpdateRecommendations: drawthings?.auto_update_recommendations,
        checkCliUpdates: drawthings?.check_cli_updates,
      },
    },
    general: {
      deleteToTrash: config.general?.delete_to_trash,
      dropEmptySessions: config.general?.drop_empty_sessions,
      keepAwakeDuringWork: config.general?.keep_awake_during_work,
    },
    notifications: {
      enabled: config.notifications?.notifications_enabled,
      soundsEnabled: config.notifications?.sounds_enabled,
    },
  }
}
