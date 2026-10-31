import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../../src/main/ipc-boundary', () => ({ handle: vi.fn() }))
vi.mock('../../src/main/records-window', () => ({ openRecordsWindow: vi.fn() }))
vi.mock('../../src/main/records', () => ({
  currentRecordsContext: () => ({ launch: '2026-10-04T00:00:00.000Z', session: '20261004-000000-utc' }),
  readRecords: mocks.read,
}))
import { handle } from '../../src/main/ipc-boundary'
import type { IpcMainInvokeEvent } from 'electron'
import { assertRecordKind, assertRecordsQuery, readRecordSources, registerRecordsIpc } from '../../src/main/records-ipc'

const valid = { launch: null, session: null, kind: null, level: null, search: '', after: null }

describe('records IPC validation', () => {
  it('accepts every filter the window can send', () => {
    expect(() => assertRecordsQuery(valid)).not.toThrow()
    expect(() => assertRecordsQuery({
      launch: 'l', session: 's', kind: 'ai-call', level: 'warningsAndErrors', search: 'x',
      after: { time: '2026-01-01T00:00:00.000Z', kind: 'log', id: 4 },
    })).not.toThrow()
  })

  it('rejects anything else', () => {
    for (const bad of [
      null,
      { ...valid, launch: 4 },
      { ...valid, session: {} },
      { ...valid, kind: 'provider-call' },
      { ...valid, level: 'fatal' },
      { ...valid, search: null },
      { ...valid, after: { time: 't', kind: 'log', id: 1.5 } },
      { ...valid, after: { time: 't', kind: 'other', id: 1 } },
      { ...valid, after: 'next' },
    ]) {
      expect(() => assertRecordsQuery(bad), JSON.stringify(bad)).toThrow(/Invalid IPC parameter/)
    }
    expect(() => assertRecordKind('log')).not.toThrow()
    expect(() => assertRecordKind('cli-job')).not.toThrow()
    expect(() => assertRecordKind('card')).toThrow(/Invalid IPC parameter/)
  })
})

describe('readRecordSources', () => {
  it('adds the launch and session open now to what the database lists', async () => {
    mocks.read.mockResolvedValue({ launches: ['b', 'a'], sessions: ['s2'] })
    await expect(readRecordSources()).resolves.toEqual({
      currentLaunch: '2026-10-04T00:00:00.000Z',
      currentSession: '20261004-000000-utc',
      launches: ['b', 'a'],
      sessions: ['s2'],
    })
    expect(mocks.read).toHaveBeenCalledWith({ op: 'sources' })
  })
})


describe('record output IPC boundary', () => {
  it('admits only a record identity, stream and nonnegative cursor, never a path', async () => {
    registerRecordsIpc()
    const output = vi.mocked(handle).mock.calls.find(([channel]) => channel === 'records:output')![1]
    const event = {} as IpcMainInvokeEvent
    mocks.read.mockReset().mockResolvedValue({ text: 'raw\r\n', nextOffset: 65536 })
    await expect(output(event, 4, 'stdout', 0)).resolves.toEqual({ text: 'raw\r\n', nextOffset: 65536 })
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ op: 'output', id: 4, stream: 'stdout', offset: 0 })
    mocks.read.mockClear()
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, '4', null]) {
      expect(() => output(event, id, 'stdout', 0)).toThrow('Invalid IPC parameter')
    }
    for (const stream of ['other', '../file', null, 0]) {
      expect(() => output(event, 4, stream, 0)).toThrow('Invalid IPC parameter')
    }
    for (const offset of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, '0', undefined]) {
      expect(() => output(event, 4, 'stderr', offset)).toThrow('Invalid IPC parameter')
    }
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
