import type { BrainstormPhase, ElaboratorKind } from '../../../shared/types'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { message, type Message } from '../../../shared/i18n/translate'
import { isBrainstormMode } from './promptMode'
import type { PromptMode } from '../../../shared/session-draft'

// Which operation, if any, the Advanced Prompting modal is currently running.
// Elaborate and Queue both drive the single brainstorm engine, so they are
// mutually exclusive: at most one is ever active. Modeling this as one value
// (rather than a boolean per action) is what keeps the engine from being driven
// by two operations at once — there is no second flag for a control to read.
export type ActiveOperation = 'elaborate' | 'queue' | null

// Whether each elaborator category currently has a valid selection.
export interface ElaboratorPicks {
  composition: boolean
  style: boolean
}

// The first elaborator category lacking a valid selection, in the fixed
// composition → style order the UI presents, or null when both
// are picked. Brainstorming needs one of each.
export function firstMissingElaboratorKind(picks: ElaboratorPicks): ElaboratorKind | null {
  if (!picks.composition) return 'composition'
  if (!picks.style) return 'style'
  return null
}

// Every reason is a catalogue key, worded where the tooltip shows it.
const PICK_ELABORATOR_REASON: Record<ElaboratorKind, MessageKey> = {
  composition: 'gates.pickComposition',
  style: 'gates.pickStyle',
}

function pickElaboratorReason(missingKind: ElaboratorKind): MessageKey {
  return PICK_ELABORATOR_REASON[missingKind]
}

// Why the Elaborate (single-prompt preview) action is unavailable, or null when
// it is ready to run. Preconditions only — being mid-operation is handled by
// computeAdvancedGates.
export function elaborateDisabledReason(
  seedFilled: boolean,
  missingKind: ElaboratorKind | null,
): MessageKey | null {
  if (!seedFilled) return 'gates.enterSeedAbove'
  if (missingKind) return pickElaboratorReason(missingKind)
  return null
}

// Why a given prompt-source mode cannot be selected, or null when it can. Drives
// the prompt-source radios, which reflect preconditions independently of whether
// an operation is running.
export function promptModeDisabledReason(
  which: PromptMode,
  elaboratedFilled: boolean,
  missingKind: ElaboratorKind | null,
): MessageKey | null {
  if (which === 'elaborated' && !elaboratedFilled) return 'gates.runElaborateFirst'
  if (isBrainstormMode(which) && missingKind) return pickElaboratorReason(missingKind)
  return null
}

// Why the Queue Tasks action is unavailable, or null when it is ready to run.
// Preconditions only — see computeAdvancedGates for the mid-operation guard.
export function queueDisabledReason(
  promptMode: PromptMode,
  seedFilled: boolean,
  elaboratedFilled: boolean,
  missingKind: ElaboratorKind | null,
  totalTasks: number,
): MessageKey | null {
  if (totalTasks === 0) return 'gates.selectTarget'
  if (promptMode === 'as-is' && !seedFilled) return 'gates.seedEmpty'
  if (promptMode === 'elaborated' && !elaboratedFilled) return 'gates.elaboratedEmpty'
  if (isBrainstormMode(promptMode) && missingKind) return pickElaboratorReason(missingKind)
  if (isBrainstormMode(promptMode) && !seedFilled) return 'gates.seedForElaboration'
  return null
}

export interface AdvancedGatesInput {
  activeOperation: ActiveOperation
  seedFilled: boolean
  elaboratedFilled: boolean
  picks: ElaboratorPicks
  promptMode: PromptMode
  totalTasks: number
}

export interface ControlGate {
  disabled: boolean
  // The precondition reason to surface as a tooltip, or null. Null while busy:
  // a mid-operation disable is self-explanatory and should not show a stale
  // precondition hint.
  reason: MessageKey | null
}

export interface AdvancedGates {
  busy: boolean
  missingElaboratorKind: ElaboratorKind | null
  elaborate: ControlGate
  queue: ControlGate
  // Opening the elaborated-prompts history mid-run is blocked: the running
  // operation captured its avoid-list at start and repopulates the list on
  // completion, so editing it during the run is misleading.
  history: { disabled: boolean }
}

// Single source of truth for the modal's three action surfaces. While an
// operation is in flight (busy), Elaborate, Queue Tasks, and the Elaborated
// history are ALL disabled regardless of preconditions — only one operation may
// drive the brainstorm engine at a time. When idle, each reflects its own
// precondition reason.
export function computeAdvancedGates(input: AdvancedGatesInput): AdvancedGates {
  const busy = input.activeOperation !== null
  const missingElaboratorKind = firstMissingElaboratorKind(input.picks)

  const elaborateReason = elaborateDisabledReason(input.seedFilled, missingElaboratorKind)
  const queueReason = queueDisabledReason(
    input.promptMode,
    input.seedFilled,
    input.elaboratedFilled,
    missingElaboratorKind,
    input.totalTasks,
  )

  return {
    busy,
    missingElaboratorKind,
    elaborate: { disabled: busy || elaborateReason !== null, reason: busy ? null : elaborateReason },
    queue: { disabled: busy || queueReason !== null, reason: busy ? null : queueReason },
    history: { disabled: busy },
  }
}

/**
 * What the modal's footer says while an operation runs.
 *
 * A cold run spends most of its wall time before a single prompt exists —
 * resolving which aspects to vary, then minting concepts — so a bare counter
 * reports nothing during exactly the stretch that looks like a hang. The engine
 * names the stage it is in; the wording is the UI's, which is why it lives here
 * and not in main.
 *
 * Returns null when nothing is running, so the caller can omit the element.
 */
export function describeBrainstormProgress(
  operation: ActiveOperation,
  progress: { done: number; total: number; phase: BrainstormPhase } | null,
): Message | null {
  if (!operation) return null
  // The engine has stopped reporting but the operation has not returned: the
  // tasks are being queued, or the single Elaborate result is being accepted.
  if (!progress) return message(operation === 'queue' ? 'progress.queueing' : 'progress.finishing')
  switch (progress.phase) {
    case 'facets':
      return message('progress.facets')
    case 'concepts':
      return message('progress.concepts')
    case 'prompts':
    default:
      return progress.total === 1
        ? message('progress.writingOne')
        : message('progress.writingMany', { done: progress.done, total: progress.total })
  }
}
