import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { PassThrough } from 'stream'
import type { IncomingMessage } from 'http'
import {
  writeDownloadResponse,
  parseAdvertisedLength,
  sha256File,
  withWholeOperationTimeout,
} from '../../../src/main/dependencies/download'

const tempDirs: string[] = []

function writeTemp(bytes: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-dl-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'artifact.bin')
  fs.writeFileSync(file, bytes)
  return file
}

afterEach(() => {
  vi.useRealTimers()
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('bounded transfers', () => {
  it('accepts only valid advertised lengths within the byte ceiling', () => {
    expect(parseAdvertisedLength(undefined, 10)).toBeNull()
    expect(parseAdvertisedLength('10', 10)).toBe(10)
    expect(() => parseAdvertisedLength('11', 10)).toThrow('exceeding the 10-byte limit')
    expect(() => parseAdvertisedLength('not-a-number', 10)).toThrow('invalid Content-Length')
  })

  it('aborts a whole operation at its deadline', async () => {
    vi.useFakeTimers()
    const operation = withWholeOperationTimeout(undefined, 100, 'Test transfer', (signal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    )
    const assertion = expect(operation).rejects.toThrow(
      'Test transfer exceeded its whole-operation timeout'
    )
    await vi.advanceTimersByTimeAsync(100)
    await assertion
  })

  it('preserves cancellation from the caller', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled by caller'))
    await expect(withWholeOperationTimeout(controller.signal, 100, 'Test transfer', async () => 1))
      .rejects.toThrow('cancelled by caller')
  })

  it('closes a real destination stream, syncs the complete bytes, and bounds progress delivery', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-dl-'))
    tempDirs.push(dir)
    const dest = path.join(dir, 'download.bin')
    const chunks = Array.from({ length: 256 }, (_, index) => Buffer.alloc(1024, index % 251))
    const bytes = Buffer.concat(chunks)
    const stream = new PassThrough()
    Object.assign(stream, {
      statusCode: 200,
      headers: { 'content-length': String(bytes.length) },
    })
    const progress: Array<{ downloadedBytes: number; totalBytes: number | null }> = []
    const limits = { maxBytes: bytes.length, idleTimeoutMs: 1000, wholeTimeoutMs: 5000 }

    const writing = writeDownloadResponse(
      stream as unknown as IncomingMessage,
      dest,
      limits,
      new AbortController().signal,
      (event) => progress.push(event)
    )
    for (const chunk of chunks) stream.write(chunk)
    stream.end()
    await writing

    expect(fs.readFileSync(dest).equals(bytes)).toBe(true)
    expect(progress.length).toBeLessThanOrEqual(3)
    expect(progress.at(-1)).toEqual({ downloadedBytes: bytes.length, totalBytes: bytes.length })
  })
})

describe('sha256File', () => {
  it('matches the reference digest for the file contents (the verify step)', async () => {
    const bytes = crypto.randomBytes(64 * 1024)
    const expected = crypto.createHash('sha256').update(bytes).digest('hex')
    expect(await sha256File(writeTemp(bytes))).toBe(expected)
  })

  it('hashes an empty file', async () => {
    const expected = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex')
    expect(await sha256File(writeTemp(Buffer.alloc(0)))).toBe(expected)
  })

  it('rejects when the file does not exist', async () => {
    await expect(sha256File(path.join(os.tmpdir(), 'iq-nope-does-not-exist'))).rejects.toThrow()
  })

  it('stops hashing when the caller cancels', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled by caller'))
    await expect(sha256File(writeTemp(crypto.randomBytes(64 * 1024)), controller.signal))
      .rejects.toThrow('cancelled by caller')
  })
})
