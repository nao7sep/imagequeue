import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

    // The atomic helper writes to "<stem>-<nanoid>.tmp" (never a dot-appended
    // "<file>.tmp") then renames; after a clean write the temp artifact must be
    // gone (a truncated/partial file can't be left where the next load would see it).
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false)
    expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('writes through a temp file named `<stem>-<nanoid>.tmp` in the same directory as the target', () => {
    const spy = vi.spyOn(fs, 'writeFileSync')
    listElaborators()

    const tempCall = spy.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('elaborators-')
    )
    expect(tempCall).toBeDefined()
    const tempPath = tempCall![0] as string
    expect(path.dirname(tempPath)).toBe(tmpRoot)
    expect(path.basename(tempPath)).toMatch(/^elaborators-[A-Za-z0-9_-]+\.tmp$/)
    spy.mockRestore()
  })

  it('quarantines a corrupt elaborators.json before reseeding defaults', () => {
    const filePath = path.join(tmpRoot, 'elaborators.json')
    fs.writeFileSync(filePath, '{ not valid json', 'utf-8')

    const seeded = listElaborators()

    // The store recovers with defaults...
    expect(seeded.length).toBeGreaterThan(0)
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Elaborator[]
    expect(parsed).toEqual(seeded)

    // ...but the corrupt bytes are preserved aside as a `.invalid` neighbour, never silently discarded.
    // The name is `<stem>-<stamp>.invalid` (hyphen-joined into the target's stem, never a dot-appended
    // `elaborators.json.<stamp>.invalid`), stamped at millisecond precision.
    const quarantined = fs
      .readdirSync(tmpRoot)
      .filter((name) => name.startsWith('elaborators-') && name.endsWith('.invalid'))
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0]).toMatch(/^elaborators-\d{8}-\d{6}-\d{3}-utc\.invalid$/)
    expect(fs.readFileSync(path.join(tmpRoot, quarantined[0]), 'utf-8')).toBe('{ not valid json')
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
