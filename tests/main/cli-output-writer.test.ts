import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCliOutputWriter, CLI_OUTPUT_WRITE_TIMEOUT_MS } from '../../src/main/cli-output-writer'

const roots: string[] = []
const root = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-cli-output-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('streamed CLI diagnostic sink', () => {
  it('retains complete UTF-8/CR output, uses bounded backpressure, and closes an owner-only file', async () => {
    const dir = root()
    const writer = createCliOutputWriter(path.join(dir, 'nested'), 'out.log', 'stdout', () => ['secret-key'])
    const chunk = '日本語 😀\r'.repeat(8192) + 'secret-key\n'
    let expected = ''
    for (let index = 0; index < 8; index++) {
      expected += chunk.replace('secret-key', '[REDACTED]')
      let resume!: () => void
      const drained = new Promise<void>((resolve) => { resume = resolve })
      if (!writer.append(chunk, resume)) await drained
    }
    await writer.finish()
    expect(writer.error).toBeUndefined()
    const file = path.join(dir, 'nested', 'out.log')
    expect(fs.readFileSync(file, 'utf8')).toBe(expected)
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })

  it('resumes on disk failure and settles the optional sink without changing the process result', async () => {
    const dir = root()
    fs.writeFileSync(path.join(dir, 'blocked'), 'a file cannot be a directory')
    const report = vi.fn()
    const writer = createCliOutputWriter(path.join(dir, 'blocked'), 'out.log', 'stdout', () => [], report)
    const resume = vi.fn()
    expect(writer.append('x'.repeat(64 * 1024), resume)).toBe(false)
    await writer.finish()
    expect(writer.error).toMatchObject({ code: 'EEXIST' })
    expect(resume).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledOnce()
    expect(writer.append('later output', vi.fn())).toBe(true)
  })

  it('bounds a stalled actual file write and keeps its descriptor open until the write settles', async () => {
    const dir = root()
    const originalWrite = fs.write
    const held: Array<() => void> = []
    vi.spyOn(fs, 'write').mockImplementation(((...args: unknown[]) => {
      held.push(() => Reflect.apply(originalWrite, fs, args))
    }) as typeof fs.write)
    const close = vi.spyOn(fs, 'close')
    const report = vi.fn()
    const resume = vi.fn()
    vi.useFakeTimers()
    const writer = createCliOutputWriter(dir, 'slow.log', 'stdout', () => [], report)
    expect(writer.append('x'.repeat(64 * 1024), resume)).toBe(false)
    await vi.waitFor(() => expect(held).toHaveLength(1))
    const finishing = writer.finish()
    vi.advanceTimersByTime(CLI_OUTPUT_WRITE_TIMEOUT_MS)
    await finishing
    expect(writer.error).toBeInstanceOf(Error)
    expect(report).toHaveBeenCalledOnce()
    expect(resume).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    vi.useRealTimers()
    held.shift()!()
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(fs.readFileSync(path.join(dir, 'slow.log'), 'utf8')).toBe('x'.repeat(64 * 1024))
  })

  it('bounds stalled construction before the stream can emit an error and resumes its source', async () => {
    const dir = root()
    const originalMkdir = fs.mkdir
    let release!: () => void
    vi.spyOn(fs, 'mkdir').mockImplementation(((...args: unknown[]) => {
      release = () => Reflect.apply(originalMkdir, fs, args)
    }) as typeof fs.mkdir)
    const close = vi.spyOn(fs, 'close')
    const resume = vi.fn()
    vi.useFakeTimers()
    const writer = createCliOutputWriter(dir, 'construct.log', 'stdout', () => [])
    expect(writer.append('x'.repeat(64 * 1024), resume)).toBe(false)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    vi.advanceTimersByTime(CLI_OUTPUT_WRITE_TIMEOUT_MS)
    await writer.finish()
    expect(resume).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    vi.useRealTimers()
    release()
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  })

  it('detaches console fallback listeners after a masked streamed write completes', async () => {
    const errorCount = process.stdout.listenerCount('error')
    const drainCount = process.stdout.listenerCount('drain')
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((text: string, _encoding: string, callback: () => void) => {
      callback()
      return true
    }) as typeof process.stdout.write)
    const writer = createCliOutputWriter(null, 'unused.log', 'stdout', () => ['key'])
    writer.append('a key\r', vi.fn())
    await writer.finish()
    expect(write.mock.calls[0][0]).toBe('a [REDACTED]\r')
    expect(process.stdout.listenerCount('error')).toBe(errorCount)
    expect(process.stdout.listenerCount('drain')).toBe(drainCount)
    expect(writer.file).toBeNull()
  })
})
