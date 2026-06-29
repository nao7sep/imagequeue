import { GoogleGenAI } from '@google/genai'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { resolveApiKey } from '../config/api-keys-store'
import { log, logApiRequest, logApiResponse, serializeError } from '../logger'
import { findModel } from '../../shared/models'

// Calls Google Imagen API and returns the image bytes plus the MIME-type
// hint reported by the SDK.
// Uses the 'image.imagen' secret (its own key, not the text_ai key).
export async function generateImagen(task: Task): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const apiKey = resolveApiKey('gemini.imagen')

  if (!apiKey) {
    throw new Error('Imagen API key not configured')
  }

  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: config.image_backends.imagen.timeout_ms } })

  const aspectRatio = (task.params.aspectRatio as string) || '1:1'
  const imageSize = (task.params.imageSize as string) || '1K'
  const personGeneration = (task.params.personGeneration as string) || 'allow_all'

  // imageSize is only supported by Standard and Ultra models, not Fast
  const modelDef = findModel('imagen', task.model)
  const supportsImageSize = modelDef?.supportsImageSize ?? false

  const requestParams = { aspectRatio, ...(supportsImageSize && { imageSize }), personGeneration }
  logApiRequest('imagen', task.model, requestParams)
  const startTime = Date.now()

  const response = await ai.models.generateImages({
    model: task.model,
    prompt: task.prompt,
    config: {
      numberOfImages: 1,
      aspectRatio,
      ...(supportsImageSize && { imageSize }),
      ...(supportsImageSize && imageSize === '2K' && { outputOptions: { mimeType: 'image/png' } }),
      personGeneration
    } as Record<string, unknown>
  }).catch((err: unknown) => {
    if (err instanceof Error && err.name === 'AbortError') {
      log('error', 'Imagen API timed out', { model: task.model, timeoutMs: config.image_backends.imagen.timeout_ms })
      throw new Error(`Imagen API timed out after ${config.image_backends.imagen.timeout_ms / 1000}s`)
    }
    log('error', 'Imagen API call failed', {
      model: task.model,
      requestParams,
      status: (err as Record<string, unknown>).status ?? (err as Record<string, unknown>).httpStatus,
      error: serializeError(err)
    })
    throw err
  })

  logApiResponse('imagen', 'ok', Date.now() - startTime)

  const generatedImage = response.generatedImages?.[0]?.image
  const imageBytes = generatedImage?.imageBytes
  if (!imageBytes) {
    log('error', 'Imagen response missing image data', { model: task.model })
    throw new Error('No image data in Imagen response')
  }

  return { buffer: Buffer.from(imageBytes, 'base64'), mimeType: generatedImage?.mimeType }
}
