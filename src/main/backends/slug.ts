import { nanoid } from 'nanoid'
import { loadConfig } from '../config'
import { getLightProvider } from '../text-ai'
import { log } from '../logger'

// Generates a filename slug from a prompt using the configured Text AI's
// light tier. Falls back to nanoid on any failure or if the AI is not
// configured.
export async function generateSlug(prompt: string): Promise<string> {
  const config = loadConfig()
  const handle = getLightProvider()
  if (!handle) {
    return nanoid(10)
  }

  try {
    const systemPrompt = config.prompts.slug.replace('{{prompt}}', prompt)
    const result = await handle.provider.ask({
      messages: [{ role: 'user', text: systemPrompt }],
      timeoutMs: handle.timeoutMs,
    })

    const slug = result.text.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

    if (slug && slug.length >= 3 && slug.length <= 60) {
      return slug
    }
    log('warn', 'Slug AI returned unusable output, falling back to nanoid', {
      rawResponse: result.text ?? null,
      derivedSlug: slug ?? null,
    })
    return nanoid(10)
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    log('warn', isTimeout ? 'Slug AI timed out, falling back to nanoid' : 'Slug AI call failed, falling back to nanoid', {
      message: err instanceof Error ? err.message : String(err),
    })
    return nanoid(10)
  }
}
