import { GoogleGenAI } from '@google/genai'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { log, logApiRequest, logApiResponse } from '../logger'

// Calls the Gemini native image generation API (generateContent) and returns
// the first image part as a Buffer. Uses the Google API key from config.
export async function generateNanoBanana(task: Task): Promise<Buffer> {
  const config = loadConfig()
  const apiKey = decodeApiKey(config.image_backends.imagen.api_key)

  if (!apiKey) {
    throw new Error('Google API key not configured (required for Nano Banana)')
  }

  const ai = new GoogleGenAI({ apiKey })

  logApiRequest('nanobanana', task.model, { model: task.model })
  const startTime = Date.now()

  const response = await ai.models.generateContent({
    model: task.model,
    contents: task.prompt,
    config: { responseModalities: ['TEXT', 'IMAGE'] }
  }).catch((err: unknown) => {
    log('error', 'Nano Banana API call failed', {
      model: task.model,
      status: (err as Record<string, unknown>).status ?? (err as Record<string, unknown>).httpStatus,
      message: err instanceof Error ? err.message : String(err)
    })
    throw err
  })

  logApiResponse('nanobanana', 'ok', Date.now() - startTime)

  const parts = response.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p) => p.inlineData?.data)

  if (!imagePart?.inlineData?.data) {
    log('error', 'Nano Banana response missing image data', {
      model: task.model,
      candidateCount: response.candidates?.length ?? 0,
      partCount: parts.length
    })
    throw new Error('No image data in Nano Banana response')
  }

  return Buffer.from(imagePart.inlineData.data, 'base64')
}
