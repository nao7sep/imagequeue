import { GoogleGenAI } from '@google/genai'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { logApiRequest, logApiResponse } from '../logger'

// Calls Google Imagen API and returns the image as a Buffer.
export async function generateGoogle(task: Task): Promise<Buffer> {
  const config = loadConfig()
  const apiKey = decodeApiKey(config.image_backends.google.api_key)

  if (!apiKey) {
    throw new Error('Google API key not configured')
  }

  const ai = new GoogleGenAI({ apiKey })

  const aspectRatio = (task.params.aspectRatio as string) || '1:1'
  const imageSize = (task.params.imageSize as string) || '1024x1024'
  const personGeneration = (task.params.personGeneration as string) || 'allow_adult'
  const numberOfImages = (task.params.numberOfImages as number) || 1

  const requestParams = { aspectRatio, imageSize, personGeneration, numberOfImages }
  logApiRequest('google', task.model, requestParams)
  const startTime = Date.now()

  const response = await ai.models.generateImages({
    model: task.model,
    prompt: task.prompt,
    config: {
      numberOfImages,
      aspectRatio,
      ...(imageSize === '2048x2048' && { outputOptions: { mimeType: 'image/png' } }),
      personGeneration
    } as Record<string, unknown>
  })

  logApiResponse('google', 'ok', Date.now() - startTime)

  const imageBytes = response.generatedImages?.[0]?.image?.imageBytes
  if (!imageBytes) {
    throw new Error('No image data in Google response')
  }

  return Buffer.from(imageBytes, 'base64')
}
