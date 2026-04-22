import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { log, logApiRequest, logApiResponse } from '../logger'

// Calls the xAI Grok Imagine image generation API and returns the image as a
// Buffer. The API always returns JPEG — no format selection is available.
export async function generateGrok(task: Task): Promise<Buffer> {
  const config = loadConfig()
  const apiKey = decodeApiKey(config.image_backends.grok.api_key)

  if (!apiKey) {
    throw new Error('Grok Imagine API key not configured')
  }

  const params = task.params as { aspectRatio?: string }

  const body: Record<string, unknown> = {
    model: task.model,
    prompt: task.prompt,
    n: 1,
    response_format: 'b64_json'
  }

  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio

  logApiRequest('grok', task.model, { model: task.model, aspectRatio: params.aspectRatio })
  const startTime = Date.now()

  const response = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }).catch((err: unknown) => {
    log('error', 'Grok Imagine API call failed', {
      model: task.model,
      message: err instanceof Error ? err.message : String(err)
    })
    throw err
  })

  if (!response.ok) {
    const text = await response.text()
    log('error', 'Grok Imagine API error response', { status: response.status, body: text.slice(0, 500) })
    throw new Error(`Grok API error ${response.status}: ${text.slice(0, 200)}`)
  }

  logApiResponse('grok', 'ok', Date.now() - startTime)

  const json = await response.json() as { data: { b64_json?: string }[] }
  const b64 = json.data?.[0]?.b64_json

  if (!b64) {
    log('error', 'Grok Imagine response missing image data', { model: task.model })
    throw new Error('No image data in Grok Imagine response')
  }

  return Buffer.from(b64, 'base64')
}
