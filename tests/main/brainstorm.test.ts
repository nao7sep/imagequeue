import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brainstormPrompts, cancelBrainstorm, hasActiveBrainstorms } from '../../src/main/brainstorm'
import { closeConceptStore, listConceptRows, listFacetsWithStats } from '../../src/main/concepts/concept-store'
import { getElaborator } from '../../src/main/elaborators'
import { getMainProvider } from '../../src/main/text-ai'
import type { AskOptions, AskResult, TextAIProvider } from '../../src/main/text-ai'
import type { Elaborator, ElaboratorKind } from '../../src/shared/types'

// Integration tests: the real orchestrator against the REAL concept store (a
// throwaway IMAGEQUEUE_HOME) and a scripted provider that answers each planning
// ask by its message markers. What is pinned here is the mechanism itself:
// every prose call runs in a FRESH context (the attractor kill), no concept
// value is assigned twice within a session, and a use is recorded only for
// prompts that actually came back.

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../../src/main/elaborators', () => ({ getElaborator: vi.fn() }))
vi.mock('../../src/main/text-ai', () => ({ getMainProvider: vi.fn() }))
vi.mock('../../src/main/session', () => ({ getSessionId: () => 'test-session' }))
const mockKnobs = vi.hoisted(() => ({ concurrency: 1 }))
vi.mock('../../src/main/text-ai/templates', () => ({
  PROMPTS_RESPONSE_SCHEMA: { marker: 'prompts' },
  fillTemplate: (template: string, values: Record<string, string>) =>
    Object.entries(values).reduce((out, [key, value]) => out.split(`{{${key}}}`).join(value), template),
  getRuntimeBrainstormConfig: () => ({
    batch_size: 2,
    concurrency: mockKnobs.concurrency,
    max_retries_per_turn: 0,
    retry_backoff_ms: [],
    prefer_new_concepts: false,
    templates: {
      expansion: 'exp|{{FORMAT}}|{{SEED}}|{{N}}\n{{CONCEPTS}}',
    },
    format_directives: {
      formats: { sentences: 'FMT(sentences)', phrases: 'FMT(phrases)' },
      lengths: { short: 'LEN(short)', medium: 'LEN(medium)', long: 'LEN(long)' },
    },
  }),
}))

const ENV_VAR = 'IMAGEQUEUE_HOME'

const elaboratorFor = (kind: ElaboratorKind): Elaborator => ({
  id: kind, kind, name: kind, template: kind,
})

interface ScriptOptions {
  /** Prompts returned per expansion call; defaults to exactly what was asked. */
  promptsPerCall?: (asked: number, call: number) => number
  /** Hook running before each PROSE call resolves (planning calls excluded). */
  onProseCall?: (call: number) => void
  /** Probes yielded per generation ask; default 12. */
  probesPerGeneration?: number
  /** Per-prose-call artificial latency in ms (drives the concurrency tests). */
  proseDelayMs?: (call: number) => number
}

interface Script {
  ask: ReturnType<typeof vi.fn>
  /** Every message list a prose (expansion) call received. */
  proseCalls: { messages: AskOptions['messages']; text: string }[]
  /** The concept assignment lines each prose call carried. */
  assignmentLines: () => string[]
  /** The most prose calls ever simultaneously in flight. */
  maxProseInFlight: () => number
}

// A provider that recognizes each planning ask by its structural marker and
// returns generated-on-demand, never-repeating planning data — so any repeated
// concept the orchestrator produces is the orchestrator's fault, not the fake's.
function installScriptedProvider(opts: ScriptOptions = {}): Script {
  let probeCounter = 0
  let conceptCounter = 0
  let proseCounter = 0
  let proseInFlight = 0
  let maxInFlight = 0
  const proseCalls: Script['proseCalls'] = []
  const ask = vi.fn(async (options: AskOptions): Promise<AskResult> => {
    const text = options.messages[options.messages.length - 1].text
    if (text.includes('<existing_aspects>')) {
      return { text: '', parsed: { facets: ['place', 'occupation'] } }
    }
    if (text.includes('<existing_domains>')) {
      const probes = Array.from(
        { length: opts.probesPerGeneration ?? 12 },
        () => `domain ${++probeCounter}`
      )
      return { text: '', parsed: { probes } }
    }
    if (text.includes('<domains>')) {
      const domains = [...text.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1])
      const clusters = domains.map((domain) => ({
        domain,
        concepts: Array.from({ length: 12 }, () => `concept ${++conceptCounter}`),
      }))
      return { text: '', parsed: { clusters } }
    }
    // Prose call: "exp|...|N" followed by assignment lines.
    proseCounter++
    const call = proseCounter
    opts.onProseCall?.(call)
    proseCalls.push({ messages: options.messages, text })
    proseInFlight++
    maxInFlight = Math.max(maxInFlight, proseInFlight)
    const delay = opts.proseDelayMs?.(call) ?? 0
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    proseInFlight--
    const asked = Number(text.split('\n')[0].split('|').pop())
    const produce = opts.promptsPerCall?.(asked, call) ?? asked
    return {
      text: '',
      parsed: { prompts: Array.from({ length: produce }, (_, i) => `prompt ${call}-${i + 1}`) },
    }
  })
  const provider: TextAIProvider = { ask }
  vi.mocked(getMainProvider).mockReturnValue({
    provider, timeoutMs: 1000, backend: 'openai', modelId: 'm',
  })
  return {
    ask,
    proseCalls,
    assignmentLines: () =>
      proseCalls.flatMap((c) => c.text.split('\n').filter((line) => /^\d+\. /.test(line))),
    maxProseInFlight: () => maxInFlight,
  }
}

