import { BrowserWindow } from 'electron'
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

export interface BrainstormRequest {
  requestId: string
  contentElaboratorId: string
  compositionElaboratorId: string
  styleElaboratorId: string
  seed: string
  count: number
  format: PromptFormat
  length: PromptLength
}

export interface BrainstormResult {
  prompts: string[]
}

// Emitted to the renderer after every successful turn so it can show live
// progress. Prompts are not delivered here — the renderer takes the full set
// from brainstormPrompts' return value and persists it only once the run
// commits (its tasks are queued, or the single Elaborate result is accepted).
interface BrainstormProgress {
  requestId: string
  done: number
  total: number
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
const ELABORATOR_COMBINE_PREAMBLE =
  'Apply the following elaborator instruction sets in order. Preserve explicit user intent throughout.'

function buildCombinedElaboratorInstructions(parts: {
  content: string
  composition: string
  style: string
}): string {
  return [
    ELABORATOR_COMBINE_PREAMBLE,
    '',
    '<content_elaborator>',
    parts.content,
    '</content_elaborator>',
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
  signal: AbortSignal
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
        attempt, backoff,
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
        log('warn', 'Brainstorm call returned no usable payload', { rawText: result.text })
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
  count: number
): Promise<DrawnConcept[]> {
  const out: DrawnConcept[] = []
  for (let i = 0; i < count; i++) {
    const concept = await obtainConcept(facet, ask, sessionId, preferNew, excludes, count - i)
    excludes.concepts.add(concept.id)
    excludes.probes.add(concept.probeId)
    out.push(concept)
  }
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
  valuesStillNeeded: number
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
    let probes = unexpandedProbes(facet.id, planProbeBatchSize(valuesStillNeeded))
    if (probes.length === 0) {
      const texts = await generateProbes(
        ask, facet.display, listProbeDisplays(facet.id), planProbeGenerationSize(valuesStillNeeded)
      )
      addProbes(facet.id, texts)
      probes = unexpandedProbes(facet.id, planProbeBatchSize(valuesStillNeeded))
      // The model yielded no new probes; count the round and try again.
      if (probes.length === 0) continue
    }
    const clusters = await expandProbes(ask, facet.display, probes)
    for (const { probeId, concepts } of clusters) {
      addConcepts(facet.id, probeId, concepts)
      markProbeExpanded(probeId)
    }
    const fresh = drawConcept(facet.id, { ...baseOpts, allowStale: false })
    if (fresh) return fresh
  }

  const stale = drawConcept(facet.id, { ...baseOpts, allowStale: true })
  if (stale) return stale
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

  const contentElaborator = getElaborator(req.contentElaboratorId)
  const compositionElaborator = getElaborator(req.compositionElaboratorId)
  const styleElaborator = getElaborator(req.styleElaboratorId)
  if (!contentElaborator || contentElaborator.kind !== 'content') {
    throw new Error('Content elaborator not found.')
  }
  if (!compositionElaborator || compositionElaborator.kind !== 'composition') {
    throw new Error('Composition elaborator not found.')
  }
  if (!styleElaborator || styleElaborator.kind !== 'style') {
    throw new Error('Style elaborator not found.')
  }

  const combinedElaboratorTemplate = buildCombinedElaboratorInstructions({
    content: contentElaborator.template,
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
  const collected: string[] = []
  let turn = 0

  const controller = new AbortController()
  activeControllers.set(req.requestId, controller)

  // Planning calls share the prose calls' provider, retry policy, and abort
  // signal; validation is the planner's (it parses and throws on junk).
  const ask: AskJson = (messages, schema) =>
    askJsonWithRetry(
      handle.provider, messages, schema, handle.timeoutMs,
      (parsed) => (parsed === null || parsed === undefined ? null : parsed),
      maxRetries, brainstormConfig.retry_backoff_ms, controller.signal
    )

  try {
    const facetNames = await resolveFacets(ask, req.seed, listFacetDisplays())
    const facets = facetNames.map((name) => ensureFacet(name))
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
      const perFacet = await Promise.all(
        facets.map((facet) =>
          obtainConceptsForFacet(
            facet, ask, sessionId, preferNew, excludesByFacet.get(facet.id)!, waveTotal
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
            maxRetries, brainstormConfig.retry_backoff_ms, controller.signal
          )
          const kept = newPrompts.slice(0, assignments.length)
          done = Math.min(done + kept.length, req.count)
          broadcastProgress({ requestId: req.requestId, done, total: req.count })
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
        collected.push(...outcome.value.kept)
        for (let i = 0; i < outcome.value.kept.length; i++) {
          for (const part of outcome.value.assignments[i]) recordUse(part.concept.id, sessionId)
        }
      }
      if (failure !== null) {
        throw failure instanceof Error ? failure : new Error(String(failure))
      }

      // The prompts themselves persist in the session manifest's
      // `elaboratedPrompts` array — no need to duplicate them here.
      log('debug', 'Brainstorm wave complete', { turns: turn, collected: collected.length })
    }

    log('info', 'Brainstorm complete', {
      contentElaborator: contentElaborator.name,
      compositionElaborator: compositionElaborator.name,
      styleElaborator: styleElaborator.name,
      backend: handle.backend,
      model: handle.modelId,
      facets: facetNames,
      count: collected.length,
      turns: turn,
      durationMs: Date.now() - startTime,
    })
    return { prompts: collected.slice(0, req.count) }
  } catch (err) {
    // An aborted run rejects out of whichever call was in flight — planning or
    // prose. Treat it as cancellation: keep what was collected.
    if (controller.signal.aborted) {
      log('info', 'Brainstorm cancelled', {
        requestId: req.requestId, collected: collected.length, turns: turn,
      })
      return { prompts: collected.slice(0, req.count) }
    }
    log('error', 'Brainstorm failed', {
      contentElaborator: contentElaborator.name,
      compositionElaborator: compositionElaborator.name,
      styleElaborator: styleElaborator.name,
      backend: handle.backend,
      model: handle.modelId,
      requested: req.count,
      collected: collected.length,
      turns: turn,
      durationMs: Date.now() - startTime,
      error: serializeError(err),
    })
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    activeControllers.delete(req.requestId)
  }
}
