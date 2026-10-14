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

  it.skipIf(process.platform === 'win32')('syncs and closes a directory handle on POSIX', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-fsync-'))
    try {
      const open = vi.spyOn(fs.promises, 'open')
      await syncDirectoryAsync(directory)
      expect(open).toHaveBeenCalledExactlyOnceWith(directory, 'r')
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
