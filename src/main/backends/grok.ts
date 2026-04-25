import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { log, logApiRequest, logApiResponse } from '../logger'

// Calls the xAI Grok Imagine image generation API and returns the image bytes
// with an `image/jpeg` MIME hint. The API always returns JPEG — no format
// selection is available.
export async function generateGrok(task: Task): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const apiKey = decodeApiKey(config.image_backends.grok.api_key)

  if (!apiKey) {
    throw new Error('Grok Imagine API key not configured')
  }

  const { timeout_ms } = config.image_backends.grok
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout_ms)

  const params = task.params as { aspectRatio?: string; resolution?: string }

  const body: Record<string, unknown> = {
    model: task.model,
    prompt: task.prompt,
    n: 1,
    response_format: 'b64_json'
  }

  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio
  if (params.resolution) body.resolution = params.resolution

  logApiRequest('grok', task.model, { model: task.model, aspectRatio: params.aspectRatio, resolution: params.resolution })
  const startTime = Date.now()

  try {
    const response = await fetch('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
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

    return { buffer: Buffer.from(b64, 'base64'), mimeType: 'image/jpeg' }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      log('error', 'Grok Imagine timed out', { model: task.model, timeoutMs: timeout_ms })
      throw new Error(`Grok API timed out after ${timeout_ms / 1000}s`)
    }
    if (!(err instanceof Error && err.message.startsWith('Grok API'))) {
      log('error', 'Grok Imagine API call failed', {
        model: task.model,
        message: err instanceof Error ? err.message : String(err)
      })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
