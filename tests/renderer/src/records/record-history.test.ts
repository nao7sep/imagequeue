import { expect, it, vi } from 'vitest'
import { RecordHistory, readHistoryPrefix } from '../../../../src/renderer/src/records/record-history'
import type { RecordSummary, RecordsPage } from '../../../../src/shared/records'

const row = (id: number): RecordSummary => ({ kind: 'log', id, time: new Date(id * 1000).toISOString(), level: 'info', title: `Message ${id}`, text: 'Large display payload'.repeat(100) })

it('keeps compact navigation through eviction and prepend without retaining display payloads', () => {
  const history = new RecordHistory()
  for (let end = 10000; end > 0; end -= 100) {
    history.append({ records: Array.from({ length: 100 }, (_, i) => row(end - i)), more: end > 100 })
    history.retain(new Set(['log:1', 'log:2']))
    expect(history.summaries.size).toBeLessThanOrEqual(2)
  }
  expect(history.count).toBe(10000)
  expect(history.at(5000)).toEqual({ kind: 'log', id: 5000, time: row(5000).time })
  history.prepend([row(10002), row(10001)], [row(10002)])
  expect(history.count).toBe(10002)
  expect(history.indexOf('log:5000')).toBe(5002)
  expect(history.idAt(5002)).toBe('log:5000')
  expect(history.after?.id).toBe(1)
  expect(history.more).toBe(false)
})

it('bridges a multi-page live burst to an exhausted history without skipping any identity', async () => {
  const history = new RecordHistory()
  history.append({ records: [row(2), row(1)], more: false })
  const read = vi.fn(async (after: { id: number } | null): Promise<RecordsPage> => {
    const end = after ? after.id - 1 : 352
    return { records: Array.from({ length: Math.min(100, end) }, (_, i) => row(end - i)), more: end > 100 }
  })
  const prefix = (await readHistoryPrefix(history, read, () => true))!
  expect(read).toHaveBeenCalledTimes(4)
  expect(history.count).toBe(2)
  expect(prefix.cursors.every((cursor) => !('title' in cursor))).toBe(true)
  history.prepend(prefix.cursors, prefix.first.records)
  expect(Array.from({ length: history.count }, (_, i) => history.at(i).id)).toEqual(Array.from({ length: 352 }, (_, i) => 352 - i))
  expect(history.more).toBe(false)
  expect(history.summaries.size).toBe(102)
})

it('keeps the admitted history intact when the missing interval fails or the filter changes', async () => {
  const history = new RecordHistory()
  history.append({ records: [row(1)], more: false })
  const read = vi.fn().mockResolvedValueOnce({ records: [row(3)], more: true }).mockRejectedValueOnce(new Error('unavailable'))
  await expect(readHistoryPrefix(history, read, () => true)).rejects.toThrow('unavailable')
  expect(history.count).toBe(1)
  expect(history.summaries.has('log:3')).toBe(false)
  expect(await readHistoryPrefix(history, async () => ({ records: [row(4)], more: true }), () => false)).toBeNull()
  expect(history.count).toBe(1)
})
