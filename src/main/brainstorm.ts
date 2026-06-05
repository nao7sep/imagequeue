import { BrowserWindow } from 'electron'
import { getElaborator } from './elaborators'
import { getMainProvider } from './text-ai'
import {
  PROMPTS_RESPONSE_SCHEMA,
  fillTemplate,
  getRuntimeBrainstormConfig,
} from './text-ai/templates'
import type { ConversationMessage, TextAIProvider } from './text-ai'
import { log } from './logger'

export interface BrainstormRequest {
  requestId: string
  contentElaboratorId: string
  compositionElaboratorId: string
  styleElaboratorId: string
  seed: string
  count: number
  previousPrompts: string[]
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

// Request IDs the renderer has asked to cancel. brainstormPrompts checks this
// at each turn boundary and stops collecting, so a deliberately aborted run
// doesn't keep calling the text AI in the background. An in-flight turn still
// finishes (we don't abort the underlying request), but no further turns start.
const cancelledRequests = new Set<string>()

export function cancelBrainstorm(requestId: string): void {
  cancelledRequests.add(requestId)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatPreviousList(previous: string[]): string {
  return previous.map((p, i) => `${i + 1}. ${p}`).join('\n')
}

function buildFirstMessage(
  templates: { first_no_previous: string; first_with_previous: string },
  elaboratorTemplate: string,
  seed: string,
  previousPrompts: string[],
  countToAskFor: number
): string {
  if (previousPrompts.length === 0) {
    return fillTemplate(templates.first_no_previous, {
      ELABORATOR: elaboratorTemplate,
      SEED: seed,
      N: String(countToAskFor),
    })
  }
  return fillTemplate(templates.first_with_previous, {
    ELABORATOR: elaboratorTemplate,
    SEED: seed,
    PREVIOUS: formatPreviousList(previousPrompts),
    N: String(countToAskFor),
  })
}

function buildContinuationMessage(template: string, countToAskFor: number): string {
  return fillTemplate(template, { N: String(countToAskFor) })
}

function buildCombinedElaboratorInstructions(parts: {
  content: string
  composition: string
  style: string
}): string {
  return [
    'Apply the following elaborator instruction sets in order. Preserve explicit user intent throughout.',
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

// One conversation turn with up to maxRetries retries. Returns the parsed
// prompts, or throws after all retries are exhausted.
async function askWithRetry(
  provider: TextAIProvider,
  messages: ConversationMessage[],
  timeoutMs: number,
  expectedCount: number,
  maxRetries: number,
  backoffSchedule: number[]
): Promise<string[]> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = backoffSchedule.length > 0
        ? backoffSchedule[Math.min(attempt - 1, backoffSchedule.length - 1)]
        : 1000
      log('warn', 'Brainstorm turn failed, retrying', {
        attempt, backoff,
        message: lastError instanceof Error ? lastError.message : String(lastError),
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
        schema: PROMPTS_RESPONSE_SCHEMA,
        timeoutMs,
      })
      const prompts = extractPromptsFromParsed(result.parsed)
      if (prompts.length === 0) {
        log('warn', 'Brainstorm turn returned no usable prompts', { rawText: result.text })
        throw new Error('Text AI returned no usable prompts.')
      }
      // Trim to expected count if model overshot; tolerate undercount and let the loop ask for more next turn.
      return prompts.slice(0, expectedCount)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

// Generate `count` prompts via a single conversation, batched into turns of
// `batch_size`. Each turn retries on transient failures. Progress (done/total)
// is emitted to all renderer windows after every successful turn.
//
// Returns the full set on success, or the prompts collected so far if the run
// is cancelled between turns. On failure, throws the last error — the caller
// persists nothing for a run that didn't complete and queue its tasks.
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
  const batchSize = Math.max(1, brainstormConfig.batch_size)
  const maxRetries = Math.max(0, brainstormConfig.max_retries_per_turn)

  const startTime = Date.now()

  const messages: ConversationMessage[] = []
  const collected: string[] = []
  let turn = 0

  try {
    while (collected.length < req.count) {
      if (cancelledRequests.has(req.requestId)) {
        log('info', 'Brainstorm cancelled', {
          requestId: req.requestId, collected: collected.length, turns: turn,
        })
        break
      }
      const remaining = req.count - collected.length
      const askFor = Math.min(remaining, batchSize)
      turn++

      const userMessage = collected.length === 0
        ? buildFirstMessage(brainstormConfig.templates, combinedElaboratorTemplate, req.seed, req.previousPrompts, askFor)
        : buildContinuationMessage(brainstormConfig.templates.continuation, askFor)
      messages.push({ role: 'user', text: userMessage })

      const newPrompts = await askWithRetry(
        handle.provider, messages, handle.timeoutMs, askFor,
        maxRetries, brainstormConfig.retry_backoff_ms
      )
      collected.push(...newPrompts)
      messages.push({ role: 'model', text: JSON.stringify({ prompts: newPrompts }) })

      // The prompts themselves persist in the session manifest's
      // `elaboratedPrompts` array — no need to duplicate them here.
      log('info', 'Brainstorm turn complete', { turn, count: newPrompts.length })

      broadcastProgress({
        requestId: req.requestId,
        done: Math.min(collected.length, req.count),
        total: req.count,
      })

      if (newPrompts.length === 0) {
        // Defensive: askWithRetry throws when 0; shouldn't reach here. Bail to avoid an infinite loop.
        throw new Error('Text AI returned no prompts on a turn.')
      }
    }

    log('info', 'Brainstorm complete', {
      contentElaborator: contentElaborator.name,
      compositionElaborator: compositionElaborator.name,
      styleElaborator: styleElaborator.name,
      backend: handle.backend,
      model: handle.modelId,
      count: collected.length,
      turns: turn,
      durationMs: Date.now() - startTime,
    })
    return { prompts: collected.slice(0, req.count) }
  } catch (err) {
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
      message: err instanceof Error ? err.message : String(err),
    })
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    cancelledRequests.delete(req.requestId)
  }
}
