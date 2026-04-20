import { GoogleGenAI } from '@google/genai'
import { nanoid } from 'nanoid'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { log } from '../logger'

// Generates a filename slug from a prompt using the configured Text AI.
// Falls back to nanoid if the AI call fails.
export async function generateSlug(prompt: string): Promise<string> {
  const config = loadConfig()
  const apiKey = decodeApiKey(config.text_ai.api_key)

  if (!apiKey) {
    return nanoid(10)
  }

  try {
    const systemPrompt = config.prompts.slug.replace('{{prompt}}', prompt)
    const ai = new GoogleGenAI({ apiKey })

    const response = await ai.models.generateContent({
      model: config.text_ai.model,
      contents: systemPrompt
    })

    const slug = response.text?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

    if (slug && slug.length >= 3 && slug.length <= 60) {
      return slug
    }
    log('warn', 'Slug AI returned unusable output, falling back to nanoid', {
      model: config.text_ai.model,
      rawResponse: response.text ?? null,
      derivedSlug: slug ?? null
    })
    return nanoid(10)
  } catch (err) {
    log('warn', 'Slug AI call failed, falling back to nanoid', {
      model: config.text_ai.model,
      message: err instanceof Error ? err.message : String(err)
    })
    return nanoid(10)
  }
}