const request = (over: { requestId: string; count: number }): Parameters<typeof brainstormPrompts>[0] => ({
  requestId: over.requestId,
  contentElaboratorId: 'content',
  compositionElaboratorId: 'composition',
  styleElaboratorId: 'style',
  seed: 'a mysterious man',
  count: over.count,
  format: 'phrases',
  length: 'medium',
})

describe('brainstormPrompts (concept-driven)', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-brainstorm-'))
    process.env[ENV_VAR] = tmpRoot
    mockKnobs.concurrency = 1
    vi.mocked(getElaborator).mockImplementation((id: string) =>
      id === 'content' || id === 'composition' || id === 'style'
        ? elaboratorFor(id as ElaboratorKind)
        : null
    )
  })

  afterEach(() => {
    closeConceptStore()
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('produces the requested count across batches', async () => {
    const script = installScriptedProvider()
    const result = await brainstormPrompts(request({ requestId: 'r1', count: 3 }))
    expect(result.prompts).toHaveLength(3)
    // batch_size 2 → two prose calls (2 + 1)
    expect(script.proseCalls).toHaveLength(2)
  })

  it('sends every prose call with a FRESH context: one user message, no history', async () => {
    const script = installScriptedProvider()
    await brainstormPrompts(request({ requestId: 'r2', count: 4 }))
    expect(script.proseCalls.length).toBeGreaterThan(1)
    for (const call of script.proseCalls) {
      expect(call.messages).toHaveLength(1)
      expect(call.messages[0].role).toBe('user')
    }
  })

  it('injects the format directive into the expansion message', async () => {
    const script = installScriptedProvider()
    await brainstormPrompts(request({ requestId: 'r3', count: 1 }))
    expect(script.proseCalls[0].text).toContain('exp|FMT(phrases) LEN(medium)|a mysterious man|1')
  })

  it('never assigns the same concept value twice, within a run or across runs in one session', async () => {
    const script = installScriptedProvider()
    await brainstormPrompts(request({ requestId: 'r4', count: 3 }))
    await brainstormPrompts(request({ requestId: 'r5', count: 3 }))
    const values = script.assignmentLines().flatMap((line) =>
      line.replace(/^\d+\. /, '').split('; ').map((part) => part.split(': ')[1])
    )
    expect(values.length).toBe(6 * 2) // 6 prompts x 2 facets
    expect(new Set(values).size).toBe(values.length)
  })

  it('draws each value in a batch from a different cluster, before any use is recorded', async () => {
    // One probe per generation ask, so at the moment of the second draw exactly
    // one cluster exists and it still holds eligible values. Only the in-run
    // exclusion can force that draw into a freshly minted second cluster —
    // recorded uses cannot, because uses land after the prose call.
    installScriptedProvider({ probesPerGeneration: 1 })
    await brainstormPrompts(request({ requestId: 'rc', count: 2 }))
    for (const facet of listFacetsWithStats()) {
      const used = listConceptRows(facet.id).filter((r) => r.useCount > 0)
      expect(used).toHaveLength(2)
      expect(new Set(used.map((r) => r.probe)).size).toBe(2)
    }
  })

  it('runs a wave of prose calls concurrently when concurrency allows', async () => {
    mockKnobs.concurrency = 3
    const script = installScriptedProvider({ proseDelayMs: () => 5 })
    await brainstormPrompts(request({ requestId: 'rw', count: 6 }))
    // count 6 at batch 2 = 3 turns; all fired in one wave.
    expect(script.proseCalls).toHaveLength(3)
    expect(script.maxProseInFlight()).toBe(3)
  })

  it('assembles wave results in turn order even when turns finish out of order', async () => {
    mockKnobs.concurrency = 2
    // Turn 1 resolves SLOWER than turn 2; the collected list must still carry
    // turn 1's prompts first, because prompts map to assignments by position.
    installScriptedProvider({ proseDelayMs: (call) => (call === 1 ? 30 : 1) })
    const result = await brainstormPrompts(request({ requestId: 'ro', count: 4 }))
    expect(result.prompts).toEqual(['prompt 1-1', 'prompt 1-2', 'prompt 2-1', 'prompt 2-2'])
  })

  it('plans the facets concurrently, not one after another', async () => {
    // On a cold ledger every facet must mint before the first draw. Each facet
    // chain runs synchronously up to its first planning await, so concurrent
    // chains issue BOTH facets' domain-generation asks before either expansion
    // ask; a sequential loop would finish facet 1's whole chain first.
    const script = installScriptedProvider()
    await brainstormPrompts(request({ requestId: 'rp', count: 1 }))
    const kinds = script.ask.mock.calls
      .map((c) => {
        const text = (c[0] as AskOptions).messages.at(-1)!.text
        if (text.includes('<existing_aspects>')) return 'resolve'
        if (text.includes('<existing_domains>')) return 'generate'
        if (text.includes('<domains>')) return 'expand'
        return 'prose'
      })
    expect(kinds.slice(0, 3)).toEqual(['resolve', 'generate', 'generate'])
  })

  // The planning asks must be sized to the RUN, not to a fixed ceiling: a small
  // run that mined a 300-prompt bank would spend tokens on concepts nothing
  // reaches for months (one sibling per cluster is drawable per window).
  it('sizes the domain ask to what the run still needs', async () => {
    const script = installScriptedProvider()
    await brainstormPrompts(request({ requestId: 'rs', count: 2 }))
    const generateAsks = script.ask.mock.calls
      .map((c) => (c[0] as AskOptions).messages.at(-1)!.text)
      .filter((text) => text.includes('<existing_domains>'))
    expect(generateAsks.length).toBeGreaterThan(0)
    // 2 values still needed -> a modest surplus of 4, never the 48 ceiling.
    for (const ask of generateAsks) {
      expect(ask).toContain('List 4 narrow domains')
    }
  })

  it('records a use only for prompts that actually came back', async () => {
    installScriptedProvider({ promptsPerCall: (asked, call) => (call === 1 ? asked - 1 : asked) })
    const result = await brainstormPrompts(request({ requestId: 'r6', count: 2 }))
    expect(result.prompts).toHaveLength(2)
    const stats = listFacetsWithStats()
    const used = stats.reduce((n, f) => n + (f.conceptCount - f.unusedCount), 0)
    // 2 prompts x 2 facets — the assignment whose prompt never came back is NOT used.
    expect(used).toBe(4)
  })

  it('stops at the batch boundary once cancelled and keeps what it collected', async () => {
    installScriptedProvider({ onProseCall: (call) => { if (call === 1) cancelBrainstorm('r7') } })
    const result = await brainstormPrompts(request({ requestId: 'r7', count: 6 }))
    expect(result.prompts).toHaveLength(2)
  })

  it('clears the active flag on success, failure, and cancellation', async () => {
    installScriptedProvider()
    await brainstormPrompts(request({ requestId: 'r8', count: 1 }))
    expect(hasActiveBrainstorms()).toBe(false)

    const failing = vi.fn(async (): Promise<AskResult> => { throw new Error('boom') })
    vi.mocked(getMainProvider).mockReturnValue({
      provider: { ask: failing } as TextAIProvider, timeoutMs: 1000, backend: 'openai', modelId: 'm',
    })
    await expect(brainstormPrompts(request({ requestId: 'r9', count: 1 }))).rejects.toThrow('boom')
    expect(hasActiveBrainstorms()).toBe(false)
  })

  it('is true while a run is in flight (the wake-lock signal)', async () => {
    let release!: () => void
    const hung = vi.fn(
      () => new Promise<AskResult>((resolve) => {
        release = () => resolve({ text: '', parsed: { facets: ['place'] } })
      })
    )
    vi.mocked(getMainProvider).mockReturnValue({
      provider: { ask: hung } as TextAIProvider, timeoutMs: 1000, backend: 'openai', modelId: 'm',
    })
    const pending = brainstormPrompts(request({ requestId: 'busy', count: 1 }))
    try {
      expect(hasActiveBrainstorms()).toBe(true)
    } finally {
      cancelBrainstorm('busy')
      release()
      await pending
    }
    expect(hasActiveBrainstorms()).toBe(false)
  })
})
