import { BrowserWindow } from 'electron'
import type { BrainstormPhase, ElaboratedPromptRecord } from '../shared/types'
import { getElaborator } from './elaborators'
import { getMainProvider } from './text-ai'
import {
  PROMPTS_RESPONSE_SCHEMA,
  fillTemplate,
  getRuntimeBrainstormConfig,
} from './text-ai/templates'
import { getSessionId } from './session'
import {
  CONCEPT_REUSE_WINDOW_DRAWS,
  addConcepts,
  addProbes,
  drawConcept,
  ensureFacet,
  listFacetDisplays,
  listFacetsWithStats,
  listProbeDisplays,
  markProbeExpanded,
  recordUse,
  unexpandedProbes,
  type DrawnConcept,
  type FacetRow,
} from './concepts/concept-store'
import {
  expandProbes,
  generateProbes,
  planProbeBatchSize,
  planProbeGenerationSize,
  resolveFacets,
  type AskJson,
} from './concepts/planner'
import type { ConversationMessage, TextAIProvider } from './text-ai'
import type { PromptFormat, PromptLength } from '../shared/session-draft'
import { log, serializeError } from './logger'
import { truncate } from '../shared/textCleanup'

/** How much of a rejected reply the log keeps. Long enough to recognize what
 *  came back — a markdown fence, an apology, a truncated object — and far short
 *  of storing the reply. */
const REJECTED_PAYLOAD_PREVIEW_GRAPHEMES = 200

export interface BrainstormRequest {
  requestId: string
  compositionElaboratorId: string
  styleElaboratorId: string
  seed: string
  count: number
  format: PromptFormat
  length: PromptLength
}

export interface BrainstormResult {
  /** Each prompt with the ledger assignment that grounded it — the renderer
   *  records these in the session history, so the Prompts list can show WHICH
   *  concepts a prompt was built from, not just the prose that came out. */
  prompts: ElaboratedPromptRecord[]
}

// Emitted to the renderer after every successful turn so it can show live
// progress. Prompts are not delivered here — the renderer takes the full set
// from brainstormPrompts' return value and persists it only once the run
// commits (its tasks are queued, or the single Elaborate result is accepted).
interface BrainstormProgress {
  requestId: string
  done: number
  total: number
  phase: BrainstormPhase
}

function broadcastProgress(progress: BrainstormProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('brainstorm:progress', progress)
  }
}

// AbortControllers for in-flight runs, keyed by requestId. cancelBrainstorm
// aborts the controller, which both halts the in-flight text-AI request
// (the signal is threaded into the SDK call) and stops the loop from starting
// another turn. brainstormPrompts registers its controller on entry and deletes
// it on exit, so a cancel arriving after a run finished is a harmless no-op.
const activeControllers = new Map<string, AbortController>()

export function cancelBrainstorm(requestId: string): void {
  activeControllers.get(requestId)?.abort()
}

