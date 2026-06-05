import { beforeEach, describe, expect, it, vi } from 'vitest'
import { brainstormPrompts, cancelBrainstorm } from '../../src/main/brainstorm'
import { getElaborator } from '../../src/main/elaborators'
import { getMainProvider } from '../../src/main/text-ai'
import type { AskOptions, AskResult, TextAIProvider } from '../../src/main/text-ai'
import type { Elaborator, ElaboratorKind } from '../../src/shared/types'

// brainstorm.ts imports electron for broadcasting progress; stub it so progress
// is a no-op in the node test env.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../../src/main/elaborators', () => ({ getElaborator: vi.fn() }))
vi.mock('../../src/main/text-ai', () => ({ getMainProvider: vi.fn() }))

// One prompt per turn (batch_size 1) and no retries, so a brainstorm of N runs
// exactly N turns — letting us observe cancellation taking effect at a turn
// boundary. Templates are pass-through.
vi.mock('../../src/main/text-ai/templates', () => ({
  PROMPTS_RESPONSE_SCHEMA: {},
  fillTemplate: (template: string) => template,
  getRuntimeBrainstormConfig: () => ({
    batch_size: 1,
    max_retries_per_turn: 0,
    retry_backoff_ms: [],
    templates: { first_no_previous: '', first_with_previous: '', continuation: '' },
  }),
}))

const elaboratorFor = (kind: ElaboratorKind): Elaborator => ({
  id: kind, kind, name: kind, template: kind,
})

// Builds a provider whose ask() returns `p1`, `p2`, … and optionally invokes a
// side effect (e.g. cancelling) on a given call number.
function installProvider(onCall?: (call: number) => void): { ask: ReturnType<typeof vi.fn> } {
  let calls = 0
  const ask = vi.fn(async (_opts: AskOptions): Promise<AskResult> => {
    calls += 1
    onCall?.(calls)
    return { text: '', parsed: { prompts: [`p${calls}`] } }
  })
  const provider: TextAIProvider = { ask }
  vi.mocked(getMainProvider).mockReturnValue({
    provider, timeoutMs: 1000, backend: 'openai', modelId: 'm',
  })
  return { ask }
}

const request = (over: { requestId: string; count: number }): Parameters<typeof brainstormPrompts>[0] => ({
  requestId: over.requestId,
  contentElaboratorId: 'content',
  compositionElaboratorId: 'composition',
  styleElaboratorId: 'style',
  seed: 'a cat',
  count: over.count,
  previousPrompts: [],
})

describe('brainstormPrompts cancellation', () => {
  beforeEach(() => {
    vi.mocked(getElaborator).mockImplementation((id: string) =>
      id === 'content' || id === 'composition' || id === 'style'
        ? elaboratorFor(id as ElaboratorKind)
        : null
    )
  })

  it('collects all requested prompts when never cancelled', async () => {
    const { ask } = installProvider()
    const result = await brainstormPrompts(request({ requestId: 'r1', count: 3 }))
    expect(result.prompts).toEqual(['p1', 'p2', 'p3'])
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('stops at the next turn boundary once cancelled mid-run', async () => {
    // Cancel during the 2nd turn; the loop checks before turn 3 and breaks.
    const { ask } = installProvider((call) => { if (call === 2) cancelBrainstorm('r2') })
    const result = await brainstormPrompts(request({ requestId: 'r2', count: 5 }))
    expect(result.prompts).toEqual(['p1', 'p2'])
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('clears the cancelled id after the run, so reusing it does not pre-cancel', async () => {
    // First run is cancelled after turn 1.
    installProvider((call) => { if (call === 1) cancelBrainstorm('r3') })
    const first = await brainstormPrompts(request({ requestId: 'r3', count: 4 }))
    expect(first.prompts).toEqual(['p1'])

    // Same id reused: the finally cleanup removed it from the registry, so this
    // run completes fully instead of stopping immediately.
    const { ask } = installProvider()
    const second = await brainstormPrompts(request({ requestId: 'r3', count: 2 }))
    expect(second.prompts).toEqual(['p1', 'p2'])
    expect(ask).toHaveBeenCalledTimes(2)
  })
})
