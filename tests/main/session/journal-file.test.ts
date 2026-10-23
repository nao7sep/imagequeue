import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendSessionTransition, JOURNAL_FILENAME, readSessionJournal, type SessionTransition,
} from '../../../src/main/session/journal-file'
import * as sync from '../../../src/main/utils/fsync'

let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'imagequeue-journal-')) })
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})
const entry = (sequence: number): SessionTransition => ({ sequence, updatedAt: '2026-01-01T00:00:00.000Z', upserts: [], removed: [] })
const encode = (transition: SessionTransition): string => JSON.stringify(transition) + '\n'
const validate = (value: unknown): value is SessionTransition => {
  if (!value || typeof value !== 'object') return false
  const transition = value as SessionTransition
  return typeof transition.sequence === 'number' && typeof transition.updatedAt === 'string' && Array.isArray(transition.upserts) && Array.isArray(transition.removed)
}
const file = () => path.join(root, JOURNAL_FILENAME)

describe('streaming session journal replay', () => {
  it('replays only the suffix while counting every complete byte before and after a checkpoint', async () => {
    const lines = [1, 2, 3, 4].map(sequence => encode(entry(sequence))).join('')
    await fs.writeFile(file(), lines)
    const replayed: SessionTransition[] = []
    const checked: number[] = []
    expect(await readSessionJournal(root, 2, (value): value is SessionTransition => {
      const valid = validate(value)
      if (valid) checked.push(value.sequence)
      return valid
    }, transition => replayed.push(transition))).toEqual({ sequence: 4, validBytes: Buffer.byteLength(lines) })
    expect(checked).toEqual([1, 2, 3, 4])
    expect(replayed.map(transition => transition.sequence)).toEqual([3, 4])
  })

  it.each([[3, 4], [2, 3, 4]])('accepts a retained prefix or compacted start %j', async (...sequences) => {
    const lines = sequences.map(sequence => encode(entry(sequence))).join('')
    await fs.writeFile(file(), lines)
    const replayed: number[] = []
    expect(await readSessionJournal(root, 2, validate, transition => replayed.push(transition.sequence))).toEqual({ sequence: 4, validBytes: Buffer.byteLength(lines) })
    expect(replayed).toEqual([3, 4])
  })

  it('ignores a final torn row and does not count its bytes', async () => {
    const complete = encode(entry(1))
    await fs.writeFile(file(), complete + '{"sequence":2,"updatedAt":"torn')
    const replayed: number[] = []
    expect(await readSessionJournal(root, 0, validate, transition => replayed.push(transition.sequence))).toEqual({ sequence: 1, validBytes: Buffer.byteLength(complete) })
    expect(replayed).toEqual([1])
  })

  it.each(['not json\n', '{"sequence":1}\n'])('rejects a complete malformed row even before the checkpoint: %j', async text => {
    await fs.writeFile(file(), text)
    await expect(readSessionJournal(root, 10, validate, () => {})).rejects.toThrow()
  })

  it.each([[1, 3], [2], [0], [-1], [1, 1], [Number.MAX_SAFE_INTEGER + 1]])('rejects a gap, invalid sequence or wrong start: %j', async (...sequences) => {
    await fs.writeFile(file(), sequences.map(sequence => encode(entry(sequence))).join(''))
    await expect(readSessionJournal(root, 0, validate, () => {})).rejects.toThrow('sequence')
  })

  it('enforces contiguity in skipped checkpoint rows too', async () => {
    await fs.writeFile(file(), [1, 3].map(sequence => encode(entry(sequence))).join(''))
    await expect(readSessionJournal(root, 3, validate, () => {})).rejects.toThrow('sequence')
  })

  it('streams a multibyte logical record larger than a read chunk with exact byte accounting', async () => {
    const transition = { ...entry(1), elaboratedPrompts: [{ text: '日本語'.repeat(20_000), concepts: [] }] }
    const text = encode(transition)
    await fs.writeFile(file(), text)
    let recovered: SessionTransition | undefined
    expect(await readSessionJournal(root, 0, validate, value => { recovered = value })).toEqual({ sequence: 1, validBytes: Buffer.byteLength(text) })
    expect(recovered).toEqual(transition)
  })

  it('propagates validator and replay callback failures including ENOENT-shaped errors', async () => {
    await fs.writeFile(file(), encode(entry(1)))
    const error = Object.assign(new Error('callback failed'), { code: 'ENOENT' })
    await expect(readSessionJournal(root, 0, (_value: unknown): _value is SessionTransition => { throw error }, () => {})).rejects.toBe(error)
    await expect(readSessionJournal(root, 0, validate, () => { throw error })).rejects.toBe(error)
  })

  it('rejects invalid UTF-8 in a complete record rather than changing saved text', async () => {
    await fs.writeFile(file(), Buffer.concat([
      Buffer.from('{"sequence":1,"updatedAt":"'), Buffer.from([0xff]), Buffer.from('","upserts":[],"removed":[]}\n'),
    ]))
    await expect(readSessionJournal(root, 0, validate, () => {})).rejects.toThrow()
  })

  it('returns the checkpoint for a missing journal and propagates other read errors', async () => {
    expect(await readSessionJournal(root, 7, validate, () => {})).toEqual({ sequence: 7, validBytes: 0 })
    await fs.mkdir(file())
    await expect(readSessionJournal(root, 7, validate, () => {})).rejects.toThrow()
  })
})

