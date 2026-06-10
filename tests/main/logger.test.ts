import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initLogger, log, redact, serializeError, setLoggerDebug } from '../../src/main/logger'

const createdDirs: string[] = []

function freshSessionDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-log-'))
  createdDirs.push(dir)
  return dir
}

function readEntries(dir: string): Record<string, unknown>[] {
  const content = fs.readFileSync(path.join(dir, 'session.log'), 'utf-8')
  return content
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

const ISO_MS_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

// The logger keeps module-global state (the debug gate). Reset it before every
// test so a debug-enabling test can't leak into another via execution order.
beforeEach(() => {
  setLoggerDebug(false)
})

afterAll(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('redact', () => {
  it('replaces denied keys by exact, case-insensitive name', () => {
    expect(
      redact({ apiKey: 's', API_KEY: 's', api_key: 's', token: 't', Authorization: 'a', password: 'p', secret: 'x', keep: 1 })
    ).toEqual({
      apiKey: '[redacted]',
      API_KEY: '[redacted]',
      api_key: '[redacted]',
      token: '[redacted]',
      Authorization: '[redacted]',
      password: '[redacted]',
      secret: '[redacted]',
      keep: 1,
    })
  })

  it('never matches by substring', () => {
    const input = { tokenCount: 5, broken: 'x', myToken: 'y', apiKeyId: 'z' }
    expect(redact(input)).toEqual(input)
  })

  it('recurses through nested objects and arrays', () => {
    expect(
      redact({ outer: { password: 'p', ok: 1 }, list: [{ secret: 's' }, { ok: 2 }] })
    ).toEqual({ outer: { password: '[redacted]', ok: 1 }, list: [{ secret: '[redacted]' }, { ok: 2 }] })
  })

  it('is type-preserving and leaves non-matching values byte-identical', () => {
    const input = { n: 0, b: false, z: null, s: 'hi', arr: [1, 'two', true] }
    expect(redact(input)).toEqual(input)
  })

  it('passes non-plain objects through untouched instead of flattening them to {}', () => {
    const date = new Date('2026-06-10T03:15:42.123Z')
    const out = redact({ when: date, count: 3 }) as { when: Date; count: number }
    // The Date survives as a Date (so JSON.stringify renders its ISO string),
    // rather than being rebuilt into {} by Object.entries.
    expect(out.when).toBe(date)
    expect(out.count).toBe(3)
  })

  it('does not treat a field literally named message specially', () => {
    expect(redact({ message: 'hello' })).toEqual({ message: 'hello' })
  })

  it('collapses a true cycle to a marker instead of overflowing', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(() => redact(a)).not.toThrow()
    expect(redact(a)).toEqual({ name: 'a', self: '[circular]' })
  })

  it('processes a shared (diamond) reference fully in each position', () => {
    const shared = { secret: 's', ok: 1 }
    expect(redact({ a: shared, b: shared })).toEqual({
      a: { secret: '[redacted]', ok: 1 },
      b: { secret: '[redacted]', ok: 1 },
    })
  })
})

describe('serializeError', () => {
  it('captures name, message and stack', () => {
    const result = serializeError(new Error('boom'))
    expect(result.name).toBe('Error')
    expect(result.message).toBe('boom')
    expect(typeof result.stack).toBe('string')
  })

  it('preserves a custom error name', () => {
    class TimeoutError extends Error {
      constructor(message: string) {
        super(message)
        this.name = 'TimeoutError'
      }
    }
    expect(serializeError(new TimeoutError('slow')).name).toBe('TimeoutError')
  })

  it('follows the cause chain', () => {
    const root = new Error('root cause')
    const wrapped = new Error('wrapped', { cause: root })
    const result = serializeError(wrapped) as { cause: { message: string } }
    expect(result.cause.message).toBe('root cause')
  })

  it('does not overflow on a circular cause chain', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    ;(a as Error & { cause?: unknown }).cause = b
    expect(() => serializeError(a)).not.toThrow()
    const result = serializeError(a) as { cause: { cause: { circular?: boolean } } }
    // a -> cause b -> cause a (revisited) collapses to a marker.
    expect(result.cause.cause.circular).toBe(true)
  })

  it('preserves the fields of a non-Error object instead of stringifying to [object Object]', () => {
    const result = serializeError({ status: 401, body: { reason: 'unauthorized' } }) as {
      name: string
      value: { status: number; body: { reason: string } }
    }
    expect(result.name).toBe('Object')
    expect(result.value).toEqual({ status: 401, body: { reason: 'unauthorized' } })
  })

  it('handles non-Error primitives', () => {
    expect(serializeError('oops')).toEqual({ name: 'string', message: 'oops' })
    expect(serializeError(42)).toEqual({ name: 'number', message: '42' })
    expect(serializeError(null)).toEqual({ name: 'object', message: 'null' })
  })
})

