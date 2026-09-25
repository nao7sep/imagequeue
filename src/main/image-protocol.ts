import { net, protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { IMAGE_SCHEME, parseImageUrl } from '../shared/image-url'
import { getSessionDir, resolveSessionDir } from './session'
import { assertSafeBaseName } from './utils/file-output'
import { log, serializeError } from './logger'

const IMAGE_EXTS = ['png', 'jpg', 'webp'] as const

/** Must run before the app is ready. `standard` + `secure` let <img> load it
 *  under the renderer's CSP; `stream` serves the file without buffering it. */
export function registerImageSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, stream: true } },
  ])
}

/** The on-disk file a request names, or null when it names nothing servable.
 *  Session id and base name are checked so a URL cannot leave the output tree. */
export async function resolveImageRequest(url: string): Promise<string | null> {
  const target = parseImageUrl(url)
  if (!target) return null
  let dir: string
  let baseName: string
  try {
    dir = target.session === 'current' ? getSessionDir() : resolveSessionDir(target.sessionId)
    baseName = assertSafeBaseName(target.baseName)
  } catch {
    return null
  }
  for (const ext of IMAGE_EXTS) {
    const candidate = path.join(dir, `${baseName}.${ext}`)
    try {
      await fs.promises.access(candidate, fs.constants.R_OK)
      return candidate
    } catch {
      // Not this extension; try the next.
    }
  }
  return null
}

/** Serves output images as file streams, off the main thread's I/O path. */
export function registerImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    try {
      const file = await resolveImageRequest(request.url)
      if (!file) return new Response(null, { status: 404 })
      return await net.fetch(pathToFileURL(file).toString())
    } catch (err) {
      log('warn', 'Output image could not be served', { error: serializeError(err) })
      return new Response(null, { status: 500 })
    }
  })
}