describe('durable session journal append', () => {
  it('appends at the confirmed byte offset and truncates a partial tail before retry', async () => {
    const first = await appendSessionTransition(root, 0, entry(1))
    await fs.appendFile(file(), '{"sequence":2,"partial":true')
    const final = await appendSessionTransition(root, first, entry(2))
    const expected = encode(entry(1)) + encode(entry(2))
    expect(await fs.readFile(file(), 'utf8')).toBe(expected)
    expect(final).toBe(Buffer.byteLength(expected))
    const replayed: number[] = []
    expect(await readSessionJournal(root, 0, validate, transition => replayed.push(transition.sequence))).toEqual({ sequence: 2, validBytes: final })
    expect(replayed).toEqual([1, 2])
  })

  it('replaces an unacknowledged complete tail and supports zero-offset compaction', async () => {
    const first = await appendSessionTransition(root, 0, entry(1))
    await appendSessionTransition(root, first, entry(2))
    const changed = { ...entry(2), updatedAt: '2026-02-01T00:00:00.000Z' }
    await appendSessionTransition(root, first, changed)
    expect(await fs.readFile(file(), 'utf8')).toBe(encode(entry(1)) + encode(changed))
    const compacted = await appendSessionTransition(root, 0, entry(3))
    expect(await fs.readFile(file(), 'utf8')).toBe(encode(entry(3)))
    expect(await readSessionJournal(root, 2, validate, () => {})).toEqual({ sequence: 3, validBytes: compacted })
  })

  it("waits for the file sync before acknowledging and retries from the caller's old offset after sync failure", async () => {
    const open = fs.open.bind(fs)
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const syncing = new Promise<void>(resolve => { entered = resolve })
    const failure = Object.assign(new Error('file sync failed'), { code: 'EIO' })
    const opening = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args)
      if (String(args[0]) === file()) vi.spyOn(handle, 'sync').mockImplementationOnce(async () => {
        entered()
        await held
        throw failure
      })
      return handle
    })
    let acknowledged = false
    const writing = appendSessionTransition(root, 0, entry(1)).then(offset => { acknowledged = true; return offset })
    const rejected = expect(writing).rejects.toBe(failure)
    await syncing
    try { expect(acknowledged).toBe(false) } finally { release() }
    await rejected
    opening.mockRestore()
    expect(await appendSessionTransition(root, 0, entry(1))).toBe(Buffer.byteLength(encode(entry(1))))
    expect(await fs.readFile(file(), 'utf8')).toBe(encode(entry(1)))
  })

  it('does not acknowledge an append while the directory sync is pending', async () => {
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const syncing = new Promise<void>(resolve => { entered = resolve })
    const original = sync.syncDirectoryAsync
    vi.spyOn(sync, 'syncDirectoryAsync').mockImplementationOnce(async dir => {
      entered()
      await held
      await original(dir)
    })
    let acknowledged = false
    const writing = appendSessionTransition(root, 0, entry(1)).then(offset => { acknowledged = true; return offset })
    await syncing
    try {
      expect(await fs.readFile(file(), 'utf8')).toBe(encode(entry(1)))
      expect(acknowledged).toBe(false)
    } finally { release() }
    expect(await writing).toBe(Buffer.byteLength(encode(entry(1))))
    expect(acknowledged).toBe(true)
  })
})
