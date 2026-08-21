import crypto from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage } from 'node:http'
import https from 'node:https'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MAX_REDIRECTS = 5

export interface TransferLimits {
  maxBytes: number
  idleTimeoutMs: number
  wholeTimeoutMs: number
}

export const CLI_DOWNLOAD_LIMITS: TransferLimits = {
  maxBytes: 1024 * 1024 * 1024,
  idleTimeoutMs: 30_000,
  // The CLI is currently about 170 MB. Four hours keeps a healthy very-slow
  // connection viable while ensuring that a trickling peer cannot run forever.
  wholeTimeoutMs: 4 * 60 * 60 * 1000,
}

export const RELEASE_METADATA_LIMITS: TransferLimits = {
  maxBytes: 2 * 1024 * 1024,
  idleTimeoutMs: 10_000,
  wholeTimeoutMs: 60_000,
}

export const RECOMMENDATIONS_LIMITS: TransferLimits = {
  maxBytes: 16 * 1024 * 1024,
  idleTimeoutMs: 10_000,
  wholeTimeoutMs: 2 * 60 * 1000,
}

export interface DownloadProgress {
  downloadedBytes: number
  totalBytes: number | null
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Operation cancelled')
}

/** Run one complete operation under a deadline while preserving caller cancellation. */
export async function withWholeOperationTimeout<T>(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  label: string,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (parentSignal?.aborted) throw abortReason(parentSignal)

  const controller = new AbortController()
  const abortFromParent = (): void => controller.abort(abortReason(parentSignal!))
  parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const timer = setTimeout(
    () => controller.abort(new Error(`${label} exceeded its whole-operation timeout`)),
    timeoutMs
  )
  timer.unref()

  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

export function parseAdvertisedLength(
  raw: string | string[] | undefined,
  maxBytes: number
): number | null {
  if (raw === undefined) return null
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Response has an invalid Content-Length')
  }
  if (value > maxBytes) {
    throw new Error(`Response advertises ${value} bytes, exceeding the ${maxBytes}-byte limit`)
  }
  return value
}

function parseContentLength(response: IncomingMessage, maxBytes: number): number | null {
  return parseAdvertisedLength(response.headers['content-length'], maxBytes)
}

function validateHttpsUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid download URL: ${url}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Refusing non-https download URL: ${parsed.protocol}`)
  }
  return parsed
}

function requestResponse(
  url: string,
  limits: TransferLimits,
  signal: AbortSignal,
  headers: Record<string, string>
): Promise<IncomingMessage> {
  validateHttpsUrl(url)
  return new Promise((resolve, reject) => {
    let settled = false
    const request = https.get(url, { signal, headers }, (response) => {
      if (settled) {
        response.destroy()
        return
      }
      settled = true
      resolve(response)
    })
    // This is the idle bound once a socket exists. The enclosing deadline also
    // covers DNS, connect, TLS, redirects, and the complete response body.
    request.setTimeout(limits.idleTimeoutMs, () => {
      request.destroy(new Error('Network transfer timed out while idle'))
    })
    // Keep the listener after response settlement: a later socket failure must
    // never become an unhandled ClientRequest error. The response/pipeline owns
    // rejection after headers have arrived.
    request.on('error', (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
  })
}

function redirectTarget(response: IncomingMessage, currentUrl: string): string | null {
  const status = response.statusCode ?? 0
  if (status < 300 || status >= 400 || !response.headers.location) return null
  return new URL(response.headers.location, currentUrl).toString()
}

function assertSuccessfulResponse(response: IncomingMessage): void {
  const status = response.statusCode ?? 0
  if (status < 200 || status > 299) {
    throw new Error(`Download failed with HTTP ${response.statusCode ?? 'unknown'}`)
  }
}

async function fetchBytesHop(
  url: string,
  limits: TransferLimits,
  signal: AbortSignal,
  headers: Record<string, string>,
  redirectsLeft: number
): Promise<Buffer> {
  const response = await requestResponse(url, limits, signal, headers)
  const next = redirectTarget(response, url)
  if (next) {
    response.destroy()
    if (redirectsLeft <= 0) throw new Error('Download failed: too many redirects')
    // The next hop is validated before it is requested, so an HTTPS→HTTP→HTTPS
    // chain is refused at the downgrade rather than accepted at its final URL.
    return fetchBytesHop(next, limits, signal, headers, redirectsLeft - 1)
  }

  try {
    assertSuccessfulResponse(response)
    parseContentLength(response, limits.maxBytes)
    const chunks: Buffer[] = []
    let total = 0
    for await (const value of response) {
      signal.throwIfAborted()
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      const nextTotal = total + chunk.length
      if (nextTotal > limits.maxBytes) {
        throw new Error(`Download exceeded the ${limits.maxBytes}-byte limit`)
      }
      total = nextTotal
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, total)
  } finally {
    response.destroy()
  }
}

/** Fetch a small metadata or structured-data body with HTTPS, redirect, size,
 * idle, and whole-operation bounds. */
export function fetchBytes(
  url: string,
  limits: TransferLimits,
  signal?: AbortSignal,
  headers: Record<string, string> = { 'User-Agent': 'ImageQueue' }
): Promise<Buffer> {
  return withWholeOperationTimeout(signal, limits.wholeTimeoutMs, 'Network transfer', (boundedSignal) =>
    fetchBytesHop(url, limits, boundedSignal, headers, MAX_REDIRECTS)
  )
}

async function downloadHop(
  url: string,
  destPath: string,
  limits: TransferLimits,
  signal: AbortSignal,
  onProgress: ((progress: DownloadProgress) => void) | undefined,
  redirectsLeft: number
): Promise<void> {
  const response = await requestResponse(url, limits, signal, { 'User-Agent': 'ImageQueue' })
  const next = redirectTarget(response, url)
  if (next) {
    response.destroy()
    if (redirectsLeft <= 0) throw new Error('Download failed: too many redirects')
    return downloadHop(next, destPath, limits, signal, onProgress, redirectsLeft - 1)
  }

  let handle: fs.promises.FileHandle | null = null
  try {
    assertSuccessfulResponse(response)
    const advertisedBytes = parseContentLength(response, limits.maxBytes)
    let downloadedBytes = 0
    const meter = new Transform({
      transform(value: Buffer, _encoding, callback): void {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
        const nextTotal = downloadedBytes + chunk.length
        // Reject before forwarding the chunk, so the byte that crosses the
        // ceiling is never written to staging.
        if (nextTotal > limits.maxBytes) {
          callback(new Error(`Download exceeded the ${limits.maxBytes}-byte limit`))
          return
        }
        downloadedBytes = nextTotal
        onProgress?.({ downloadedBytes, totalBytes: advertisedBytes })
        callback(null, chunk)
      },
    })

    handle = await fs.promises.open(destPath, 'w')
    const output = handle.createWriteStream({ autoClose: false })
    await pipeline(response, meter, output, { signal })
    await handle.sync()
  } finally {
    response.destroy()
    // Cleanup must not replace the transfer/limit error that brought us here.
    await handle?.close().catch(() => undefined)
  }
}

/** Download the CLI artifact into its unique staging path. Staged bytes are
 * synced before success; every failure removes the partial staging file. */
export async function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  try {
    await withWholeOperationTimeout(
      signal,
      CLI_DOWNLOAD_LIMITS.wholeTimeoutMs,
      'CLI download',
      (boundedSignal) =>
        downloadHop(url, destPath, CLI_DOWNLOAD_LIMITS, boundedSignal, onProgress, MAX_REDIRECTS)
    )
  } catch (error) {
    await fs.promises.rm(destPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Stream a file through SHA-256 and return the lowercase hex digest. */
export function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    const abort = (): void => {
      const reason = abortReason(signal!)
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
