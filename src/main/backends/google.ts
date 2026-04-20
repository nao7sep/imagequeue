import { GoogleGenAI } from '@google/genai'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'

// Calls Google Imagen API and returns the image as a Buffer.
export async function generateGoogle(task: Task): Promise<Buffer> {
  const config = loadConfig()
  const apiKey = decodeApiKey(config.image_backends.google.api_key)

  if (!apiKey) {
    throw new Error('Google API key not configured')
  }

  const ai = new GoogleGenAI({ apiKey })

  const width = (task.params.width as number) || 1024
  const height = (task.params.height as number) || 1024

  // Determine aspect ratio from dimensions
  let aspectRatio = '1:1'
  if (width > height) aspectRatio = '16:9'
  else if (height > width) aspectRatio = '9:16'

  // Determine image size ("1K" or "2K")
  const imageSize = Math.max(width, height) > 1024 ? '2048x2048' : '1024x1024'

  const response = await ai.models.generateImages({
    model: task.model,
    prompt: task.prompt,
    config: {
      numberOfImages: 1,
      aspectRatio
    }
  })

  const imageBytes = response.generatedImages?.[0]?.image?.imageBytes
  if (!imageBytes) {
    throw new Error('No image data in Google response')
  }

  return Buffer.from(imageBytes, 'base64')
}
