import { nanoid } from 'nanoid'
import { loadConfig } from '../config'
import { getLightProvider } from '../text-ai'
import { log, serializeError } from '../logger'

// Generates a filename slug from a prompt using the configured Text AI's
// light tier. Falls back to nanoid on any failure, if the AI is not
// configured, or once `signal` aborts (shutdown): the image is already made,
// so it is saved under the random name rather than waiting on the network.
export async function generateSlug(prompt: string, signal: AbortSignal): Promise<string> {
  const config = loadConfig()
  const handle = getLightProvider()
  if (!handle || signal.aborted) {
    return nanoid(10)
  }

  try {
    const systemPrompt = config.prompts.slug.replace(/\{\{PROMPT\}\}/i, prompt)
    const result = await handle.provider.ask({
      messages: [{ role: 'user', text: systemPrompt }],
      timeoutMs: handle.timeoutMs,
      signal,
    })

    const slug = result.text.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

    if (slug && slug.length >= 3 && slug.length <= 60) {
      return slug
    }
    log('warn', 'Slug AI returned unusable output, falling back to nanoid', {
      responsePreview: (result.text ?? '').slice(0, 300), responseChars: (result.text ?? '').length,
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
