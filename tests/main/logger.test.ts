import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { log, serializeError, setLoggerDebug, shouldEnableDebugLogging } from '../../src/main/logger'
import { freshRecordsRoot, readLog, removeRecordsRoots } from './records-fixture'

const ISO_MS_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

// The logger keeps module-global state (the debug gate). Reset it before every
// test so a debug-enabling test can't leak into another via execution order.
beforeEach(() => {
  setLoggerDebug(false)
})

afterAll(() => {
  removeRecordsRoots()
})

describe('serializeError', () => {
  it('preserves aggregate member failures and a reused cause through JSON', () => {
    const original = Object.assign(new Error('native query failed'), {
      operation: 'ReadNativeState', nativeCode: 6,
    })
    const fallback = Object.assign(new Error('native fallback failed'), {
      operation: 'ResetNativeState', nativeCode: 5,
    })
    const aggregate = new AggregateError([original, fallback], 'native operation failed', { cause: original })
    const serialized = JSON.parse(JSON.stringify(serializeError(aggregate)))
    expect(serialized).toMatchObject({
      name: 'AggregateError',
      cause: { message: original.message, stack: original.stack, operation: 'ReadNativeState', nativeCode: 6 },
      errors: [
        { message: original.message, stack: original.stack, operation: 'ReadNativeState', nativeCode: 6 },
        { message: fallback.message, stack: fallback.stack, operation: 'ResetNativeState', nativeCode: 5 },
      ],
    })
  })

  it('contains a self-referential aggregate', () => {
    const aggregate = new AggregateError([], 'cycle')
    aggregate.errors.push(aggregate)
    expect(() => JSON.stringify(serializeError(aggregate))).not.toThrow()
  })
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

describe('shouldEnableDebugLogging', () => {
  it('enables debug automatically for development builds', () => {
    expect(shouldEnableDebugLogging({ isPackaged: false })).toBe(true)
    expect(shouldEnableDebugLogging({ isPackaged: false, imagequeueDebug: '0' })).toBe(true)
  })

  it('keeps packaged builds quiet unless IMAGEQUEUE_DEBUG is exactly 1', () => {
    expect(shouldEnableDebugLogging({ isPackaged: true })).toBe(false)
    expect(shouldEnableDebugLogging({ isPackaged: true, imagequeueDebug: '' })).toBe(false)
    expect(shouldEnableDebugLogging({ isPackaged: true, imagequeueDebug: '0' })).toBe(false)
    expect(shouldEnableDebugLogging({ isPackaged: true, imagequeueDebug: 'true' })).toBe(false)
    expect(shouldEnableDebugLogging({ isPackaged: true, imagequeueDebug: '1' })).toBe(true)
  })
})

describe('log', () => {
  it('does not throw before the records are open', async () => {
    vi.resetModules()
    const fresh = await import('../../src/main/logger')
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(() => fresh.log('info', 'no target yet')).not.toThrow()
    expect(consoleLog.mock.calls.flat().map(String).join('\n')).toContain('no target yet')
    consoleLog.mockRestore()
  })

  it('writes one record per line carrying the envelope', () => {
    const dir = freshRecordsRoot()
    log('info', 'hello', { a: 1, nested: { b: 2 } })

    const entries = readLog(dir)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('hello')
    expect(entry.a).toBe(1)
    expect(entry.nested).toEqual({ b: 2 })
    expect(entry.time).toMatch(ISO_MS_Z)
    expect(entry.launch).toMatch(ISO_MS_Z)
  })

  it('writes every field as given, with no redaction (logging conventions)', () => {
    const dir = freshRecordsRoot()
    log('info', 'config', { api_key: 'sk-secret', model: 'gpt-image-1', nested: { token: 'abc' } })

    const entry = readLog(dir).at(-1)!
    expect(entry.api_key).toBe('sk-secret')
    expect(entry.model).toBe('gpt-image-1')
    expect(entry.nested).toEqual({ token: 'abc' })
  })

  it('does not let caller fields overwrite the reserved envelope keys', () => {
    const dir = freshRecordsRoot()
    log('error', 'real message', { level: 'info', message: 'spoofed', time: 'whenever', extra: 1 })

    const entry = readLog(dir).at(-1)!
    expect(entry.level).toBe('error')
    expect(entry.message).toBe('real message')
    expect(entry.time).toMatch(ISO_MS_Z)
    expect(entry.extra).toBe(1)
  })

  it('suppresses debug when disabled and emits it when enabled', () => {
    const dir = freshRecordsRoot()

    setLoggerDebug(false)
    log('debug', 'debug-off')
    expect(readLog(dir).some((e) => e.message === 'debug-off')).toBe(false)

    setLoggerDebug(true)
    log('debug', 'debug-on')
    expect(readLog(dir).some((e) => e.message === 'debug-on')).toBe(true)
  })

  it('always writes info, warn and error regardless of the debug gate', () => {
    const dir = freshRecordsRoot()
    setLoggerDebug(false)
    log('info', 'i')
    log('warn', 'w')
    log('error', 'e')
    expect(readLog(dir).map((entry) => entry.message)).toEqual(['i', 'w', 'e'])
  })

  it('keeps the event when a field cannot be serialized', () => {
    const dir = freshRecordsRoot()
    log('warn', 'bigint field', { n: BigInt(10) })

    const entry = readLog(dir).at(-1)!
    expect(entry.message).toBe('bigint field')
    expect(entry.level).toBe('warn')
    expect(typeof entry.recordSerializeError).toBe('string')
    expect('n' in entry).toBe(false)
  })
})
