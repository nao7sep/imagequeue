import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic, writeFileAtomicAsync } from '../../../src/main/utils/atomic-write'

// A replacement made through a temp file and a rename keeps what the file had:
// its permission mode (content-lifecycle conventions). Its times are the new
// content's own.
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
  it.skipIf(process.platform === 'win32')('keeps the replaced file\'s permission mode', () => {
    const filePath = existing('store.json', 0o640)
    writeFileAtomic(filePath, 'new', false)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new')
    expect(fs.statSync(filePath).mode & 0o7777).toBe(0o640)
  })

  it.skipIf(process.platform === 'win32')('keeps the mode on the async path too', async () => {
    const filePath = existing('configs.json', 0o604)
    await writeFileAtomicAsync(filePath, 'new', false)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new')
    expect(fs.statSync(filePath).mode & 0o7777).toBe(0o604)
  })

  it('never carries the replaced file\'s times onto the new content', async () => {
    const filePath = existing('state.json', 0o644)
    writeFileAtomic(filePath, 'new', false)
    expect(fs.statSync(filePath).mtimeMs).not.toBe(OLD_TIME.getTime())
    const asyncPath = existing('other.json', 0o644)
    await writeFileAtomicAsync(asyncPath, 'new', false)
    expect(fs.statSync(asyncPath).mtimeMs).not.toBe(OLD_TIME.getTime())
  })

  it('creates a new file when none exists', async () => {
    writeFileAtomic(path.join(dir, 'fresh.json'), 'one', false)
    await writeFileAtomicAsync(path.join(dir, 'fresh-async.json'), 'two', false)
    expect(fs.readFileSync(path.join(dir, 'fresh.json'), 'utf-8')).toBe('one')
    expect(fs.readFileSync(path.join(dir, 'fresh-async.json'), 'utf-8')).toBe('two')
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
