import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncDirectoryAsync } from '../../../src/main/utils/fsync'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.restoreAllMocks()
})

describe('directory sync', () => {
  // Windows exposes no directory handle; the rename is the durability boundary.
  it('opens no directory handle on Windows', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const open = vi.spyOn(fs.promises, 'open')
    await syncDirectoryAsync(path.join(os.tmpdir(), 'imagequeue-no-such-directory'))
    expect(open).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32').each([false, true])('awaits directory sync and closes its handle (sync rejects: %s)', async (fails) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-fsync-'))
    const retained = path.join(directory, 'retained.txt')
    fs.writeFileSync(retained, 'retained bytes')
    const handle = await fs.promises.open(directory, 'r')
    const originalSync = handle.sync.bind(handle)
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const failure = new Error('directory sync failed')
    const sync = vi.spyOn(handle, 'sync').mockImplementation(async () => {
      await pending
      if (fails) throw failure
      await originalSync()
    })
    const close = vi.spyOn(handle, 'close')
    const open = vi.spyOn(fs.promises, 'open').mockResolvedValueOnce(handle)
    try {
      let settled = false
      const result = syncDirectoryAsync(directory)
      void result.then(() => { settled = true }, () => { settled = true })
      await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce())
      expect(open).toHaveBeenCalledExactlyOnceWith(directory, 'r')
      expect(settled).toBe(false)
      expect(close).not.toHaveBeenCalled()
      release()
      if (fails) await expect(result).rejects.toBe(failure)
      else await result
      expect(close).toHaveBeenCalledOnce()
      expect(fs.readFileSync(retained, 'utf8')).toBe('retained bytes')
    } finally {
      release()
      await handle.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
