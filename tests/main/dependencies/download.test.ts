import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { sha256File } from '../../../src/main/dependencies/download'

const tempDirs: string[] = []

function writeTemp(bytes: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-dl-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'artifact.bin')
  fs.writeFileSync(file, bytes)
  return file
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('sha256File', () => {
  it('matches the reference digest for the file contents (the verify step)', async () => {
    const bytes = crypto.randomBytes(64 * 1024)
    const expected = crypto.createHash('sha256').update(bytes).digest('hex')
    expect(await sha256File(writeTemp(bytes))).toBe(expected)
  })

  it('hashes an empty file', async () => {
    const expected = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex')
    expect(await sha256File(writeTemp(Buffer.alloc(0)))).toBe(expected)
  })

  it('rejects when the file does not exist', async () => {
    await expect(sha256File(path.join(os.tmpdir(), 'iq-nope-does-not-exist'))).rejects.toThrow()
  })
})
