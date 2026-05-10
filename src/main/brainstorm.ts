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
  elaboratorId: string
  seed: string
  count: number
  previousPrompts: string[]
}

export interface BrainstormResult {
  prompts: string[]
}

// Emitted to the renderer after every successful turn. The renderer absorbs
// `newPrompts` into its session list as soon as it arrives, so even a later
// failure on a subsequent turn doesn't lose the prompts that already succeeded.
interface BrainstormProgress {
  requestId: string
  done: number
  total: number
  newPrompts: string[]
}

function broadcastProgress(progress: BrainstormProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('brainstorm:progress', progress)
  }
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
      const result = await provider.ask({
        messages,
        schema: PROMPTS_RESPONSE_SCHEMA,
        timeoutMs,
      })
      const parsed = result.parsed as { prompts?: unknown } | undefined
      const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : []
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
// `batch_size`. Each turn retries on transient failures. Progress is emitted
// to all renderer windows after every successful turn.
//
// On failure, throws the last error. Prompts from earlier successful turns
// are kept by the renderer through the progress events that streamed them —
// the orchestrator does not need to re-deliver them.
export async function brainstormPrompts(req: BrainstormRequest): Promise<BrainstormResult> {
  if (req.count < 1) throw new Error('Count must be at least 1.')
  if (!req.seed.trim()) throw new Error('Seed prompt is empty.')

  const elaborator = getElaborator(req.elaboratorId)
  if (!elaborator) throw new Error('Elaborator not found.')

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
      const remaining = req.count - collected.length
      const askFor = Math.min(remaining, batchSize)
      turn++

      const userMessage = collected.length === 0
        ? buildFirstMessage(brainstormConfig.templates, elaborator.template, req.seed, req.previousPrompts, askFor)
        : buildContinuationMessage(brainstormConfig.templates.continuation, askFor)
      messages.push({ role: 'user', text: userMessage })

      const newPrompts = await askWithRetry(
        handle.provider, messages, handle.timeoutMs, askFor,
        maxRetries, brainstormConfig.retry_backoff_ms
      )
      collected.push(...newPrompts)
      messages.push({ role: 'model', text: JSON.stringify({ prompts: newPrompts }) })

      // Log the elaborated prompts but not the full user message — the
      // template + previous-prompts list reproduces from config + session
      // state if needed for debugging, and keeps session.log compact.
      log('info', 'Elaborated prompts', { turn, prompts: newPrompts })

      broadcastProgress({
        requestId: req.requestId,
        done: Math.min(collected.length, req.count),
        total: req.count,
        newPrompts,
      })

      if (newPrompts.length === 0) {
        // Defensive: askWithRetry throws when 0; shouldn't reach here. Bail to avoid an infinite loop.
        throw new Error('Text AI returned no prompts on a turn.')
      }
    }

    log('info', 'Brainstorm complete', {
      elaborator: elaborator.name,
      backend: handle.backend,
      model: handle.modelId,
      count: collected.length,
      turns: turn,
      durationMs: Date.now() - startTime,
    })
    return { prompts: collected.slice(0, req.count) }
  } catch (err) {
    log('error', 'Brainstorm failed', {
      elaborator: elaborator.name,
      backend: handle.backend,
      model: handle.modelId,
      requested: req.count,
      collected: collected.length,
      turns: turn,
      durationMs: Date.now() - startTime,
      message: err instanceof Error ? err.message : String(err),
    })
    throw err instanceof Error ? err : new Error(String(err))
  }
}
