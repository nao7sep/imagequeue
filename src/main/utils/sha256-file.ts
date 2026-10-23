import crypto from 'node:crypto'
import fs from 'node:fs'

/** Stream a file through SHA-256 and return the lowercase hex digest. */
export function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    const abort = (): void => {
      const reason = signal!.reason ?? new Error('Operation cancelled')
      stream.destroy(reason instanceof Error ? reason : new Error(String(reason)))
    }
    const cleanup = (): void => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', (error) => {
      cleanup()
      reject(error)
    })
    stream.on('end', () => {
      cleanup()
      resolve(hash.digest('hex'))
    })
  })
}
