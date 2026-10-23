import type { Fetch } from '@google/genai'

/** Capture cooldown metadata before the SDK projects a response into ApiError.
 * One transport belongs to one client operation; SDK retries remain disabled. */
export function createGeminiTransport(): { fetch: Fetch; retryAfter: () => string | null } {
  let retryAfter: string | null = null
  return {
    fetch: async (input, init) => {
      retryAfter = null
      const response = await fetch(input, init)
      retryAfter = response.headers.get('retry-after')
      return response
    },
    retryAfter: () => retryAfter,
  }
}
