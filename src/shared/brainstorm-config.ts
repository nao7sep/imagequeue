import type { FormatDirectives } from './session-draft'

// The elaboration settings, declared once for main, the IPC bridge and the
// Elaboration Settings window.

export interface BrainstormTemplates {
  // The one prose template: each turn is a FRESH call (no conversation history)
  // that expands a batch of concept assignments into prompts. Placeholders:
  // {{ELABORATOR}}, {{SEED}}, {{CONCEPTS}}, {{FORMAT}}, {{N}}, {{JSON}}.
  // The planning messages (facet resolution, probe generation, cluster
  // expansion) are app-owned constants, not templates: their output feeds a
  // parser, so a template edit must not be able to break the mechanism.
  expansion: string
}

export interface BrainstormConfig {
  // Prompts per expansion call. Each call is independent, so this trades
  // fewer/larger calls against progress granularity, nothing else.
  batch_size: number
  // Expansion calls in flight at once. Concurrent turns hold disjoint concept
  // assignments by construction (draws serialize before any call fires), so
  // this trades only wall time against provider rate limits — an overshoot
  // lands in the retry path as a 429, never in a correctness failure.
  concurrency: number
  max_retries_per_turn: number
  // Mint new concept values in preference to reusing ones whose last use has
  // aged out of the reuse window. Off: stale values are reused first and the
  // text AI is only asked for more when nothing at all is eligible.
  prefer_new_concepts: boolean
  templates: BrainstormTemplates
  format_directives: FormatDirectives
}
