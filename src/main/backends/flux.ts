import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { log, logApiRequest, logApiResponse } from '../logger'

const BASE_URL = 'https://api.bfl.ai/v1'
const POLL_INTERVAL_MS = 2000

// Calls FLUX API (async submit/poll/download flow) and returns the image as a Buffer.
export async function generateFlux(task: Task): Promise<Buffer> {
  const config = loadConfig()
  const apiKey = decodeApiKey(config.image_backends.flux.api_key)

  if (!apiKey) {
    throw new Error('FLUX API key not configured')
  }

  const width = (task.params.width as number) || 1024
  const height = (task.params.height as number) || 1024

  // Validate: dimensions must be multiples of 16 and ≤4MP
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new Error('FLUX dimensions must be multiples of 16')
  }
  if (width * height > 4_194_304) {
    throw new Error('FLUX dimensions exceed 4MP limit')
  }

  const body: Record<string, unknown> = {
    prompt: task.prompt,
    width,
    height,
    output_format: 'png'
  }

  if (task.params.steps) body.steps = task.params.steps
  if (task.params.guidance) body.guidance = task.params.guidance
  if (task.params.seed != null) body.seed = task.params.seed

  // Submit request
  logApiRequest('flux', task.model, { width, height, steps: body.steps, guidance: body.guidance, seed: body.seed })
  const startTime = Date.now()

  const { timeout_ms } = config.image_backends.flux
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout_ms)

  try {
    const submitResponse = await fetch(`${BASE_URL}/${task.model}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    if (!submitResponse.ok) {
      const text = await submitResponse.text()
      log('error', 'FLUX submit request failed', { model: task.model, status: submitResponse.status, body: text })
      throw new Error(`FLUX submit failed (${submitResponse.status}): ${text}`)
    }

    const submitData = await submitResponse.json() as { id: string; polling_url?: string }
    const pollingUrl = submitData.polling_url || `${BASE_URL}/get_result?id=${submitData.id}`

    // Poll for result
    while (true) {
      await sleep(POLL_INTERVAL_MS)

      const pollResponse = await fetch(pollingUrl, {
        headers: { 'x-key': apiKey },
        signal: controller.signal
      })

      if (!pollResponse.ok) {
        log('error', 'FLUX poll request failed', { model: task.model, status: pollResponse.status, jobId: submitData.id })
        throw new Error(`FLUX poll failed (${pollResponse.status})`)
      }

      const pollData = await pollResponse.json() as {
        status: string
        result?: { sample?: string }
      }

      if (pollData.status === 'Ready') {
        const imageUrl = pollData.result?.sample
        if (!imageUrl) {
          log('error', 'FLUX completed but response missing image URL', { model: task.model, result: pollData.result })
          throw new Error('FLUX completed but no image URL in response')
        }

        logApiResponse('flux', 'Ready', Date.now() - startTime)

        // Download image from signed URL
        const imageResponse = await fetch(imageUrl, { signal: controller.signal })
        if (!imageResponse.ok) {
          log('error', 'FLUX image download failed', { model: task.model, status: imageResponse.status })
          throw new Error(`Failed to download FLUX image (${imageResponse.status})`)
        }

        return Buffer.from(await imageResponse.arrayBuffer())
      }

      if (pollData.status === 'Error' || pollData.status === 'Failed') {
        log('error', 'FLUX generation returned error status', { model: task.model, status: pollData.status, pollData })
        throw new Error(`FLUX generation failed: ${JSON.stringify(pollData)}`)
      }

      // Otherwise status is "Pending" or "Processing" — keep polling
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      log('error', 'FLUX generation timed out', { model: task.model, timeoutMs: timeout_ms, elapsedMs: Date.now() - startTime })
      throw new Error(`FLUX generation timed out after ${timeout_ms / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
