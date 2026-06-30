// Streaming HTTPS download to a file, plus a streaming SHA-256. The CLI binary is
// ~170 MB, so it is written straight to disk as it arrives (never buffered in
// memory) and hashed by streaming the file back — keeping peak memory flat
// regardless of artifact size. Both reject on any failure; the caller stages
// into temp/ and discards on rejection.

import fs from 'fs'
import https from 'https'
import crypto from 'crypto'

const MAX_REDIRECTS = 5
// A generous ceiling so a misconfigured URL can't fill the disk, well above the
// real ~170 MB asset. Not a correctness check — integrity is the SHA-256 verify.
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024

export interface DownloadProgress {
  downloadedBytes: number
  totalBytes: number | null
}

/**
 * Download `url` to `destPath`, following https→https redirects only. Reports
 * progress (bytes so far, and the Content-Length total when the server sends
 * one) as the body streams. Rejects — and removes the partial file — on a non-2xx
 * status, a redirect to a non-https scheme, exceeding the size ceiling, or any
 * socket/timeout error.
 */
export function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (progress: DownloadProgress) => void,
  redirectsLeft = MAX_REDIRECTS
): Promise<void> {
  return new Promise((resolve, reject) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error(`Invalid download URL: ${url}`))
      return
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error(`Refusing non-https download URL: ${parsed.protocol}`))
      return
    }

    const request = https.get(
      url,
      { timeout: 30_000, headers: { 'User-Agent': 'ImageQueue' } },
      (response) => {
        const status = response.statusCode ?? 0

        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume()
          if (redirectsLeft <= 0) {
            reject(new Error('Download failed: too many redirects'))
            return
          }
          const next = new URL(response.headers.location, url).toString()
          downloadToFile(next, destPath, onProgress, redirectsLeft - 1).then(resolve, reject)
          return
        }

        if (status < 200 || status > 299) {
          response.resume()
          reject(new Error(`Download failed with HTTP ${response.statusCode ?? 'unknown'}`))
          return
        }

        const totalHeader = Number(response.headers['content-length'])
        const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null
        let downloadedBytes = 0

        const file = fs.createWriteStream(destPath)
        const fail = (err: Error): void => {
          file.destroy()
          fs.rm(destPath, { force: true }, () => reject(err))
        }

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length
          if (downloadedBytes > MAX_DOWNLOAD_BYTES) {
            request.destroy()
            fail(new Error('Download exceeded maximum size'))
            return
          }
          onProgress?.({ downloadedBytes, totalBytes })
        })

        response.pipe(file)
        file.on('error', fail)
        response.on('error', fail)
        file.on('finish', () => file.close((err) => (err ? fail(err) : resolve())))
      }
    )

    request.on('timeout', () => request.destroy(new Error('Download timed out')))
    request.on('error', reject)
  })
}

/** Stream a file through SHA-256 and return the lowercase hex digest. */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
