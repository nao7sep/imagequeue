// The per-session "draft": the renderer's working state for one session — the
// prompt currently being composed plus the Advanced Prompting selections. It is
// persisted inside session.json (see SessionManifest.draft) so resuming a
// session restores the full working context, not just its task history.
//
// This lives in shared/ because both sides need it: the renderer owns and edits
// the draft, while the main process persists it and normalizes it on read.

import { BACKEND_IDS_IN_UI_ORDER, type BackendId } from './types'

export type PromptMode = 'as-is' | 'elaborated' | 'fresh-iteration' | 'fresh-task'
export type TargetScope = 'selected' | 'all-proprietary' | 'all-drawthings' | 'all'

export const PROMPT_MODES: readonly PromptMode[] = ['as-is', 'elaborated', 'fresh-iteration', 'fresh-task']
export const TARGET_SCOPES: readonly TargetScope[] = ['selected', 'all-proprietary', 'all-drawthings', 'all']

// Matches the max enforced by the iteration input in the Advanced Prompting modal.
export const MAX_DRAFT_ITERATIONS = 9999

export interface SessionDraft {
  // Main prompt-pane text.
  prompt: string
  // Advanced Prompting: the seed/full prompt and the elaborated result.
  seed: string
  elaborated: string
  // Advanced Prompting: the three elaborator selections.
  selectedContentElaboratorId: string | null
  selectedCompositionElaboratorId: string | null
  selectedStyleElaboratorId: string | null
  // Advanced Prompting: the chosen targets and execution settings.
  selectedProprietary: Record<BackendId, boolean>
  selectedDtFiles: string[]
  promptMode: PromptMode
  targetScope: TargetScope
  count: number
}

function emptySelectedProprietary(): Record<BackendId, boolean> {
  const result = {} as Record<BackendId, boolean>
  for (const backend of BACKEND_IDS_IN_UI_ORDER) result[backend] = false
  return result
}

export function createEmptySessionDraft(): SessionDraft {
  return {
    prompt: '',
    seed: '',
    elaborated: '',
    selectedContentElaboratorId: null,
    selectedCompositionElaboratorId: null,
    selectedStyleElaboratorId: null,
    selectedProprietary: emptySelectedProprietary(),
    selectedDtFiles: [],
    promptMode: 'as-is',
    targetScope: 'selected',
    count: 1,
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function asNullableId(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  const floored = Math.floor(value)
  if (floored < 1) return 1
  return Math.min(MAX_DRAFT_ITERATIONS, floored)
}

function normalizeSelectedProprietary(value: unknown): Record<BackendId, boolean> {
  const result = emptySelectedProprietary()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>
    for (const backend of BACKEND_IDS_IN_UI_ORDER) {
      if (source[backend] === true) result[backend] = true
    }
  }
  return result
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

// Rebuilds a complete, valid SessionDraft from arbitrary input. Unknown or
// malformed fields fall back to their empty-draft defaults rather than the whole
// object being rejected, so a partial draft (written by an older build) or a
// corrupted one degrades to a clean draft without taking the session's task
// history down with it. Also serves as a deep clone for trusted input.
export function normalizeSessionDraft(value: unknown): SessionDraft {
  const base = createEmptySessionDraft()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base
  const v = value as Record<string, unknown>
  return {
    prompt: asString(v.prompt, base.prompt),
    seed: asString(v.seed, base.seed),
    elaborated: asString(v.elaborated, base.elaborated),
    selectedContentElaboratorId: asNullableId(v.selectedContentElaboratorId),
    selectedCompositionElaboratorId: asNullableId(v.selectedCompositionElaboratorId),
    selectedStyleElaboratorId: asNullableId(v.selectedStyleElaboratorId),
    selectedProprietary: normalizeSelectedProprietary(v.selectedProprietary),
    selectedDtFiles: normalizeStringArray(v.selectedDtFiles),
    promptMode: PROMPT_MODES.includes(v.promptMode as PromptMode) ? (v.promptMode as PromptMode) : base.promptMode,
    targetScope: TARGET_SCOPES.includes(v.targetScope as TargetScope) ? (v.targetScope as TargetScope) : base.targetScope,
    count: normalizeCount(v.count),
  }
}
