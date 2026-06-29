import { GoogleGenAI } from '@google/genai'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { resolveApiKey } from '../config/api-keys-store'
import { log, logApiRequest, logApiResponse, serializeError } from '../logger'
import { findModel } from '../../shared/models'

// Calls the Gemini native image generation API (generateContent) and returns
// the first image part as a Buffer along with its MIME-type hint. The Gemini
// API may return either PNG or JPEG bytes; callers should rely on the hint
// (and magic-byte detection) rather than assuming a fixed format.
// Uses the 'image.nanobanana' secret (its own key, not the text_ai key).
export async function generateNanoBanana(task: Task): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const apiKey = resolveApiKey('gemini.nanobanana')

  if (!apiKey) {
    throw new Error('Nano Banana API key not configured')
  }

  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: config.image_backends.nanobanana.timeout_ms } })

  const modelDef = findModel('nanobanana', task.model)
  const supportsImageConfig = modelDef?.supportsImageConfig ?? false

  const aspectRatio = (task.params.aspectRatio as string) || '1:1'
  const imageSize = (task.params.imageSize as string) || '1K'

  const requestParams = supportsImageConfig
    ? { aspectRatio, imageSize }
    : {}
  logApiRequest('nanobanana', task.model, requestParams)
  const startTime = Date.now()

  const response = await ai.models.generateContent({
    model: task.model,
    contents: task.prompt,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(supportsImageConfig && { imageConfig: { aspectRatio, imageSize } })
    } as Record<string, unknown>
  }).catch((err: unknown) => {
    if (err instanceof Error && err.name === 'AbortError') {
      log('error', 'Nano Banana API timed out', { model: task.model, timeoutMs: config.image_backends.nanobanana.timeout_ms })
      throw new Error(`Nano Banana API timed out after ${config.image_backends.nanobanana.timeout_ms / 1000}s`)
    }
    log('error', 'Nano Banana API call failed', {
      model: task.model,
      requestParams,
      status: (err as Record<string, unknown>).status ?? (err as Record<string, unknown>).httpStatus,
      error: serializeError(err)
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

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType
  }
}
