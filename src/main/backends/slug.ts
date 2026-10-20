import { refreshApiKeys } from '../config/api-keys-store'
import { nanoid } from 'nanoid'
import { loadConfig } from '../config'
import { getLightProvider } from '../text-ai'
import { log, serializeError } from '../logger'
import { withProviderRetry } from '../provider-retry'

// The slug comes back in a strict schema, so it cannot arrive in another shape.
export const SLUG_RESPONSE_SCHEMA = {
  type: 'object',
  properties: { slug: { type: 'string' } },
  required: ['slug'],
  additionalProperties: false,
} as const

// Generates a filename slug from a prompt using the configured Text AI's
// light tier. Falls back to nanoid on any failure, if the AI is not
// configured, or once `signal` aborts (shutdown): the image is already made,
// so it is saved under the random name rather than waiting on the network.
export async function generateSlug(prompt: string, taskId: string, signal: AbortSignal): Promise<string> {
  const config = loadConfig()
  if (signal.aborted) return nanoid(10)
  try {
    // Naming is optional, but credential refresh retains its physical owner
    // in the key store. Shutdown abandons only this caller's wait, so a held
    // key replacement cannot strand an already delivered image.
    let onAbort!: () => void
    const aborted = new Promise<void>((resolve) => { onAbort = resolve })
    signal.addEventListener('abort', onAbort, { once: true })
    try { await Promise.race([refreshApiKeys(), aborted]) }
    finally { signal.removeEventListener('abort', onAbort) }
    if (signal.aborted) return nanoid(10)
    const handle = getLightProvider()
    if (!handle) return nanoid(10)

    const systemPrompt = config.prompts.slug.replace(/\{\{PROMPT\}\}/i, prompt)
    const result = await withProviderRetry((attemptSignal) => handle.provider.ask({
      messages: [{ role: 'user', text: systemPrompt }],
      schema: SLUG_RESPONSE_SCHEMA,
      timeoutMs: handle.timeoutMs,
      signal: attemptSignal,
      record: { purpose: 'slug', taskId },
    }), { signal })

    const answer = (result.parsed as { slug?: unknown } | undefined)?.slug
    const slug = (typeof answer === 'string' ? answer : '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

    if (slug && slug.length >= 3 && slug.length <= 60) {
      return slug
    }
    log('warn', 'Slug AI returned unusable output, falling back to nanoid', {
      response: result.text,
      derivedSlug: slug ?? null,
    })
    return nanoid(10)
  } catch (err) {
    if (signal.aborted) {
      log('info', 'Slug AI call abandoned on shutdown, falling back to nanoid')
      return nanoid(10)
    }
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    log('warn', isTimeout ? 'Slug AI timed out, falling back to nanoid' : 'Slug AI call failed, falling back to nanoid', {
      error: serializeError(err),
    })
    return nanoid(10)
  }
}
