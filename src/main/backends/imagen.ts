import { GoogleGenAI } from '@google/genai'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { log, logApiRequest, logApiResponse } from '../logger'
import { findModel } from '../../shared/models'

// Calls Google Imagen API and returns the image as a Buffer.
// Uses image_backends.imagen.api_key (not the text_ai key).
export async function generateImagen(task: Task): Promise<Buffer> {
  const config = loadConfig()
  const apiKey = decodeApiKey(config.image_backends.imagen.api_key)

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
      message: err instanceof Error ? err.message : String(err)
    })
    throw err
  })

  logApiResponse('imagen', 'ok', Date.now() - startTime)

  const imageBytes = response.generatedImages?.[0]?.image?.imageBytes
  if (!imageBytes) {
    log('error', 'Imagen response missing image data', { model: task.model })
    throw new Error('No image data in Imagen response')
  }

  return Buffer.from(imageBytes, 'base64')
}
