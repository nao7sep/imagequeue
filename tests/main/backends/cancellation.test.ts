import { afterEach, describe, expect, it } from 'vitest'
import {
  addRun,
  generatingCount,
  isQueuePaused,
  laneWidth,
  removeRun,
  resetCancellationState,
  runCount,
  setQueuePaused,
  stopAllRuns,
  stopGenerations,
  type GenerationRun,
} from '../../../src/main/backends/cancellation'
import type { BackendId } from '../../../src/shared/types'

// The lanes hold every running generation. These tests pin what makes stopping
// possible — every run reachable while it can still be stopped, and nothing
// after its bytes arrive — and what quit waits for.

afterEach(() => resetCancellationState())

function run(backend: BackendId, done: Promise<void> = Promise.resolve()): GenerationRun {
  return { backend, generation: new AbortController(), naming: new AbortController(), cancellable: true, done }
}

describe('generation lanes', () => {
  it('counts each lane separately', () => {
    addRun('t1', run('openai'))
    addRun('t2', run('openai'))
    addRun('t3', run('flux'))
    expect(laneWidth('openai')).toBe(2)
    expect(laneWidth('flux')).toBe(1)
    expect(laneWidth('grok')).toBe(0)
    expect(runCount()).toBe(3)
    removeRun('t1')
    expect(laneWidth('openai')).toBe(1)
  })

  it('stops every cancellable run and counts what it signalled', () => {
    const a = run('openai'); const b = run('grok')
    addRun('t1', a); addRun('t2', b)
    expect(stopGenerations()).toBe(2)
    expect(a.generation.signal.aborted).toBe(true)
    expect(b.generation.signal.aborted).toBe(true)
  })

  // Once its bytes arrive a run is past a Stop's reach: a later "stop
  // everything" neither counts nor reaches it.
  it('leaves a run that is no longer cancellable alone', () => {
    const finished = run('openai')
    finished.cancellable = false
    addRun('t1', finished)
    expect(generatingCount()).toBe(0)
    expect(stopGenerations()).toBe(0)
    expect(finished.generation.signal.aborted).toBe(false)
  })

  it('makes quit wait for every run to save its outcome and aborts naming', async () => {
    let resolveDone!: () => void
    const naming = run('openai', new Promise<void>((resolve) => { resolveDone = resolve }))
    naming.cancellable = false
    addRun('t1', naming)

    let finished = false
    const waiting = stopAllRuns().then(() => { finished = true })
    await Promise.resolve()
    expect(naming.naming.signal.aborted).toBe(true)
    expect(naming.generation.signal.aborted).toBe(false)
    expect(finished).toBe(false)

    resolveDone()
    await waiting
    expect(finished).toBe(true)
  })
})

describe('queue pause flag', () => {
  it('starts unpaused and toggles', () => {
    expect(isQueuePaused()).toBe(false)
    setQueuePaused(true)
    expect(isQueuePaused()).toBe(true)
    setQueuePaused(false)
    expect(isQueuePaused()).toBe(false)
  })

  // Pausing must not touch running work: the whole point is that the current
  // image finishes and saves rather than being thrown away.
  it('does not stop anything in flight', () => {
    const running = run('openai')
    addRun('t1', running)
    setQueuePaused(true)
    expect(running.generation.signal.aborted).toBe(false)
    expect(generatingCount()).toBe(1)
  })
})
