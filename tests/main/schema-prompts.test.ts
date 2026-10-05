import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../src/main/config/defaults'
import { SLUG_RESPONSE_SCHEMA } from '../../src/main/backends/slug'
import { fillTemplate, PROMPTS_RESPONSE_SCHEMA } from '../../src/main/text-ai/templates'
import {
  buildExpandProbesMessage,
  buildGenerateProbesMessage,
  buildResolveFacetsMessage,
  CLUSTERS_SCHEMA,
  FACETS_SCHEMA,
  PROBES_SCHEMA,
} from '../../src/main/concepts/planner'

// A built-in prompt whose answer comes back through a strict schema leaves the
// format to the schema: it never asks for the answer alone or spells out the
// JSON shape, and it still says what goes in each field.

function fieldNames(schema: object): string[] {
  const names: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const { properties, items } = node as { properties?: Record<string, unknown>; items?: unknown }
    for (const [name, child] of Object.entries(properties ?? {})) {
      names.push(name)
      walk(child)
    }
    walk(items)
  }
  walk(schema)
  return names
}

const defaults = createDefaultConfig()
const PROMPTS: [string, string, object][] = [
  ['the slug prompt', defaults.prompts.slug, SLUG_RESPONSE_SCHEMA],
  ['the expansion template', defaults.brainstorm.templates.expansion, PROMPTS_RESPONSE_SCHEMA],
  ['the aspects ask', buildResolveFacetsMessage('a fox', []), FACETS_SCHEMA],
  ['the domains ask', buildGenerateProbesMessage('place', []), PROBES_SCHEMA],
  ['the clusters ask', buildExpandProbesMessage('place', ['rooms of a grand hotel']), CLUSTERS_SCHEMA],
]

describe('built-in prompts answered through a strict schema', () => {
  it.each(PROMPTS)('%s does not contradict or restate its schema', (_name, prompt) => {
    expect(prompt).not.toMatch(/\bonly\b[^.]*\bJSON\b|\b(reply|respond|return) with\b[^.]*\bonly\b/i)
    expect(prompt).not.toMatch(/\[string|\{\{JSON\}\}|<response_format>/)
  })

  it.each(PROMPTS)('%s names every field of its schema', (_name, prompt, schema) => {
    for (const field of fieldNames(schema)) expect(prompt, field).toContain(`"${field}"`)
  })

  it('leaves the expansion template no placeholder unfilled', () => {
    const filled = fillTemplate(defaults.brainstorm.templates.expansion, { ELABORATOR: 'e', SEED: 's', CONCEPTS: 'c', FORMAT: 'f', N: '1' })
    expect(filled).not.toMatch(/\{\{\w+\}\}/)
  })
})
