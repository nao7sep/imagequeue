import * as sync from '../../../src/main/utils/fsync'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stageBesideAsync, claimFinalNameAsync, writeFileAtomicAsync } from '../../../src/main/utils/atomic-write'
import * as exclusiveRename from '../../../src/main/utils/rename-exclusive'

// A replacement made through a temp file and a rename keeps what the file had:
// its permission mode (content-lifecycle conventions). Its times are the new
// content's own, and content identical to the file's is not written at all.
let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-atomic-write-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const OLD_TIME = new Date('2001-02-03T04:05:06.000Z')

function existing(name: string, mode: number): string {
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, 'old')
  fs.chmodSync(filePath, mode)
  fs.utimesSync(filePath, OLD_TIME, OLD_TIME)
  return filePath
}

describe('atomic replacement', () => {
  it('falls back from unsupported links to native exclusive rename without copying or overwriting a collision', async () => {
    const occupied = path.join(dir, 'occupied.png')
    const available = path.join(dir, 'available.png')
    const bytes = Buffer.alloc(64 * 1024, 0x71)
    fs.writeFileSync(occupied, 'existing image')
    const stage = await stageBesideAsync(available, bytes)
    const stageMetadata = fs.statSync(stage)
    const link = vi.spyOn(fs.promises, 'link').mockRejectedValue(Object.assign(new Error('Links unsupported'), { code: 'EPERM' }))
    const rename = vi.spyOn(exclusiveRename, 'renameExclusive')
    const copy = vi.spyOn(fs.promises, 'copyFile')
    try {
      expect(await claimFinalNameAsync(stage, occupied)).toBe(false)
      expect(fs.readFileSync(occupied, 'utf8')).toBe('existing image')
      expect(fs.readFileSync(stage)).toEqual(bytes)
      expect(rename).toHaveBeenNthCalledWith(1, stage, occupied)

      expect(await claimFinalNameAsync(stage, available)).toBe(true)
      expect(rename).toHaveBeenNthCalledWith(2, stage, available)
      expect(fs.existsSync(stage)).toBe(false)
      expect(fs.readFileSync(available)).toEqual(bytes)
      expect(fs.statSync(available).ino).toBe(stageMetadata.ino)
      expect(fs.statSync(available).mtimeMs).toBe(stageMetadata.mtimeMs)
      expect(copy).not.toHaveBeenCalled()
    } finally {
      copy.mockRestore()
      rename.mockRestore()
      link.mockRestore()
    }
  })

  it.skipIf(process.platform === 'win32')('keeps the replaced file permission mode', async () => {
    const filePath = existing('configs.json', 0o604)
    await writeFileAtomicAsync(filePath, 'new', false)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new')
    expect(fs.statSync(filePath).mode & 0o7777).toBe(0o604)
  })

  it.skipIf(process.platform === 'win32')('keeps unfinished stages private and publishes ordinary new files with normal permissions', async () => {
    const expected = 0o666 & ~process.umask()
    const privateStages: number[] = []
    const open = fs.promises.open
    const opened = vi.spyOn(fs.promises, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode)
      if (flags === 'wx') privateStages.push((await handle.stat()).mode & 0o777)
      return handle
    })
    try {
      const ordinary = path.join(dir, 'new.json')
      await writeFileAtomicAsync(ordinary, 'new', false)
      const output = path.join(dir, 'image.png')
      const stage = await stageBesideAsync(output, Buffer.from('complete'))
      expect(await claimFinalNameAsync(stage, output)).toBe(true)
      expect(privateStages).toEqual([0o600, 0o600])
      expect(fs.statSync(ordinary).mode & 0o777).toBe(expected)
      expect(fs.statSync(output).mode & 0o777).toBe(expected)
      const asyncPath = path.join(dir, 'async.json')
      await writeFileAtomicAsync(asyncPath, 'new', false)
      expect(fs.statSync(asyncPath).mode & 0o777).toBe(expected)
    } finally { opened.mockRestore() }
  })

  it('never carries the replaced file\'s times onto the new content', async () => {
    const filePath = existing('state.json', 0o644)
    await writeFileAtomicAsync(filePath, 'new', false)
    expect(fs.statSync(filePath).mtimeMs).not.toBe(OLD_TIME.getTime())
  })

  it('creates a new file when none exists', async () => {
    await writeFileAtomicAsync(path.join(dir, 'fresh.json'), 'one', false)
    expect(fs.readFileSync(path.join(dir, 'fresh.json'), 'utf-8')).toBe('one')
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('retries durability after a published rename loses its acknowledgment without rewriting identical bytes', async () => {
    const filePath = existing('uncertain.json', 0o644)
    const directorySync = vi.spyOn(sync, 'syncDirectoryAsync').mockRejectedValueOnce(new Error('directory unavailable'))
    const rename = vi.spyOn(fs.promises, 'rename')
    try {
      await expect(writeFileAtomicAsync(filePath, 'new', false)).rejects.toThrow('directory unavailable')
      expect(fs.readFileSync(filePath, 'utf8')).toBe('new')
      const modified = fs.statSync(filePath).mtimeMs
      await writeFileAtomicAsync(filePath, 'new', false)
      expect(directorySync).toHaveBeenCalledTimes(2)
      expect(rename).toHaveBeenCalledOnce()
      expect(fs.statSync(filePath).mtimeMs).toBe(modified)
    } finally { directorySync.mockRestore(); rename.mockRestore() }
  })

  it('skips a write whose bytes the file already holds', async () => {
    const filePath = existing('same.json', 0o644)
    const asyncRename = vi.spyOn(fs.promises, 'rename')
    await writeFileAtomicAsync(filePath, Buffer.from('old'), false)
    expect(asyncRename).not.toHaveBeenCalled()
    asyncRename.mockRestore()
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(fs.statSync(filePath).mtimeMs).toBe(OLD_TIME.getTime())
  })
})
