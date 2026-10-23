import fs from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { addAbortSignal, Readable } from 'node:stream'
import { protocol, type WebContents } from 'electron'
import { AUDIO_SCHEME } from '../shared/audio-url'
import { loadConfig } from './config'
import { authorizedSoundFile, grantedSoundFile } from './sound-file-grants'
import { resolveSettingsPath } from './utils/user-path'
import { waitForStorage } from './utils/storage-wait'
import { log, serializeError } from './logger'

interface SoundResource {
  sender: WebContents
  requested: string
  canonical: string
  url: string
  streams: Set<fs.ReadStream>
}
interface SoundOwner { revision: number; resource: SoundResource | null }
const owners = new WeakMap<WebContents, SoundOwner>()
const resources = new Map<string, SoundResource>()

function configured(file: string): boolean {
  const { success_file, failure_file } = loadConfig().notifications
  return [success_file, failure_file].some((value) => value && resolveSettingsPath(value, os.homedir()) === file)
}
function release(resource: SoundResource): void {
  resources.delete(resource.url)
  for (const stream of resource.streams) stream.destroy()
  resource.streams.clear()
}
function ownerFor(sender: WebContents): SoundOwner {
  let owner = owners.get(sender)
  if (owner) return owner
  owner = { revision: 0, resource: null }
  owners.set(sender, owner)
  const current = owner
  const forget = (): void => {
    sender.removeListener('destroyed', forget)
    sender.removeListener('render-process-gone', forget)
    sender.removeListener('did-start-navigation', navigating)
    owners.delete(sender)
    current.revision++
    if (current.resource) release(current.resource)
    current.resource = null
  }
  const navigating = (_event: Electron.Event, _url: string, isInPlace: boolean, isMainFrame: boolean): void => {
    if (isMainFrame && !isInPlace) forget()
  }
  sender.once('destroyed', forget)
  sender.once('render-process-gone', forget)
  sender.on('did-start-navigation', navigating)
  return owner
}

export async function loadAudioFile(filePath: string, sender: WebContents): Promise<string | null> {
  const owner = ownerFor(sender)
  const revision = ++owner.revision
  if (owner.resource) release(owner.resource)
  owner.resource = null
  if (!filePath) return null
  const requested = resolveSettingsPath(filePath, os.homedir())
  if (!configured(requested)) return null
  // Storage waits are bounded inside the grant owner; native consent is not.
  const canonical = await authorizedSoundFile(requested, sender)
  if (!canonical || sender.isDestroyed() || owner.revision !== revision || !configured(requested)) return null
  const url = `${AUDIO_SCHEME}://sound/${randomUUID()}`
  const resource: SoundResource = { sender, requested, canonical, url, streams: new Set() }
  owner.resource = resource
  resources.set(url, resource)
  return url
}

export function releaseAudioFile(url: string, sender: WebContents): void {
  const owner = owners.get(sender)
  if (owner?.resource?.url !== url) return
  release(owner.resource)
  owner.resource = null
}

async function closeFile(file: FileHandle): Promise<void> {
  try { await file.close() }
  catch (error) { log('warn', 'Audio file could not be closed', { error: serializeError(error) }) }
}

async function openResource(resource: SoundResource): Promise<{ file: FileHandle; size: number } | null> {
  if (resources.get(resource.url) !== resource || !configured(resource.requested)
    || await grantedSoundFile(resource.requested) !== resource.canonical
    || resources.get(resource.url) !== resource) return null
  const file = await fs.promises.open(resource.canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    // Bind the stream to the file checked under the canonical grant. A moved
    // parent/link during open cannot turn a grant into another file's bytes.
    const canonical = await fs.promises.realpath(resource.requested)
    const current = await fs.promises.stat(canonical)
    if (!stat.isFile() || canonical !== resource.canonical || current.dev !== stat.dev || current.ino !== stat.ino
      || !configured(resource.requested) || resources.get(resource.url) !== resource || resource.sender.isDestroyed()) {
      await closeFile(file)
      return null
    }
    return { file, size: stat.size }
  } catch (error) {
    await closeFile(file)
    throw error
  }
}

function byteRange(value: string | null, size: number): { start: number; end: number } | null {
  if (value === null) return { start: 0, end: size - 1 }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || size === 0) return null
  const first = match[1] ? Number(match[1]) : null
  const last = match[2] ? Number(match[2]) : null
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null
  const start = first ?? Math.max(0, size - last!)
  const end = first === null ? size - 1 : Math.min(last ?? size - 1, size - 1)
  return start < size && end >= start ? { start, end } : null
}

/** An opaque resource streams only its granted file; every request rechecks it. */
export async function serveAudio(request: Request): Promise<Response> {
  const resource = resources.get(request.url)
  if (!resource || resource.sender.isDestroyed()) return new Response(null, { status: 404 })
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  if (request.signal.aborted) return new Response(null, { status: 410 })
  let file: FileHandle | null = null
  try {
    const opening = openResource(resource)
    const opened = await waitForStorage(opening).catch((error: unknown) => {
      // A caller deadline cannot cancel an issued filesystem read/open. Its
      // continuation still owns any handle it eventually produces.
      void opening.then((late) => late ? closeFile(late.file) : undefined, () => {})
      throw error
    })
    if (!opened) return new Response(null, { status: 403 })
    file = opened.file
    if (request.signal.aborted || resources.get(request.url) !== resource) return new Response(null, { status: 410 })
    const rangeHeader = request.headers.get('range')
    const range = byteRange(rangeHeader, opened.size)
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${opened.size}` } })
    const mime: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' }
    const headers: Record<string, string> = {
      'Content-Type': mime[path.extname(resource.requested).slice(1).toLowerCase()] ?? 'audio/mpeg',
      'Content-Length': String(range.end - range.start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }
    if (rangeHeader !== null) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${opened.size}`
    const status = rangeHeader === null ? 200 : 206
    if (request.method === 'HEAD' || opened.size === 0) return new Response(null, { status, headers })
    const stream = file.createReadStream({ start: range.start, end: range.end, autoClose: true })
    file = null // The stream owns the open handle through end, error or abort.
    resource.streams.add(stream)
    stream.once('close', () => resource.streams.delete(stream))
    stream.once('error', (error) => {
      if (!request.signal.aborted && resources.has(resource.url)) log('warn', 'Custom audio stream failed', { error: serializeError(error) })
    })
    addAbortSignal(request.signal, stream)
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
  } catch (error) {
    log('warn', 'Custom audio could not be served', { error: serializeError(error) })
    return new Response(null, { status: 500 })
  } finally { if (file) void closeFile(file) }
}

export function registerAudioProtocol(): void {
  protocol.handle(AUDIO_SCHEME, serveAudio)
}
