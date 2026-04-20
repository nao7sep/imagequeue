import OpenAI from 'openai'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'

// Calls OpenAI image generation API and returns the image as a Buffer.
export async function generateOpenAI(task: Task): Promise<Buffer> {
  const config = loadConfig()
  const apiKey = decodeApiKey(config.image_backends.openai.api_key)

  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const client = new OpenAI({ apiKey })

  const width = (task.params.width as number) || 1024
  const height = (task.params.height as number) || 1024
  const size = `${width}x${height}` as '1024x1024' | '1024x1536' | '1536x1024'
  const quality = (task.params.quality as 'low' | 'medium' | 'high') || 'high'
  const outputFormat = (task.params.outputFormat as string) || 'png'
  const background = (task.params.background as string) || 'opaque'

  const response = await client.images.generate({
    model: task.model,
    prompt: task.prompt,
    quality,
    size,
    n: 1,
    response_format: 'b64_json',
    ...(outputFormat !== 'png' && { output_format: outputFormat }),
    ...(background === 'transparent' && { background: 'transparent' })
  } as Parameters<typeof client.images.generate>[0])

  const b64 = response.data?.[0]?.b64_json
  if (!b64) {
    throw new Error('No image data in OpenAI response')
  }

  return Buffer.from(b64, 'base64')
}
