import fs from 'node:fs'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import https from 'node:https'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { APP_NAME } from '../../shared/app-identity'

const MAX_REDIRECTS = 5

export interface TransferLimits {
  idleTimeoutMs: number
  wholeTimeoutMs: number
}

export const CLI_DOWNLOAD_LIMITS: TransferLimits = {
  idleTimeoutMs: 30_000,
  // The CLI is currently about 170 MB. Four hours keeps a healthy very-slow
  // connection viable while ensuring that a trickling peer cannot run forever.
  wholeTimeoutMs: 4 * 60 * 60 * 1000,
}

export const RELEASE_METADATA_LIMITS: TransferLimits = {
  idleTimeoutMs: 10_000,
  wholeTimeoutMs: 60_000,
}

export const RECOMMENDATIONS_LIMITS: TransferLimits = {
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

// Content-Length gives the progress total and the length a body must reach.
// Any size is accepted: the app makes sure its addresses are correct, and a
// correct address serving far too much means the server itself is broken.
export function parseAdvertisedLength(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return null
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Response has an invalid Content-Length')
  }
  return value
}

function parseContentLength(response: IncomingMessage): number | null {
  return parseAdvertisedLength(response.headers['content-length'])
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
  headers: Record<string, string>,
  method: 'GET' | 'HEAD' = 'GET'
): Promise<IncomingMessage> {
  validateHttpsUrl(url)
  return new Promise((resolve, reject) => {
    let settled = false
    const request = https.request(url, { method, signal, headers }, (response) => {
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
    request.end()
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

export interface FetchedBytes {
  body: Buffer
  headers: IncomingHttpHeaders
}

async function fetchBytesHop(
  url: string,
  limits: TransferLimits,
  signal: AbortSignal,
  headers: Record<string, string>,
  redirectsLeft: number
): Promise<FetchedBytes> {
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
    parseContentLength(response)
    const chunks: Buffer[] = []
    for await (const value of response) {
      signal.throwIfAborted()
      chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value))
    }
    return { body: Buffer.concat(chunks), headers: response.headers }
  } finally {
    response.destroy()
  }
}

/** Fetch a small metadata or structured-data body, with the final response's
 * headers, under HTTPS, redirect, idle, and whole-operation bounds. */
export function fetchBytesWithHeaders(
  url: string,
  limits: TransferLimits,
  signal?: AbortSignal,
  headers: Record<string, string> = { 'User-Agent': APP_NAME }
): Promise<FetchedBytes> {
  return withWholeOperationTimeout(signal, limits.wholeTimeoutMs, 'Network transfer', (boundedSignal) =>
    fetchBytesHop(url, limits, boundedSignal, headers, MAX_REDIRECTS)
  )
}

/** Fetch a small metadata or structured-data body under the same bounds. */
export async function fetchBytes(
  url: string,
  limits: TransferLimits,
  signal?: AbortSignal,
  headers: Record<string, string> = { 'User-Agent': APP_NAME }
): Promise<Buffer> {
  return (await fetchBytesWithHeaders(url, limits, signal, headers)).body
}

async function fetchHeadersHop(
  url: string,
  limits: TransferLimits,
  signal: AbortSignal,
  headers: Record<string, string>,
  redirectsLeft: number
): Promise<IncomingHttpHeaders> {
  const response = await requestResponse(url, limits, signal, headers, 'HEAD')
  try {
    const next = redirectTarget(response, url)
    if (next) {
      if (redirectsLeft <= 0) throw new Error('Request failed: too many redirects')
      return fetchHeadersHop(next, limits, signal, headers, redirectsLeft - 1)
    }
    assertSuccessfulResponse(response)
    return response.headers
  } finally {
    response.destroy()
  }
}

/** Ask for a resource's headers alone (an HTTP HEAD), following redirects under
 * the same HTTPS, idle, and whole-operation bounds. No body is transferred. */
export function fetchHeaders(
  url: string,
  limits: TransferLimits,
  signal?: AbortSignal,
  headers: Record<string, string> = { 'User-Agent': APP_NAME }
): Promise<IncomingHttpHeaders> {
  return withWholeOperationTimeout(signal, limits.wholeTimeoutMs, 'Network request', (boundedSignal) =>
    fetchHeadersHop(url, limits, boundedSignal, headers, MAX_REDIRECTS)
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
  const response = await requestResponse(url, limits, signal, { 'User-Agent': APP_NAME })
  const next = redirectTarget(response, url)
  if (next) {
    response.destroy()
    if (redirectsLeft <= 0) throw new Error('Download failed: too many redirects')
    return downloadHop(next, destPath, limits, signal, onProgress, redirectsLeft - 1)
  }

  return writeDownloadResponse(response, destPath, signal, onProgress)
}

/** Persist one accepted response body and durably sync it. Exported so the real
 * stream lifecycle is regression-tested without a network mock: pipeline must
 * observe its destination close, and progress must be bounded before it crosses
 * the renderer IPC boundary. */
export async function writeDownloadResponse(
  response: IncomingMessage,
  destPath: string,
  signal: AbortSignal,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  let syncHandle: fs.promises.FileHandle | null = null
  let ownsDestination = false
  let completed = false
  try {
    assertSuccessfulResponse(response)
    const advertisedBytes = parseContentLength(response)
    let downloadedBytes = 0
    let lastReportedAt = 0
    let lastReportedBytes = -1
    const reportProgress = (force = false): void => {
      if (!onProgress || downloadedBytes === lastReportedBytes) return
      const now = Date.now()
      if (!force && lastReportedBytes >= 0 && now - lastReportedAt < 100) return
      lastReportedAt = now
      lastReportedBytes = downloadedBytes
      onProgress({ downloadedBytes, totalBytes: advertisedBytes })
    }
    const meter = new Transform({
      transform(value: Buffer, _encoding, callback): void {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
        downloadedBytes += chunk.length
        reportProgress(downloadedBytes === chunk.length || downloadedBytes === advertisedBytes)
        callback(null, chunk)
      },
    })

    // A pipeline resolves after its destination closes. The former
    // FileHandle stream used autoClose:false and therefore reached 100% then
    // waited forever for the close it had explicitly disabled. Let the stream
    // own its descriptor, then reopen the completed file solely for fsync.
    const output = fs.createWriteStream(destPath, { flags: 'wx' })
    output.once('open', () => { ownsDestination = true })
    await pipeline(response, meter, output, { signal })
    if (advertisedBytes !== null && downloadedBytes !== advertisedBytes) {
      throw new Error('Download ended before its advertised Content-Length')
    }
    reportProgress(true)
    syncHandle = await fs.promises.open(destPath, 'r+')
    await syncHandle.sync()
    completed = true
  } finally {
    response.destroy()
    // Cleanup must not replace the transfer error that brought us here.
    await syncHandle?.close().catch(() => undefined)
    // A rejected URL, response or exclusive open never grants ownership of an
    // existing path. Pipeline has settled the writer before removing our stage.
    if (ownsDestination && !completed) await fs.promises.rm(destPath, { force: true }).catch(() => undefined)
  }
}

/** Download the CLI artifact into its unique staging path. Staged bytes are
 * synced before success; failures remove only the stage this transfer created. */
export async function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  await withWholeOperationTimeout(
    signal,
    CLI_DOWNLOAD_LIMITS.wholeTimeoutMs,
    'CLI download',
    (boundedSignal) =>
      downloadHop(url, destPath, CLI_DOWNLOAD_LIMITS, boundedSignal, onProgress, MAX_REDIRECTS)
  )
}
