import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElaborator, listElaborators } from '../../src/main/elaborators'
import type { Elaborator } from '../../src/shared/types'

const ENV_VAR = 'IMAGEQUEUE_HOME'

// elaborators.ts persists elaborators.json under the storage root via
// writeJsonAtomic (temp file + rename). These tests isolate the data dir with
// IMAGEQUEUE_HOME and assert the store is written atomically: valid JSON lands
// on disk and no orphaned *.tmp artifact is left behind after the write.
describe('elaborators store (atomic write of elaborators.json)', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-elaborators-'))
    process.env[ENV_VAR] = tmpRoot
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('writes elaborators.json with valid JSON content and no leftover temp file', () => {
    const filePath = path.join(tmpRoot, 'elaborators.json')

    // First load on an empty root seeds defaults and writes them out.
    const seeded = listElaborators()

    expect(fs.existsSync(filePath)).toBe(true)

    // The persisted file round-trips back to the same items as valid JSON.
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Elaborator[]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toEqual(seeded)

    // The atomic helper writes to "<file>.tmp" then renames; after a clean
    // write the temp artifact must be gone (a truncated/partial file can't be
    // left where the next load would see it).
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false)
    expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('leaves no orphaned temp file after a mutating write', () => {
    const filePath = path.join(tmpRoot, 'elaborators.json')

    // Mutating the store exercises writeFile -> writeJsonAtomic again.
    const created = createElaborator({
      kind: 'content',
      name: 'Test elaborator',
      template: 'A focused test template.',
    })

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Elaborator[]
    expect(parsed.some((item) => item.id === created.id)).toBe(true)

    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false)
    expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
