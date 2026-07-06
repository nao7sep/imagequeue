import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createElaborator,
  listElaborators,
  materializeElaborators,
} from '../../src/main/elaborators'
import type { Elaborator } from '../../src/shared/types'

const ENV_VAR = 'IMAGEQUEUE_HOME'

// elaborators.ts persists elaborators.json under the storage root via
// writeJsonAtomic (temp file + rename). These tests isolate the data dir with
// IMAGEQUEUE_HOME and assert three things: the store is materialized at startup
// (write-if-absent, mirroring config.json), the store is written atomically
// (valid JSON, no orphaned *.tmp), and a corrupt file is quarantined then
// reseeded rather than silently discarded.
describe('elaborators store', () => {
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

  // FINDING #4 (first-run materialization): the shipped elaborators must exist
  // on disk after startup, not only after the renderer first calls
  // elaborators:list. materializeElaborators is the function app.whenReady runs
  // at the populated-but-not-yet-used point; these tests pin its write-if-absent
  // contract, which is what guarantees a launch-then-quit leaves a real,
  // editable elaborators.json (present in the first-run backup) rather than a
  // phantom held only in memory.
  describe('materializeElaborators (first-run write-if-absent)', () => {
    it('writes elaborators.json on a clean IMAGEQUEUE_HOME (the launch-then-quit case)', () => {
      const filePath = path.join(tmpRoot, 'elaborators.json')

      // Fresh root: nothing on disk yet — the launch-then-quit failure this fix
      // addresses (config.json alone, no elaborators.json).
      expect(fs.existsSync(filePath)).toBe(false)

      // whenReady's materialization step runs here.
      materializeElaborators()

      // elaborators.json now exists on disk and round-trips to the shipped set,
      // so a user who opens the app once finds a real, editable, inspectable
      // file — captured by the first-run backup — waiting under the root.
      expect(fs.existsSync(filePath)).toBe(true)
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Elaborator[]
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed.length).toBeGreaterThan(0)
      expect(parsed).toEqual(listElaborators())

      // Serialized through the app's own atomic save path: no orphaned temp.
      expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.tmp'))).toEqual([])
    })

    it('never overwrites an existing elaborators.json (write-only-when-absent)', () => {
      const filePath = path.join(tmpRoot, 'elaborators.json')
      // A user's file with a single custom elaborator — stand-in for "the app
      // has already been run and the user has edited their set".
      const userItems: Elaborator[] = [
        {
          id: 'elab-user-kept',
          kind: 'content',
          name: 'User kept',
          template: 'A user-authored template that must survive startup.',
        },
      ]
      fs.writeFileSync(filePath, JSON.stringify(userItems, null, 2), 'utf-8')

      materializeElaborators()

      // The user's file is left exactly as it was — absence is the single
      // trigger, and materialization never inspects or replaces a present file.
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Elaborator[]
      expect(parsed).toEqual(userItems)
    })

    it('leaves a present-but-corrupt file untouched (the create-if-absent path never touches it)', () => {
      const filePath = path.join(tmpRoot, 'elaborators.json')
      fs.writeFileSync(filePath, '{ not valid json', 'utf-8')

      // The file EXISTS, so the write-if-absent path skips it — corruption is
      // the load path's job (quarantine-then-reseed), not materialization's.
      materializeElaborators()

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('{ not valid json')
      // No quarantine or reseed happened here — materialization did not read it.
      expect(fs.readdirSync(tmpRoot).filter((name) => name.endsWith('.invalid'))).toEqual([])
    })

    it('is idempotent across repeated startups', () => {
      const filePath = path.join(tmpRoot, 'elaborators.json')

      materializeElaborators()
      const first = fs.readFileSync(filePath, 'utf-8')
      // A second launch (or an accidental double-call) must not rewrite the file.
      const spy = vi.spyOn(fs, 'writeFileSync')
      materializeElaborators()
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(first)
    })
  })

  describe('listElaborators (pure read of the materialized file)', () => {
    it('reads the materialized file without writing (no lazy first-write)', () => {
      materializeElaborators()

      // With the file already present, listing is a pure read: it must not touch
      // the filesystem for writing (the lazy first-write this fix removed).
      const spy = vi.spyOn(fs, 'writeFileSync')
      const items = listElaborators()
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
      expect(items.length).toBeGreaterThan(0)
    })

    it('returns in-memory defaults without writing when the file is genuinely absent', () => {
      const filePath = path.join(tmpRoot, 'elaborators.json')
      // Pre-materialization / user-deleted-the-file case: listing falls back to
      // the in-memory shipped set, but must NOT resurrect the file itself —
      // materialization is the single first-run writer.
      expect(fs.existsSync(filePath)).toBe(false)

      const spy = vi.spyOn(fs, 'writeFileSync')
      const items = listElaborators()
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()

      expect(items.length).toBeGreaterThan(0)
      expect(fs.existsSync(filePath)).toBe(false)
    })
  })

  describe('atomic writes and corrupt-file recovery', () => {
    it('writes through a temp file named `<stem>-<nanoid>.tmp` in the same directory as the target', () => {
      const spy = vi.spyOn(fs, 'writeFileSync')
      materializeElaborators()

      const tempCall = spy.mock.calls.find(
        (call) => typeof call[0] === 'string' && (call[0] as string).includes('elaborators-')
      )
      expect(tempCall).toBeDefined()
      const tempPath = tempCall![0] as string
      expect(path.dirname(tempPath)).toBe(tmpRoot)
      expect(path.basename(tempPath)).toMatch(/^elaborators-[A-Za-z0-9_-]+\.tmp$/)
      spy.mockRestore()
    })

    it('quarantines a corrupt elaborators.json and reseeds defaults on disk', () => {
      const filePath = path.join(tmpRoot, 'elaborators.json')
      fs.writeFileSync(filePath, '{ not valid json', 'utf-8')

      // The load path (readFile, driven here via listElaborators) recovers with
      // defaults and recreates a valid file on disk...
      const items = listElaborators()
      expect(items.length).toBeGreaterThan(0)
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Elaborator[]
      expect(parsed).toEqual(items)

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
      materializeElaborators()

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
})
