// Output images reach the renderer as URLs on the app's own scheme, served by
// the main process as a file stream. An <img> with loading="lazy" then fetches
// and decodes only what is on screen, instead of every image being read whole
// on the main thread and shipped over IPC as base64.

export const IMAGE_SCHEME = 'iq-image'
const HOST = 'output'

export type ImageUrlTarget =
  | { session: 'current'; baseName: string }
  | { session: 'other'; sessionId: string; baseName: string }

/** An output image of the active session. */
export function currentSessionImageUrl(baseName: string): string {
  return `${IMAGE_SCHEME}://${HOST}/current/${encodeURIComponent(baseName)}`
}

/** An output image of any listed session, by its id. */
export function sessionImageUrl(sessionId: string, baseName: string): string {
  return `${IMAGE_SCHEME}://${HOST}/session/${encodeURIComponent(sessionId)}/${encodeURIComponent(baseName)}`
}

/** Reads a URL built above; anything else is null. Names are not validated
 *  here — the main process checks them against the output tree. */
export function parseImageUrl(url: string): ImageUrlTarget | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${IMAGE_SCHEME}:` || parsed.host !== HOST) return null
  let parts: string[]
  try {
    parts = parsed.pathname.split('/').slice(1).map(decodeURIComponent)
  } catch {
    return null
  }
  if (parts.length === 2 && parts[0] === 'current' && parts[1]) {
    return { session: 'current', baseName: parts[1] }
  }
  if (parts.length === 3 && parts[0] === 'session' && parts[1] && parts[2]) {
    return { session: 'other', sessionId: parts[1], baseName: parts[2] }
  }
  return null
}
