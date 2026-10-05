import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { multiline, singleLine } from '../../src/shared/textCleanup'

// The store reads its file once per process, so each test starts a fresh module.
let elaborators: typeof import('../../src/main/elaborators')
let createElaborator: typeof elaborators.createElaborator
let updateElaborator: typeof elaborators.updateElaborator
let deleteElaborator: typeof elaborators.deleteElaborator
let resetElaborators: typeof elaborators.resetElaborators
let drainElaboratorRecoveryNotices: typeof elaborators.drainElaboratorRecoveryNotices
let listElaborators: typeof elaborators.listElaborators

describe('elaborator sets', () => {
  let root: string
  const file = () => path.join(root, 'elaborators.json')
  // The kinds the file holds; its format version has tests of its own.
  const stored = () => {
    const { formatVersion: _formatVersion, ...kinds } = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return kinds
  }
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-elaborators-'))
    vi.stubEnv('IMAGEQUEUE_DATA_DIR', root)
    vi.resetModules()
    elaborators = await import('../../src/main/elaborators')
    ;({ createElaborator, updateElaborator, deleteElaborator, resetElaborators, drainElaboratorRecoveryNotices, listElaborators } = elaborators)
  })
  afterEach(async () => {
    const { closeBackupStore } = await import('../../src/main/backup/backup-store')
    closeBackupStore()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    fs.rmSync(root, { recursive: true, force: true })
  })
  it('reads shipped templates without creating a file', () => {
    expect(listElaborators().length).toBeGreaterThan(0)
    expect(fs.existsSync(file())).toBe(false)
  })
  it('writes only the changed kind through atomic publication', () => {
    const shipped = listElaborators()
    const created = createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    expect(Object.keys(stored())).toEqual(['style'])
    expect(stored().style).toContainEqual(created)
    expect(listElaborators().filter((item) => item.kind === 'composition')).toEqual(shipped.filter((item) => item.kind === 'composition'))
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
  it('updates and deletes the whole selected kind only', () => {
    const initial = listElaborators()
    const item = initial.find((row) => row.kind === 'composition')!
    updateElaborator(item.id, { template: 'changed' })
    expect(Object.keys(stored())).toEqual(['composition'])
    expect(stored().composition.find((row: { id: string }) => row.id === item.id).template).toBe('changed')
    deleteElaborator(item.id)
    expect(stored().composition.some((row: { id: string }) => row.id === item.id)).toBe(false)
  })
  it('resets a kind by deleting its copy and preserves the other kind', () => {
    const initial = listElaborators()
    createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    createElaborator({ kind: 'composition', name: 'My composition', template: 'My template' })
    const composition = stored().composition
    resetElaborators('style')
    expect(stored()).toEqual({ composition })
    expect(listElaborators().filter((item) => item.kind === 'style')).toEqual(initial.filter((item) => item.kind === 'style'))
  })
  it('removes a kind edited back to its shipped templates, leaving an empty file with its last key', () => {
    const item = listElaborators().find((row) => row.kind === 'composition')!
    updateElaborator(item.id, { template: 'changed' })
    expect(Object.keys(stored())).toEqual(['composition'])
    updateElaborator(item.id, { template: `${item.template}  \r\n` })
    expect(stored()).toEqual({})
  })
  it('never rewrites the file on a reset that would not change it', () => {
    resetElaborators()
    expect(fs.existsSync(file())).toBe(false)
    createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    fs.utimesSync(file(), new Date(2000, 0, 1), new Date(2000, 0, 1))
    resetElaborators('composition')
    expect(fs.statSync(file()).mtime.getFullYear()).toBe(2000)
  })
  it('drops an untouched kind equal to its shipped templates at the next save of the other kind', async () => {
    const shipped = listElaborators()
    fs.writeFileSync(file(), JSON.stringify({ composition: shipped.filter((item) => item.kind === 'composition') }))
    vi.resetModules()
    ;({ createElaborator } = await import('../../src/main/elaborators'))
    createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    expect(Object.keys(stored())).toEqual(['style'])
  })
  it('keeps every shipped template in its cleaned form', () => {
    for (const item of listElaborators()) {
      expect(item.name).toBe(singleLine(item.name))
      expect(item.description).toBe(singleLine(item.description ?? ''))
      expect(item.template).toBe(multiline(item.template))
    }
  })
  it('accepts an empty kind as an authored empty list', () => {
    fs.writeFileSync(file(), JSON.stringify({ style: [] }))
    expect(listElaborators().some((item) => item.kind === 'style')).toBe(false)
  })
  it('reads a malformed kind as its shipped templates, warning once, and drops it at the next save', async () => {
    const initial = listElaborators()
    fs.writeFileSync(file(), JSON.stringify({ style: [{ kind: 'wrong' }] }))
    vi.resetModules()
    const warn = vi.spyOn(await import('../../src/main/logger'), 'log')
    ;({ createElaborator, listElaborators } = await import('../../src/main/elaborators'))
    expect(listElaborators()).toEqual(initial)
    expect(listElaborators()).toEqual(initial)
    expect(warn.mock.calls.filter(([, message]) => message === 'Invalid elaborator set; using shipped templates')).toHaveLength(1)
    expect(stored()).toEqual({ style: [{ kind: 'wrong' }] })
    const created = createElaborator({ kind: 'composition', name: 'Mine', template: 'Mine' })
    expect(stored()).toEqual({ composition: expect.arrayContaining([created]) })
  })
  it('reads its file once, where it is loaded', () => {
    const initial = listElaborators()
    fs.writeFileSync(file(), JSON.stringify({ style: [] }))
    expect(listElaborators()).toEqual(initial)
  })
  it('quarantines bad JSON and leaves the live file absent', () => {
    fs.writeFileSync(file(), '{ invalid')
    expect(listElaborators().length).toBeGreaterThan(0)
    expect(fs.existsSync(file())).toBe(false)
    const invalid = fs.readdirSync(root).find((name) => name.endsWith('.invalid'))!
    expect(fs.readFileSync(path.join(root, invalid), 'utf8')).toBe('{ invalid')
    expect(drainElaboratorRecoveryNotices()).toEqual([{ kind: 'recovered', path: path.join(root, invalid) }])
  })
  it('preserves bad bytes and reports a failed quarantine', () => {
    fs.writeFileSync(file(), '{ invalid')
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('locked') })
    expect(() => listElaborators()).toThrow('locked')
    expect(fs.readFileSync(file(), 'utf8')).toBe('{ invalid')
    expect(drainElaboratorRecoveryNotices()).toEqual([{ kind: 'quarantine-failed', path: file(), error: 'locked' }])
  })
  it('reads a file with no format version as version 1', () => {
    fs.writeFileSync(file(), JSON.stringify({ style: [] }))
    expect(listElaborators().filter((item) => item.kind === 'style')).toEqual([])
    expect(drainElaboratorRecoveryNotices()).toEqual([])
  })
  it('writes its format version first and reads it back', async () => {
    const { FORMAT_VERSIONS } = await import('../../src/main/store-format')
    const created = createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    expect(Object.entries(JSON.parse(fs.readFileSync(file(), 'utf8')))[0]).toEqual(['formatVersion', FORMAT_VERSIONS.elaborators])
    vi.resetModules()
    const reloaded = await import('../../src/main/elaborators')
    expect(reloaded.listElaborators()).toContainEqual(created)
  })
  it('refuses every request on a file from a newer version and leaves its bytes as they were', async () => {
    const { FORMAT_VERSIONS, NewerFormatError } = await import('../../src/main/store-format')
    const bytes = JSON.stringify({ formatVersion: FORMAT_VERSIONS.elaborators + 1, style: [] })
    fs.writeFileSync(file(), bytes)
    expect(() => listElaborators()).toThrow(NewerFormatError)
    expect(() => createElaborator({ kind: 'style', name: 'My style', template: 'My template' })).toThrow(NewerFormatError)
    expect(() => resetElaborators()).toThrow(NewerFormatError)
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.invalid'))).toEqual([])
    expect(drainElaboratorRecoveryNotices()).toEqual([])
  })
  it('quarantines a file whose format version is not a positive integer', () => {
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 0, style: [] }))
    expect(listElaborators().some((item) => item.kind === 'style')).toBe(true)
    expect(fs.existsSync(file())).toBe(false)
    expect(drainElaboratorRecoveryNotices()).toHaveLength(1)
  })
})