// True while any brainstorm/elaboration run is in flight. A run registers its
// controller on entry and deletes it in a finally block, so this covers the
// whole duration — including retries and abort handling — and clears on
// success, failure, or cancel. Used by the wake lock: elaboration is a long
// run of sequential text-AI calls that holds no 'generating' task and starts no
// CLI job, so without this the machine could sleep mid-elaboration.
export function hasActiveBrainstorms(): boolean {
  return activeControllers.size > 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Scaffolding for the combined elaborator message: app-owned prompt text the user
// never edits (the elaborators themselves are theirs), named here beside
// STRICT_JSON_NUDGE rather than buried in the array that assembles the message.
// The contract the two elaborators are applied under. It lives HERE, stated
// once by the app, rather than being re-typed into every user-editable template
// — where it consumed a quarter of each one, competed with the actual
// instruction, and could be weakened by an edit. The safety line in particular
// was previously present in exactly one style template out of eighteen; as app
// contract it now covers every style.
const ELABORATOR_COMBINE_PREAMBLE = [
  'Apply the following direction to every prompt. Each is a list of concrete visual specifics:',
  'weave them into the description rather than listing them, and keep them consistent across the batch.',
  'Preserve explicit user intent and the assigned concepts throughout.',
  'Do not sexualize people beyond what the seed explicitly asks.',
].join(' ')

function buildCombinedElaboratorInstructions(parts: {
  composition: string
  style: string
}): string {
  return [
    ELABORATOR_COMBINE_PREAMBLE,
    '',
    '<composition_elaborator>',
    parts.composition,
    '</composition_elaborator>',
    '',
    '<style_elaborator>',
    parts.style,
    '</style_elaborator>',
  ].join('\n')
}

// Sent ahead of the user message on retry attempts. Models that wrapped the
// first response in prose or markdown fences typically obey this on the
// second pass, so the retry is meaningfully different from the first attempt
// rather than a blind resend.
const STRICT_JSON_NUDGE = 'Reply with valid JSON only — no prose, no markdown fences.'

// Accepts either the documented `{ prompts: string[] }` shape or a bare
// `string[]` (some OpenAI-compatible servers emit this when the prompt asks
// for "a list of N items" in JSON mode). Anything else returns [].
function extractPromptsFromParsed(parsed: unknown): string[] {
  const candidate = Array.isArray(parsed)
    ? parsed
    : (parsed as { prompts?: unknown } | null | undefined)?.prompts
  if (!Array.isArray(candidate)) return []
  return candidate.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
}

/** Which call a retry belongs to. Planning and prose share this path, so
 *  without it a retry line cannot say whether an aspects ask or a prose turn is
 *  the one struggling — and those have very different causes. */
type CallLabel = 'aspects' | 'domains' | 'clusters' | 'prose'

// One schema-forced JSON call with up to maxRetries retries. `validate` turns
// the parsed payload into the caller's value, or returns null to reject the
// attempt and retry — so a transport failure and an unusable payload follow the
// same backoff path. Throws the last error once retries are exhausted.
async function askJsonWithRetry<T>(
  provider: TextAIProvider,
  messages: ConversationMessage[],
  schema: object,
  timeoutMs: number,
  validate: (parsed: unknown, rawText: string) => T | null,
  maxRetries: number,
  backoffSchedule: number[],
  signal: AbortSignal,
  label: CallLabel,
  requestId: string
): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Once aborted, don't start or retry a request — the caller handles the abort.
    if (signal.aborted) break
    if (attempt > 0) {
      const backoff = backoffSchedule.length > 0
        ? backoffSchedule[Math.min(attempt - 1, backoffSchedule.length - 1)]
        : 1000
      log('warn', 'Brainstorm call failed, retrying', {
        requestId, call: label, attempt, backoff,
        error: serializeError(lastError),
      })
      await sleep(backoff)
    }
    try {
      // On retry, prepend a strict-JSON nudge to the most recent user message
      // without mutating the caller's conversation history.
      const effectiveMessages = attempt === 0
        ? messages
        : messages.map((msg, i) =>
            i === messages.length - 1 && msg.role === 'user'
              ? { ...msg, text: `${STRICT_JSON_NUDGE}\n\n${msg.text}` }
              : msg
          )
      const result = await provider.ask({
        messages: effectiveMessages,
        schema,
        timeoutMs,
        signal,
      })
      const value = validate(result.parsed, result.text)
      if (value === null) {
        // The reply is the only clue to why the schema was not met, so some of
        // it earns a place — but a whole model response is a dump, and the
        // logging conventions want a summary. Minified head plus the real
        // length: enough to recognize a fenced block or an apology, bounded.
        const preview = truncate(result.text ?? '', REJECTED_PAYLOAD_PREVIEW_GRAPHEMES)
        log('warn', 'Brainstorm call returned no usable payload', {
          requestId,
          call: label,
          attempt,
          replyChars: (result.text ?? '').length,
          replyPreview: preview.text,
          previewTruncated: preview.truncated,
        })
        throw new Error('Text AI returned no usable payload.')
      }
      return value
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Cancelled.'))
}

/**
 * The no-progress guard on minting: how many probe-expansion rounds a single
 * draw may trigger before the run reaches for a stale value or fails with a
 * clear error. Without a bound, a model that keeps returning concepts the
 * ledger already holds would loop forever — the hang the old accept-everything
 * loop never had to worry about.
 */
const MAX_REFILL_ROUNDS = 3

interface RunExcludes {
  concepts: Set<number>
  probes: Set<number>
}

/**
 * What one run did to the ledger, accumulated as it goes and reported once at
 * the end. Per-draw lines would scale with the prompt count, which the logging
 * conventions put at `debug`; these are the aggregate the `info` summary needs.
 */
interface RunStats {
  draws: number
  mints: number
  probesGenerated: number
  conceptsAdded: number
  staleFallbacks: number
}

function newRunStats(): RunStats {
  return { draws: 0, mints: 0, probesGenerated: 0, conceptsAdded: 0, staleFallbacks: 0 }
}

/** Ledger-wide totals: what the store holds across every facet, not just this
 *  run's. One query, taken only at run boundaries. */
function ledgerTotals(): { facets: number; domains: number; concepts: number; unused: number } {
  const all = listFacetsWithStats()
  return {
    facets: all.length,
    domains: all.reduce((n, f) => n + f.probeCount, 0),
    concepts: all.reduce((n, f) => n + f.conceptCount, 0),
    unused: all.reduce((n, f) => n + f.unusedCount, 0),
  }
}

/** Per-facet stock for the facets this run drew on — the numbers that explain
 *  why a run minted, or fell back to a stale value, or did neither. */
function facetInventory(facets: readonly FacetRow[]): Record<string, unknown>[] {
  const byId = new Map(listFacetsWithStats().map((f) => [f.id, f]))
  return facets.map((facet) => {
    const stats = byId.get(facet.id)
    return {
      facet: facet.display,
      concepts: stats?.conceptCount ?? 0,
      unused: stats?.unusedCount ?? 0,
      domains: stats?.probeCount ?? 0,
    }
  })
}

/**
 * Produce `count` values for one facet, minting as needed. Facets are
 * independent — separate concept rows, separate clusters, separate excludes —
 * so the orchestrator runs one of these per facet CONCURRENTLY: planning-call
 * latency is dominated by fixed per-call overhead, and stacking four facets'
 * minting sequentially would quadruple it for nothing. SQLite writes are
 * synchronous (DatabaseSync), so concurrent facets interleave between
 * statements, never inside one; the one shared surface, the uses window, moves
 * only in recordUse, which runs after the prose call — never during this.
 */
async function obtainConceptsForFacet(
  facet: FacetRow,
  ask: AskJson,
  sessionId: string,
  preferNew: boolean,
  excludes: RunExcludes,
  count: number,
  requestId: string,
  stats: RunStats
): Promise<DrawnConcept[]> {
  const out: DrawnConcept[] = []
  const mintsBefore = stats.mints
  for (let i = 0; i < count; i++) {
    const concept = await obtainConcept(
      facet, ask, sessionId, preferNew, excludes, count - i, requestId, stats
    )
    excludes.concepts.add(concept.id)
    excludes.probes.add(concept.probeId)
    stats.draws++
    out.push(concept)
  }
  // One line per facet per wave, not per value: a 300-prompt run draws 1,200
  // values, which is the scale the conventions send to `debug` — and this is
  // the aggregate that answers "did this facet have to mint?".
  log('debug', 'Concepts drawn for facet', {
    requestId,
    facet: facet.display,
    drawn: count,
    mintedRounds: stats.mints - mintsBefore,
    values: out.map((c) => c.display),
  })
  return out
}

/**
 * Produce one usable value for a facet: draw from the ledger, and when nothing
 * is eligible, mint — generate probes if none await expansion, expand a batch
 * of probes into clusters, then draw again. Stale (outside-the-window) values
 * are the fallback of last resort when prefer-new minting yields nothing.
 */
async function obtainConcept(
  facet: FacetRow,
  ask: AskJson,
  sessionId: string,
  preferNew: boolean,
  excludes: RunExcludes,
  valuesStillNeeded: number,
  requestId: string,
  stats: RunStats
): Promise<DrawnConcept> {
  const baseOpts = {
    sessionId,
    windowDraws: CONCEPT_REUSE_WINDOW_DRAWS,
    excludeConceptIds: [...excludes.concepts],
    excludeProbeIds: [...excludes.probes],
  }
  const first = drawConcept(facet.id, { ...baseOpts, allowStale: !preferNew })
  if (first) return first

  for (let round = 0; round < MAX_REFILL_ROUNDS; round++) {
    // Mine only what this run still needs: a three-prompt run asks for three
    // domains, a long one still batches up to the ceiling.
    const mintStart = Date.now()
    let generated = 0
    let probes = unexpandedProbes(facet.id, planProbeBatchSize(valuesStillNeeded))
    if (probes.length === 0) {
      const requested = planProbeGenerationSize(valuesStillNeeded)
      const texts = await generateProbes(
        ask, facet.display, listProbeDisplays(facet.id), requested
      )
      generated = addProbes(facet.id, texts)
      stats.probesGenerated += generated
      probes = unexpandedProbes(facet.id, planProbeBatchSize(valuesStillNeeded))
      if (probes.length === 0) {
        // Not an error — the round is bounded and the next one tries again —
        // but it is the shape of a pool that is running out of new ground, and
        // silently retrying is how that stays invisible until the run fails.
        log('warn', 'Domain generation added nothing new', {
          requestId,
          facet: facet.display,
          round: round + 1,
          requested,
          returned: texts.length,
          alreadyKnown: texts.length - generated,
        })
        continue
      }
    }
    const clusters = await expandProbes(ask, facet.display, probes)
    let added = 0
    for (const { probeId, concepts } of clusters) {
      added += addConcepts(facet.id, probeId, concepts)
      markProbeExpanded(probeId)
    }
    stats.conceptsAdded += added
    stats.mints++
    // A boundary crossing (two planning calls) with an aggregate outcome, so
    // `info` — and it is the line that explains where a cold run's minutes go.
    log('info', 'Minted concepts', {
      requestId,
      facet: facet.display,
      round: round + 1,
      neededValues: valuesStillNeeded,
      domainsGenerated: generated,
      domainsExpanded: probes.length,
      conceptsAdded: added,
      durationMs: Date.now() - mintStart,
    })
    const fresh = drawConcept(facet.id, { ...baseOpts, allowStale: false })
    if (fresh) return fresh
  }

  const stale = drawConcept(facet.id, { ...baseOpts, allowStale: true })
  if (stale) {
    // The mechanism degraded to reuse. Not a failure — the value is outside the
    // window and unused this session — but it is the one event that says the
    // pool could not stay ahead of the run, which is exactly what a repeat
    // complaint would need to be traced back to.
    stats.staleFallbacks++
    log('warn', 'Fell back to a previously used concept', {
      requestId,
      facet: facet.display,
      afterRounds: MAX_REFILL_ROUNDS,
      concept: stale.display,
    })
    return stale
  }
  throw new Error(
    `Could not obtain an unused "${facet.display}" concept after ${MAX_REFILL_ROUNDS} refill rounds.`
  )
}

// Generate `count` prompts. Concept variety is enforced by construction, not
// instruction: the seed resolves once into facets (aspects); each prompt draws
// one never-spent value per facet from the concept ledger; and each batch of
// assignments expands into prose in a FRESH call carrying no conversation
// history — so there is no accumulated model output to imitate, which is the
// mechanism that made long runs collapse onto one repeated concept. A use is
// recorded only for prompts that actually come back.
//
// Returns the full set on success, or the prompts collected so far if the run
// is cancelled. On failure, throws the last error — the caller persists
// nothing for a run that didn't complete and queue its tasks.
export async function brainstormPrompts(req: BrainstormRequest): Promise<BrainstormResult> {
  if (req.count < 1) throw new Error('Count must be at least 1.')
  if (!req.seed.trim()) throw new Error('Seed prompt is empty.')

  const compositionElaborator = getElaborator(req.compositionElaboratorId)
  const styleElaborator = getElaborator(req.styleElaboratorId)
  if (!compositionElaborator || compositionElaborator.kind !== 'composition') {
    throw new Error('Composition elaborator not found.')
  }
  if (!styleElaborator || styleElaborator.kind !== 'style') {
    throw new Error('Style elaborator not found.')
  }

  const combinedElaboratorTemplate = buildCombinedElaboratorInstructions({
    composition: compositionElaborator.template,
    style: styleElaborator.template,
  })

  const handle = getMainProvider()
  if (!handle) throw new Error('Text AI is not configured.')

  const brainstormConfig = getRuntimeBrainstormConfig()
  // Surface-form directive substituted for {{FORMAT}} on every turn so adherence
  // doesn't drift across batches. Composed from the editable format + length
  // parts in config.format_directives, joined with a single space.
  const { formats, lengths } = brainstormConfig.format_directives
  const formatDirective = `${formats[req.format]} ${lengths[req.length]}`
  const batchSize = Math.max(1, brainstormConfig.batch_size)
  const concurrency = Math.max(1, brainstormConfig.concurrency)
  const maxRetries = Math.max(0, brainstormConfig.max_retries_per_turn)
  const preferNew = brainstormConfig.prefer_new_concepts === true

  const startTime = Date.now()
  const sessionId = getSessionId()
  const collected: ElaboratedPromptRecord[] = []
  let turn = 0

  const controller = new AbortController()
  activeControllers.set(req.requestId, controller)
  const stats = newRunStats()

  log('info', 'Brainstorm started', {
    requestId: req.requestId,
    requested: req.count,
    seedLength: req.seed.length,
    format: req.format,
    length: req.length,
    compositionElaborator: compositionElaborator.name,
    styleElaborator: styleElaborator.name,
    backend: handle.backend,
    model: handle.modelId,
    batchSize,
    concurrency,
    preferNew,
    ledger: ledgerTotals(),
  })

  // Planning calls share the prose calls' provider, retry policy, and abort
  // signal; validation is the planner's (it parses and throws on junk).
  // Every planning call crosses the same boundary, so it is logged in one
  // place rather than three. `debug`, not `info`: the outcome each call feeds
  // is already reported at `info` ("Concept aspects resolved", "Minted
  // concepts"), and this is the developer's view of the calls behind it.
  const ask: AskJson = async (messages, schema, label) => {
    const started = Date.now()
    log('debug', 'Planning call started', {
      requestId: req.requestId,
      call: label,
      promptChars: messages.reduce((n, m) => n + m.text.length, 0),
    })
    try {
      const parsed = await askJsonWithRetry(
        handle.provider, messages, schema, handle.timeoutMs,
        (p) => (p === null || p === undefined ? null : p),
        maxRetries, brainstormConfig.retry_backoff_ms, controller.signal,
        label, req.requestId
      )
      log('debug', 'Planning call finished', {
        requestId: req.requestId, call: label, durationMs: Date.now() - started,
      })
      return parsed
    } catch (err) {
      // Cancellation is the user's doing, not a failure of the call.
      if (controller.signal.aborted) throw err
      log('error', 'Planning call failed', {
        requestId: req.requestId,
        call: label,
        durationMs: Date.now() - started,
        error: serializeError(err),
      })
      throw err
    }
  }

  try {
    broadcastProgress({ requestId: req.requestId, done: 0, total: req.count, phase: 'facets' })
    const knownFacets = new Set(listFacetDisplays().map((d) => d.toLowerCase()))
    const facetNames = await resolveFacets(ask, req.seed, listFacetDisplays())
    const facets = facetNames.map((name) => ensureFacet(name))
    const newFacets = facetNames.filter((name) => !knownFacets.has(name.toLowerCase()))
    log('info', 'Concept aspects resolved', {
      requestId: req.requestId,
      aspects: facetNames,
      newAspects: newFacets,
      valuesNeededPerAspect: req.count,
      inventory: facetInventory(facets),
    })
    // Values and clusters drawn by this run, per facet. Draws are recorded as
    // uses only when their prompt comes back, so within the run these sets are
    // what keep a drawn-but-unrecorded value from being drawn twice.
    const excludesByFacet = new Map<number, RunExcludes>(
      facets.map((facet) => [facet.id, { concepts: new Set<number>(), probes: new Set<number>() }])
    )

    while (collected.length < req.count) {
      if (controller.signal.aborted) break
      // Plan a wave: up to `concurrency` turns of up to batchSize prompts each.
      const waveSizes: number[] = []
      let waveLeft = req.count - collected.length
      while (waveLeft > 0 && waveSizes.length < concurrency) {
        const size = Math.min(waveLeft, batchSize)
        waveSizes.push(size)
        waveLeft -= size
      }
      const waveTotal = waveSizes.reduce((a, b) => a + b, 0)
      turn += waveSizes.length

      // Draw EVERY assignment for the wave before any prose call fires. Draws
      // are the serialization point of the whole mechanism — synchronous store
      // reads guarded by the in-run excludes — so concurrent turns hold
      // disjoint assignments by construction, and the prose calls themselves
      // never touch the ledger. Each facet fills its column concurrently.
      broadcastProgress({
        requestId: req.requestId, done: collected.length, total: req.count, phase: 'concepts',
      })
      const perFacet = await Promise.all(
        facets.map((facet) =>
          obtainConceptsForFacet(
            facet, ask, sessionId, preferNew, excludesByFacet.get(facet.id)!, waveTotal,
            req.requestId, stats
          )
        )
      )
      const waveAssignments: { facet: FacetRow; concept: DrawnConcept }[][][] = []
      let offset = 0
      for (const size of waveSizes) {
        const start = offset
        waveAssignments.push(
          Array.from({ length: size }, (_, i) =>
            facets.map((facet, fi) => ({ facet, concept: perFacet[fi][start + i] }))
          )
        )
        offset += size
      }

      // Fire the wave. Progress accumulates as turns complete, in whatever
      // order they land; the results assemble in turn order below, so the
      // prompt list and the position mapping stay deterministic.
      let done = collected.length
      const settled = await Promise.allSettled(
        waveAssignments.map(async (assignments) => {
          const conceptsText = assignments
            .map((parts, i) => `${i + 1}. ${parts.map((p) => `${p.facet.display}: ${p.concept.display}`).join('; ')}`)
            .join('\n')
          const userMessage = fillTemplate(brainstormConfig.templates.expansion, {
            ELABORATOR: combinedElaboratorTemplate,
            FORMAT: formatDirective,
            SEED: req.seed,
            CONCEPTS: conceptsText,
            N: String(assignments.length),
          })
          // Fresh context on every turn: exactly one user message, never the
          // conversation so far. This is the attractor kill — nothing of the
          // model's own output is available for it to imitate.
          const newPrompts = await askJsonWithRetry(
            handle.provider,
            [{ role: 'user', text: userMessage }],
            PROMPTS_RESPONSE_SCHEMA,
            handle.timeoutMs,
            (parsed) => {
              const prompts = extractPromptsFromParsed(parsed)
              return prompts.length > 0 ? prompts : null
            },
            maxRetries, brainstormConfig.retry_backoff_ms, controller.signal,
            'prose', req.requestId
          )
          const kept = newPrompts.slice(0, assignments.length)
          done = Math.min(done + kept.length, req.count)
          broadcastProgress({ requestId: req.requestId, done, total: req.count, phase: 'prompts' })
          return { assignments, kept }
        })
      )

      // Assemble in TURN ORDER, keeping the ordered prefix of successes. A
      // failed turn drops any later fulfilled turns (their tokens are spent
      // but their values were never recorded as uses, so nothing is burnt);
      // prompts map to assignments by position, and a use is recorded only
      // for assignments whose prompt actually came back. An undercounting
      // turn leaves the outer loop to top up with a fresh wave.
      let failure: unknown = null
      for (const outcome of settled) {
        if (outcome.status === 'rejected') {
          failure = outcome.reason
          break
        }
        outcome.value.kept.forEach((text, i) => {
          const assignment = outcome.value.assignments[i]
          collected.push({
            text,
            concepts: assignment.map((part) => ({
              facet: part.facet.display,
              concept: part.concept.display,
            })),
          })
          for (const part of assignment) recordUse(part.concept.id, sessionId)
        })
      }
      if (failure !== null) {
        throw failure instanceof Error ? failure : new Error(String(failure))
      }

      // The prompts themselves persist in the session manifest's
      // `elaboratedPrompts` array — no need to duplicate them here.
      log('debug', 'Brainstorm wave complete', {
        requestId: req.requestId,
        turns: turn,
        collected: collected.length,
        requested: req.count,
      })
    }

    log('info', 'Brainstorm complete', {
      requestId: req.requestId,
      compositionElaborator: compositionElaborator.name,
      styleElaborator: styleElaborator.name,
      backend: handle.backend,
      model: handle.modelId,
      facets: facetNames,
      count: collected.length,
      requested: req.count,
      turns: turn,
      durationMs: Date.now() - startTime,
      concepts: stats,
      inventory: facetInventory(facets),
      ledger: ledgerTotals(),
    })
    return { prompts: collected.slice(0, req.count) }
  } catch (err) {
    // An aborted run rejects out of whichever call was in flight — planning or
    // prose. Treat it as cancellation: keep what was collected.
    if (controller.signal.aborted) {
      log('info', 'Brainstorm cancelled', {
        requestId: req.requestId,
        collected: collected.length,
        requested: req.count,
        turns: turn,
        durationMs: Date.now() - startTime,
        concepts: stats,
      })
      return { prompts: collected.slice(0, req.count) }
    }
    log('error', 'Brainstorm failed', {
      compositionElaborator: compositionElaborator.name,
      styleElaborator: styleElaborator.name,
      backend: handle.backend,
      model: handle.modelId,
      requested: req.count,
      collected: collected.length,
      turns: turn,
      durationMs: Date.now() - startTime,
      concepts: stats,
      ledger: ledgerTotals(),
      error: serializeError(err),
    })
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    activeControllers.delete(req.requestId)
  }
}
