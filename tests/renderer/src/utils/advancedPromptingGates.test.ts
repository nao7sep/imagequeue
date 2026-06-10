import { describe, expect, it } from 'vitest'
import {
  computeAdvancedGates,
  elaborateDisabledReason,
  firstMissingElaboratorKind,
  promptModeDisabledReason,
  queueDisabledReason,
  type AdvancedGatesInput,
  type ElaboratorPicks,
} from '../../../../src/renderer/src/utils/advancedPromptingGates'

const allPicked: ElaboratorPicks = { content: true, composition: true, style: true }

describe('firstMissingElaboratorKind', () => {
  it('returns null when all three categories are picked', () => {
    expect(firstMissingElaboratorKind(allPicked)).toBeNull()
  })

  it('reports the missing category in content → composition → style order', () => {
    expect(firstMissingElaboratorKind({ content: false, composition: false, style: false })).toBe('content')
    expect(firstMissingElaboratorKind({ content: true, composition: false, style: false })).toBe('composition')
    expect(firstMissingElaboratorKind({ content: true, composition: true, style: false })).toBe('style')
  })
})

describe('elaborateDisabledReason', () => {
  it('requires a seed first', () => {
    expect(elaborateDisabledReason(false, null)).toBe('Enter a seed prompt above.')
  })

  it('requires an elaborator once the seed is present', () => {
    expect(elaborateDisabledReason(true, 'composition')).toBe('Pick a composition elaborator first.')
  })

  it('is null when seed and elaborators are ready', () => {
    expect(elaborateDisabledReason(true, null)).toBeNull()
  })
})

describe('promptModeDisabledReason', () => {
  it('blocks the elaborated mode until an elaborated prompt exists', () => {
    expect(promptModeDisabledReason('elaborated', false, null)).toBe('Run Elaborate first.')
    expect(promptModeDisabledReason('elaborated', true, null)).toBeNull()
  })

  it('blocks brainstorm modes until elaborators are picked', () => {
    expect(promptModeDisabledReason('fresh-iteration', false, 'style')).toBe('Pick a style elaborator first.')
    expect(promptModeDisabledReason('fresh-task', false, 'content')).toBe('Pick a content elaborator first.')
    expect(promptModeDisabledReason('fresh-iteration', false, null)).toBeNull()
  })

  it('never blocks the as-is mode', () => {
    expect(promptModeDisabledReason('as-is', false, 'content')).toBeNull()
  })
})

describe('queueDisabledReason', () => {
  it('requires at least one target before anything else', () => {
    expect(queueDisabledReason('as-is', true, true, null, 0)).toBe('Select at least one target.')
  })

  it('requires a seed in as-is mode', () => {
    expect(queueDisabledReason('as-is', false, true, null, 1)).toBe('Seed prompt is empty.')
  })

  it('requires elaborated text in elaborated mode', () => {
    expect(queueDisabledReason('elaborated', true, false, null, 1)).toBe('Elaborated prompt is empty.')
  })

  it('requires elaborators then a seed in brainstorm modes', () => {
    expect(queueDisabledReason('fresh-task', false, false, 'content', 1)).toBe('Pick a content elaborator first.')
    expect(queueDisabledReason('fresh-iteration', false, false, null, 1)).toBe('Enter a seed prompt for elaboration.')
  })

  it('is null when the run is ready', () => {
    expect(queueDisabledReason('fresh-task', true, false, null, 4)).toBeNull()
    expect(queueDisabledReason('as-is', true, false, null, 1)).toBeNull()
  })
})

describe('computeAdvancedGates', () => {
  // A fully-ready, idle modal: every precondition satisfied, nothing running.
  const ready: AdvancedGatesInput = {
    activeOperation: null,
    seedFilled: true,
    elaboratedFilled: true,
    picks: allPicked,
    promptMode: 'fresh-task',
    totalTasks: 4,
  }

  it('enables all three action surfaces when idle and ready', () => {
    const gates = computeAdvancedGates(ready)
    expect(gates.busy).toBe(false)
    expect(gates.elaborate.disabled).toBe(false)
    expect(gates.queue.disabled).toBe(false)
    expect(gates.history.disabled).toBe(false)
  })

  // The regression this module exists to prevent: while one operation runs, the
  // OTHER button (and the history) must not be clickable — otherwise a second
  // run can be started against the single brainstorm engine.
  it('disables Elaborate, Queue, AND history while an elaborate run is in flight', () => {
    const gates = computeAdvancedGates({ ...ready, activeOperation: 'elaborate' })
    expect(gates.busy).toBe(true)
    expect(gates.elaborate.disabled).toBe(true)
    expect(gates.queue.disabled).toBe(true)
    expect(gates.history.disabled).toBe(true)
  })

  it('disables Elaborate, Queue, AND history while a queue run is in flight', () => {
    const gates = computeAdvancedGates({ ...ready, activeOperation: 'queue' })
    expect(gates.busy).toBe(true)
    expect(gates.elaborate.disabled).toBe(true)
    expect(gates.queue.disabled).toBe(true)
    expect(gates.history.disabled).toBe(true)
  })

  it('suppresses precondition tooltips while busy', () => {
    // Idle: the precondition reason surfaces as a tooltip.
    const idle = computeAdvancedGates({ ...ready, seedFilled: false, totalTasks: 0, activeOperation: null })
    expect(idle.elaborate.reason).toBe('Enter a seed prompt above.')
    expect(idle.queue.reason).toBe('Select at least one target.')
    // Busy: a mid-operation disable is self-explanatory, so no stale hint.
    const busy = computeAdvancedGates({ ...ready, seedFilled: false, totalTasks: 0, activeOperation: 'queue' })
    expect(busy.elaborate.reason).toBeNull()
    expect(busy.queue.reason).toBeNull()
  })

  it('reflects each control’s own precondition reason when idle', () => {
    const gates = computeAdvancedGates({
      activeOperation: null,
      seedFilled: true,
      elaboratedFilled: false,
      picks: { content: true, composition: false, style: false },
      promptMode: 'elaborated',
      totalTasks: 1,
    })
    expect(gates.missingElaboratorKind).toBe('composition')
    expect(gates.elaborate.disabled).toBe(true)
    expect(gates.elaborate.reason).toBe('Pick a composition elaborator first.')
    expect(gates.queue.disabled).toBe(true)
    expect(gates.queue.reason).toBe('Elaborated prompt is empty.')
    expect(gates.history.disabled).toBe(false)
  })
})
