import type { PromptMode } from '../../../shared/session-draft'
import type { BackendId, EnqueueBatchUnit } from '../../../shared/types'

export interface AdvancedQueueTarget {
  backend: BackendId
  model: string
  params: Record<string, unknown>
}

// The batch contract of Advanced Prompting's Queue Tasks, extracted from the
// modal shell: how many prompts each mode needs, and which prompt each
// (target, iteration) unit carries. Pure — the off-by-one-prone half of the
// modal, previously reachable only by driving it, now unit-tested beside the
// gate decisions it feeds.

/** Prompts a run must generate before any unit can be built. */
export function promptsNeeded(mode: PromptMode, copies: number, targetCount: number): number {
  if (mode === 'fresh-iteration') return copies
  if (mode === 'fresh-task') return targetCount * copies
  // as-is / elaborated reuse a single prompt body for everything.
  return 1
}

/**
 * The prompt for one unit. Iteration-major for fresh-task — iteration 0 across
 * every target, then iteration 1 — matching the order the units are pushed.
 *
 * Throws on a shortfall instead of wrapping around: the engine's contract is
 * exactly-`needed`-or-throw, so an under-delivery reaching this function is a
 * broken invariant, and silently duplicating prompts across tasks (what a
 * modulo would do) hides precisely the defect worth surfacing.
 */
export function promptTextForUnit(
  mode: PromptMode,
  prompts: readonly string[],
  targetIndex: number,
  copyIndex: number,
  targetCount: number,
): string {
  const index =
    mode === 'fresh-task' ? copyIndex * targetCount + targetIndex
    : mode === 'fresh-iteration' ? copyIndex
    : 0
  const prompt = prompts[index]
  if (prompt === undefined) {
    throw new Error(`Prompt ${index + 1} missing: have ${prompts.length} for mode ${mode}.`)
  }
  return prompt
}

/** Build the complete iteration-major batch after target params are resolved. */
export function buildAdvancedQueueUnits(options: {
  mode: PromptMode
  prompts: readonly string[]
  copies: number
  targets: readonly AdvancedQueueTarget[]
}): EnqueueBatchUnit[] {
  const { mode, prompts, targets } = options
  const copies = Math.max(1, options.copies)
  const units: EnqueueBatchUnit[] = []

  for (let copyIndex = 0; copyIndex < copies; copyIndex++) {
    targets.forEach((target, targetIndex) => {
      units.push({
        prompt: promptTextForUnit(mode, prompts, targetIndex, copyIndex, targets.length),
        backend: target.backend,
        model: target.model,
        params: target.params,
      })
    })
  }
  return units
}
