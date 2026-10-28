import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultUiState } from '../../src/shared/ui-state'
import { RECORDS_LIST_WIDTH } from '../../src/shared/records-layout'

const mocks = vi.hoisted(() => ({
  root: '',
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))
vi.mock('../../src/main/config', () => ({ getDataDir: () => mocks.root }))
vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => String(error) }))

const { registerStateIpc } = await import('../../src/main/state-ipc')
const { getUiStatePath, readUiState } = await import('../../src/main/state-store')
registerStateIpc()
const invoke = (patch: unknown): unknown => mocks.handlers.get('state:update')!({}, patch)

beforeEach(() => { mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-state-ipc-')) })
afterEach(() => { fs.rmSync(mocks.root, { recursive: true, force: true }) })

describe('state:update admission', () => {
  it.each([
    null, undefined, [], 'wide', 240,
    { columnWidth: undefined }, { columnWidth: 'wide' }, { columnWidth: Number.NaN }, { columnWidth: Infinity },
    { notificationVolume: 0.5 },
    { recordsListWidth: 'wide' }, { recordsListWidth: null }, { recordsListWidth: Number.NaN },
    { formatVersion: 999 }, { sessionId: 'other' }, { tasks: [] }, { constructor: {} },
    JSON.parse('{"__proto__":{"columnWidth":0}}'),
    { columnWidth: 240, recordsListWidth: 'invalid' },
    { columnWidth: 240, unexpected: true },
  ])('rejects malformed patch %j atomically', async (patch) => {
    expect(() => invoke(patch)).toThrow(/Invalid UI state patch/)
    expect(fs.existsSync(getUiStatePath())).toBe(false)
    await invoke({ columnWidth: 250, recordsListWidth: 400 })
    const before = fs.readFileSync(getUiStatePath(), 'utf8')
    expect(() => invoke(patch)).toThrow(/Invalid UI state patch/)
    expect(fs.readFileSync(getUiStatePath(), 'utf8')).toBe(before)
    expect(await readUiState()).toEqual({ ...defaultUiState(), columnWidth: 250, recordsListWidth: 400 })
  })

  it('ignores inherited fields and writes only owned allowed fields with the owned marker', async () => {
    const patch = Object.create({ recordsListWidth: 600, formatVersion: 999 })
    patch.columnWidth = 280
    expect(await invoke(patch)).toEqual({ ...defaultUiState(), columnWidth: 280 })
    expect(JSON.parse(fs.readFileSync(getUiStatePath(), 'utf8'))).toEqual({
      ...defaultUiState(), columnWidth: 280, formatVersion: 1,
    })
  })

  it('keeps omitted fields, nullable finite column intent, and Records bounds', async () => {
    expect(await invoke({ columnWidth: 9999, recordsListWidth: 9999 })).toEqual({
      columnWidth: 9999, recordsListWidth: RECORDS_LIST_WIDTH.max,
    })
    expect(await invoke({ columnWidth: null, recordsListWidth: 1 })).toEqual({
      columnWidth: null, recordsListWidth: RECORDS_LIST_WIDTH.min,
    })
    expect(await invoke({ recordsListWidth: 400.6 })).toEqual({ columnWidth: null, recordsListWidth: 401 })
    expect(await invoke({})).toEqual({ columnWidth: null, recordsListWidth: 401 })
  })
})
