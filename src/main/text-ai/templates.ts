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

// Literal shown to the model in place of {{JSON}}. Kept as a constant so a
// user cannot accidentally break the parser by editing the template text.
export const JSON_FORMAT_LITERAL = '{ "prompts": [string, ...] }'

// Returns the live brainstorm config (defaults filled in via config-store).
export function getRuntimeBrainstormConfig(): BrainstormConfig {
  return loadConfig().brainstorm
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  // {{JSON}} is always provided by us, never by the caller, so users editing
  // templates cannot corrupt the response shape.
  const merged: Record<string, string> = { JSON: JSON_FORMAT_LITERAL, ...values }
  let out = template
  for (const [key, value] of Object.entries(merged)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}
