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
  ensureFacet,
  listFacetDisplays,
  recordUse,
  type DrawnConcept,
  type FacetRow,
} from './concepts/concept-store'
import {
  resolveFacets,
  type AskJson,
} from './concepts/planner'
import type { PromptFormat, PromptLength } from '../shared/session-draft'
import { log, serializeError } from './logger'
import { askJsonWithRetry } from './text-ai/retry-json'
import {
  facetInventory,
  ledgerTotals,
  newConceptRunStats,
  obtainConceptsForFacet,
  type RunExcludes,
} from './concepts/acquisition'

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
  // Concept ids per collected prompt, committed as uses only when the prompts
  // are actually DELIVERED (success, or the cancel path returning partials).
  // Recording incrementally burnt earlier waves' values when a later wave
  // failed: the run threw, the caller kept nothing, yet the window blocked
  // those values for 1000 draws.
  const pendingUses: number[][] = []
  const commitUses = (): void => {
    for (const conceptIds of pendingUses) {
      for (const conceptId of conceptIds) recordUse(conceptId, sessionId)
    }
    pendingUses.length = 0
  }
  let turn = 0

  const controller = new AbortController()
  activeControllers.set(req.requestId, controller)
  const stats = newConceptRunStats()

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
      const parsed = await askJsonWithRetry({
        provider: handle.provider,
        messages,
        schema,
        timeoutMs: handle.timeoutMs,
        validate: (parsed) => (parsed === null || parsed === undefined ? null : parsed),
        maxRetries,
        backoffSchedule: brainstormConfig.retry_backoff_ms,
        signal: controller.signal,
        label,
        requestId: req.requestId,
      })
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
          obtainConceptsForFacet({
            facet,
            ask,
            sessionId,
            preferNew,
            excludes: excludesByFacet.get(facet.id)!,
            count: waveTotal,
            requestId: req.requestId,
            stats,
          })
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
          const newPrompts = await askJsonWithRetry({
            provider: handle.provider,
            messages: [{ role: 'user', text: userMessage }],
            schema: PROMPTS_RESPONSE_SCHEMA,
            timeoutMs: handle.timeoutMs,
            validate: (parsed) => {
              const prompts = extractPromptsFromParsed(parsed)
              return prompts.length > 0 ? prompts : null
            },
            maxRetries,
            backoffSchedule: brainstormConfig.retry_backoff_ms,
            signal: controller.signal,
            label: 'prose',
            requestId: req.requestId,
          })
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
      const failure = settled.find(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
      )?.reason ?? null
      if (failure !== null) {
        throw failure instanceof Error ? failure : new Error(String(failure))
      }
      for (const outcome of settled) {
        if (outcome.status !== 'fulfilled') continue
        outcome.value.kept.forEach((text, i) => {
          const assignment = outcome.value.assignments[i]
          collected.push({
            text,
            concepts: assignment.map((part) => ({
              facet: part.facet.display,
              concept: part.concept.display,
            })),
          })
          pendingUses.push(assignment.map((part) => part.concept.id))
        })
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

    // Uses commit before the completion log so the inventory and ledger totals
    // it reports are the post-run truth, not the pre-commit snapshot.
    commitUses()
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
      // The cancel path DELIVERS what was collected, so its uses commit too.
      commitUses()
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
