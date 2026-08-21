import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brainstormPrompts, cancelBrainstorm, hasActiveBrainstorms } from '../../src/main/brainstorm'
import { listProbesWithStats, closeConceptStore, listConceptRows, listFacetsWithStats } from '../../src/main/concepts/concept-store'
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
// The log is the only window into a run that costs real money to watch, so what
// it says is part of the contract, not decoration.
const logCalls = vi.hoisted(
  () => [] as { level: string; message: string; data: Record<string, unknown> }[],
)
vi.mock('../../src/main/logger', () => ({
  log: (level: string, message: string, data: Record<string, unknown> = {}) => {
    logCalls.push({ level, message, data })
  },
  serializeError: (err: unknown) => ({ message: String(err) }),
}))
const logged = (message: string): Record<string, unknown>[] =>
  logCalls.filter((c) => c.message === message).map((c) => c.data)
const mockKnobs = vi.hoisted(() => ({ concurrency: 1, maxRetries: 0, backoffMs: [] as number[] }))
vi.mock('../../src/main/text-ai/templates', () => ({
  PROMPTS_RESPONSE_SCHEMA: { marker: 'prompts' },
  fillTemplate: (template: string, values: Record<string, string>) =>
    Object.entries(values).reduce((out, [key, value]) => out.split(`{{${key}}}`).join(value), template),
  getRuntimeBrainstormConfig: () => ({
    batch_size: 2,
    concurrency: mockKnobs.concurrency,
    max_retries_per_turn: mockKnobs.maxRetries,
    retry_backoff_ms: mockKnobs.backoffMs,
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
  /** Replaces a prose reply outright — used to stage an unusable payload. */
  proseReplacement?: (call: number) => AskResult
  /** When it returns true for an expansion call, every cluster comes back empty. */
  emptyClustersOnCall?: (expansionCall: number) => boolean
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
  let expansionCounter = 0
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
      expansionCounter++
      const domains = [...text.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1])
      const empty = opts.emptyClustersOnCall?.(expansionCounter) ?? false
      const clusters = domains.map((domain) => ({
        domain,
        concepts: empty ? [] : Array.from({ length: 12 }, () => `concept ${++conceptCounter}`),
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
    const replaced = opts.proseReplacement?.(call)
    if (replaced) return replaced
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
    mockKnobs.maxRetries = 0
    mockKnobs.backoffMs = []
    logCalls.length = 0
    vi.mocked(getElaborator).mockImplementation((id: string) =>
      id === 'composition' || id === 'style'
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
    expect(result.prompts.map((p) => p.text)).toEqual(['prompt 1-1', 'prompt 1-2', 'prompt 2-1', 'prompt 2-2'])
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

  // Uses commit only when prompts are DELIVERED. Recording incrementally burnt
  // earlier waves' values when a later wave failed: the run threw, the caller
  // kept nothing, yet the window blocked those values for 1000 draws.
  it('a failed run records no uses at all, even for waves that succeeded first', async () => {
    mockKnobs.concurrency = 1
    let call = 0
    installScriptedProvider({
      onProseCall: () => {
        call++
        if (call === 2) throw new Error('second wave dies')
      },
    })
    // batch_size 2 → count 4 = two waves; wave 1 succeeds, wave 2 throws.
    await expect(brainstormPrompts(request({ requestId: 'burn1', count: 4 }))).rejects.toThrow('second wave dies')
    const used = listFacetsWithStats().reduce((n, f) => n + (f.conceptCount - f.unusedCount), 0)
    expect(used).toBe(0)
  })

  // A domain-expansion reply with NOTHING in it is a failed call, not a set of
  // dud domains: burning those probes as "expanded" would consume the facet's
  // supply on every bad model day, invisibly.
  it('does not burn domains when a whole expansion reply is empty', async () => {
    let expansions = 0
    installScriptedProvider({
      emptyClustersOnCall: () => {
        expansions++
        return expansions === 1
      },
    })
    const result = await brainstormPrompts(request({ requestId: 'burn2', count: 1 }))
    expect(result.prompts).toHaveLength(1)
    // The discriminating corpse: burning would leave probes marked expanded
    // with zero concepts. The fix retries the same batch instead, so every
    // expanded probe carries the concepts its (retried) call returned.
    for (const facet of listFacetsWithStats()) {
      const burnt = listProbesWithStats(facet.id).filter((probe) => probe.expanded && probe.conceptCount === 0)
      expect(burnt).toEqual([])
    }
    expect(expansions).toBeGreaterThanOrEqual(2)
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

  it('cancels immediately during retry backoff and starts no later request', async () => {
    mockKnobs.maxRetries = 2
    mockKnobs.backoffMs = [60_000]
    let proseAttempts = 0
    installScriptedProvider({
      onProseCall: () => {
        proseAttempts++
        if (proseAttempts === 1) throw new Error('retry me')
      },
    })

    const pending = brainstormPrompts(request({ requestId: 'backoff-cancel', count: 1 }))
    while (logged('Brainstorm call failed, retrying').length === 0) await Promise.resolve()
    cancelBrainstorm('backoff-cancel')

    await expect(pending).resolves.toEqual({ prompts: [] })
    expect(proseAttempts).toBe(1)
    expect(hasActiveBrainstorms()).toBe(false)
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

  // A concept run is mostly invisible: it spends minutes on planning calls
  // before a single prompt exists, and the only record of what it drew from,
  // minted, or fell back to is the log. These pin the numbers that answer
  // "why did this run take so long" and "why did that concept come back".
  // The record no amount of reading the prose recovers: WHICH ledger values
  // grounded each prompt. The renderer stores these in the session history so
  // the Prompts list can show them; if they drift out of alignment with the
  // assignments the prose calls actually carried, the display lies.
  it('returns each prompt with the exact concept assignment that grounded it', async () => {
    const script = installScriptedProvider()
    const result = await brainstormPrompts(request({ requestId: 'credit1', count: 3 }))

    expect(result.prompts).toHaveLength(3)
    const lines = script.assignmentLines()
    result.prompts.forEach((record, i) => {
      // Assignment line i reads "n. place: X; occupation: Y" — the credits must
      // be the same pairs, in facet order.
      const pairs = lines[i].replace(/^\d+\. /, '').split('; ')
      expect(record.concepts.map((c) => `${c.facet}: ${c.concept}`)).toEqual(pairs)
    })
    // Every credit names a real drawn value, and none repeats across prompts.
    const values = result.prompts.flatMap((r) => r.concepts.map((c) => c.concept))
    expect(new Set(values).size).toBe(values.length)
  })

  describe('what the log records', () => {
    it('reports the ledger it started from and what it holds at the end', async () => {
      installScriptedProvider()
      await brainstormPrompts(request({ requestId: 'log1', count: 3 }))

      const [started] = logged('Brainstorm started')
      expect(started.requested).toBe(3)
      expect(started.ledger).toEqual({ facets: 0, domains: 0, concepts: 0, unused: 0 })

      const [complete] = logged('Brainstorm complete')
      const ledger = complete.ledger as Record<string, number>
      expect(ledger.facets).toBe(2)
      expect(ledger.concepts).toBeGreaterThan(0)
      // Two facets x three prompts, and a use recorded for each.
      expect(complete.concepts).toMatchObject({ draws: 6 })
    })

    it('names the aspects, and which of them the ledger had never seen', async () => {
      installScriptedProvider()
      await brainstormPrompts(request({ requestId: 'log2', count: 1 }))
      const [first] = logged('Concept aspects resolved')
      expect(first.aspects).toEqual(['place', 'occupation'])
      expect(first.newAspects).toEqual(['place', 'occupation'])

      logCalls.length = 0
      await brainstormPrompts(request({ requestId: 'log3', count: 1 }))
      const [second] = logged('Concept aspects resolved')
      expect(second.aspects).toEqual(['place', 'occupation'])
      // Second run: the same aspects, none of them new.
      expect(second.newAspects).toEqual([])
    })

    it('reports every mint with what it asked for and what it added', async () => {
      installScriptedProvider()
      await brainstormPrompts(request({ requestId: 'log4', count: 1 }))
      const mints = logged('Minted concepts')
      // One per facet: an empty ledger cannot answer the first draw.
      expect(mints).toHaveLength(2)
      for (const mint of mints) {
        expect(mint.domainsGenerated).toBeGreaterThan(0)
        expect(mint.domainsExpanded).toBeGreaterThan(0)
        expect(mint.conceptsAdded).toBeGreaterThan(0)
        expect(typeof mint.durationMs).toBe('number')
      }
    })

    it('carries per-aspect stock, not just a grand total', async () => {
      installScriptedProvider()
      await brainstormPrompts(request({ requestId: 'log5', count: 2 }))
      const [complete] = logged('Brainstorm complete')
      const inventory = complete.inventory as Record<string, number>[]
      expect(inventory.map((row) => row.facet)).toEqual(['place', 'occupation'])
      for (const row of inventory) {
        expect(row.concepts).toBeGreaterThan(0)
        expect(row.domains).toBeGreaterThan(0)
        // Two prompts drew two values from this facet, so two are now spent.
        expect(row.unused).toBe(row.concepts - 2)
      }
    })

    // Planning and prose share one retry path. Without the label a retry line
    // cannot say whether an aspects ask or a prose turn is the one struggling,
    // and those have entirely different causes.
    it('says which call is being retried, and summarizes the reply it rejected', async () => {
      mockKnobs.maxRetries = 1
      let proseAttempts = 0
      installScriptedProvider({
        onProseCall: () => {
          proseAttempts++
          // First prose attempt returns something the schema cannot use.
          if (proseAttempts === 1) throw new Error('boom')
        },
      })
      await brainstormPrompts(request({ requestId: 'log7', count: 1 })).catch(() => undefined)
      const retries = logged('Brainstorm call failed, retrying')
      expect(retries.length).toBeGreaterThan(0)
      expect(retries[0].call).toBe('prose')
      expect(retries[0].requestId).toBe('log7')
    })

    it('keeps a bounded preview of an unusable reply, never the whole thing', async () => {
      const long = 'Sure! Here you go:\n\n'.repeat(200)
      installScriptedProvider({ proseReplacement: () => ({ text: long, parsed: { nope: true } }) })
      await brainstormPrompts(request({ requestId: 'log8', count: 1 })).catch(() => undefined)
      const [rejected] = logged('Brainstorm call returned no usable payload')
      expect(rejected.call).toBe('prose')
      expect(rejected.replyChars).toBe(long.length)
      // Bounded, and far short of the reply itself.
      expect(String(rejected.replyPreview).length).toBeLessThan(300)
      expect(rejected.previewTruncated).toBe(true)
      expect(rejected).not.toHaveProperty('rawText')
    })

    it('labels each planning call so the boundary crossings can be told apart', async () => {
      installScriptedProvider()
      await brainstormPrompts(request({ requestId: 'log6', count: 1 }))
      const calls = logged('Planning call finished').map((d) => d.call)
      expect(calls).toContain('aspects')
      expect(calls).toContain('domains')
      expect(calls).toContain('clusters')
    })
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
