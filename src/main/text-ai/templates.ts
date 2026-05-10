// Runtime brainstorm config helpers. Defaults live in config/defaults.ts and
// can be overridden from config.json (or via the Elaboration Settings modal).

import { loadConfig } from '../config'
import type { BrainstormConfig } from '../config/types'

// JSON schema requested from the model on every turn. Hardcoded — the
// orchestrator parses the response shape, so this is not user-tunable.
// Always ask for {prompts: string[]} even when N=1 so the parser is uniform.
export const PROMPTS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    prompts: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['prompts'],
} as const

// Returns the live brainstorm config (defaults filled in via config-store).
export function getRuntimeBrainstormConfig(): BrainstormConfig {
  return loadConfig().brainstorm
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}
