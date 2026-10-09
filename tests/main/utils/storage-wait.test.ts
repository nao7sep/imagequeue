import { afterEach, expect, it, vi } from 'vitest'
import { ownExportDestination, waitForStorage } from '../../../src/main/utils/storage-wait'
import { isStorageStillPending } from '../../../src/shared/storage-wait'

afterEach(() => vi.useRealTimers())
it('ends only the caller wait and preserves the destination until the real copy settles', async () => {
  vi.useFakeTimers()
  let finish!: (value: string) => void
  const copy = vi.fn(() => new Promise<string>((resolve) => { finish = resolve }))
  const physical = ownExportDestination('/export/image.png', copy)
  const caller = waitForStorage(physical, 30_000).catch((error) => error)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(isStorageStillPending(await caller)).toBe(true)
  const second = vi.fn(async () => 'second')
  await expect(ownExportDestination('/export/image.png', second)).rejects.toThrow('IMAGEQUEUE_STORAGE_STILL_PENDING')
  expect(second).not.toHaveBeenCalled()
  await expect(ownExportDestination('/export/other.png', async () => 'independent')).resolves.toBe('independent')
  finish('published')
  await expect(physical).resolves.toBe('published')
  await expect(ownExportDestination('/export/image.png', second)).resolves.toBe('second')
})
it('returns the real failure before its deadline and releases a settled failed copy', async () => {
  await expect(waitForStorage(ownExportDestination('/export/failed.png', async () => { throw new Error('disk full') }))).rejects.toThrow('disk full')
  await expect(ownExportDestination('/export/failed.png', async () => 'retry')).resolves.toBe('retry')
})
