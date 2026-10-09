import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stageBesideAsync, claimFinalNameAsync, writeFileAtomicAsync } from '../../../src/main/utils/atomic-write'

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
