import { GoogleGenAI } from '@google/genai'
import { nanoid } from 'nanoid'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { log } from '../logger'

// Generates a filename slug from a prompt using the configured Text AI.
// Dispatches on config.text_ai.backend; falls back to nanoid on failure or unknown backend.
export async function generateSlug(prompt: string): Promise<string> {
  const config = loadConfig()
  const { backend, model, api_key } = config.text_ai
  const apiKey = decodeApiKey(api_key)

  if (!apiKey) {
    return nanoid(10)
  }

  switch (backend) {
    case 'gemini': {
      try {
        const systemPrompt = config.prompts.slug.replace('{{prompt}}', prompt)
        const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: config.text_ai.timeout_ms } })

        const response = await ai.models.generateContent({
          model,
          contents: systemPrompt
        })

        const slug = response.text?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

        if (slug && slug.length >= 3 && slug.length <= 60) {
          return slug
        }
        log('warn', 'Slug AI returned unusable output, falling back to nanoid', {
          backend, model,
          rawResponse: response.text ?? null,
          derivedSlug: slug ?? null
        })
        return nanoid(10)
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'AbortError'
        log('warn', isTimeout ? 'Slug AI timed out, falling back to nanoid' : 'Slug AI call failed, falling back to nanoid', {
          backend, model,
          message: err instanceof Error ? err.message : String(err)
        })
        return nanoid(10)
      }
    }

    default: {
      log('warn', 'Unknown text AI backend, falling back to nanoid', { backend })
      return nanoid(10)
    }
  }
}