describe('log', () => {
  it('does not throw before a session directory is set', async () => {
    // Use a freshly-evaluated module so logFilePath is guaranteed null
    // regardless of test order (the static import may have been pointed at a
    // file by another test).
    vi.resetModules()
    const fresh = await import('../../src/main/logger')
    expect(() => fresh.log('info', 'no target yet')).not.toThrow()
  })

  it('writes one JSON object per line carrying the envelope', () => {
    const dir = freshSessionDir()
    initLogger(dir)
    log('info', 'hello', { a: 1, nested: { b: 2 } })

    const entries = readEntries(dir)
    // initLogger emits the session-start line first.
    expect(entries[0].message).toBe('Session started')
    const entry = entries[1]
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('hello')
    expect(entry.a).toBe(1)
    expect(entry.nested).toEqual({ b: 2 })
    expect(entry.time).toMatch(ISO_MS_Z)
  })

  it('redacts denied keys in the written line', () => {
    const dir = freshSessionDir()
    initLogger(dir)
    log('info', 'config', { api_key: 'sk-secret', model: 'gpt-image-1', nested: { token: 'abc' } })

    const entry = readEntries(dir).at(-1)!
    expect(entry.api_key).toBe('[redacted]')
    expect(entry.model).toBe('gpt-image-1')
    expect(entry.nested).toEqual({ token: '[redacted]' })
  })

  it('does not let caller fields overwrite the reserved envelope keys', () => {
    const dir = freshSessionDir()
    initLogger(dir)
    log('error', 'real message', { level: 'info', message: 'spoofed', time: 'whenever', extra: 1 })

    const entry = readEntries(dir).at(-1)!
    expect(entry.level).toBe('error')
    expect(entry.message).toBe('real message')
    expect(entry.time).toMatch(ISO_MS_Z)
    expect(entry.extra).toBe(1)
  })

  it('suppresses debug when disabled and emits it when enabled', () => {
    const dir = freshSessionDir()
    initLogger(dir)

    setLoggerDebug(false)
    log('debug', 'debug-off')
    expect(readEntries(dir).some((e) => e.message === 'debug-off')).toBe(false)

    setLoggerDebug(true)
    log('debug', 'debug-on')
    expect(readEntries(dir).some((e) => e.message === 'debug-on')).toBe(true)
  })

  it('always writes info, warn and error regardless of the debug gate', () => {
    const dir = freshSessionDir()
    initLogger(dir)
    setLoggerDebug(false)
    log('info', 'i')
    log('warn', 'w')
    log('error', 'e')
    const messages = readEntries(dir).map((entry) => entry.message)
    expect(messages).toEqual(expect.arrayContaining(['i', 'w', 'e']))
  })

  it('falls back to a bare envelope when a field cannot be serialized', () => {
    const dir = freshSessionDir()
    initLogger(dir)
    // A BigInt cannot be JSON-serialized; the event must survive as a valid line.
    log('warn', 'bigint field', { n: BigInt(10) })

    const entry = readEntries(dir).at(-1)!
    expect(entry.message).toBe('bigint field')
    expect(entry.level).toBe('warn')
    expect(entry.time).toMatch(ISO_MS_Z)
    expect(entry.logSerializeError).toBe('fields not serializable')
    expect('n' in entry).toBe(false)
  })
})
