import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElaborator, updateElaborator, deleteElaborator, resetElaborators, drainElaboratorRecoveryNotices, listElaborators } from '../../src/main/elaborators'
import { closeBackupStore } from '../../src/main/backup/backup-store'
import { multiline, singleLine } from '../../src/shared/textCleanup'

describe('elaborator sets', () => {
  let root: string
  const file = () => path.join(root, 'elaborators.json')
  const stored = () => JSON.parse(fs.readFileSync(file(), 'utf8'))
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-elaborators-'))
    vi.stubEnv('IMAGEQUEUE_DATA_DIR', root)
    drainElaboratorRecoveryNotices()
  })
  afterEach(() => {
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
  it('removes a kind edited back to its shipped templates, and the file with its last key', () => {
    const item = listElaborators().find((row) => row.kind === 'composition')!
    updateElaborator(item.id, { template: 'changed' })
    expect(Object.keys(stored())).toEqual(['composition'])
    updateElaborator(item.id, { template: `${item.template}  \r\n` })
    expect(fs.existsSync(file())).toBe(false)
  })
  it('never rewrites the file on a reset that would not change it', () => {
    resetElaborators()
    expect(fs.existsSync(file())).toBe(false)
    createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    fs.utimesSync(file(), new Date(2000, 0, 1), new Date(2000, 0, 1))
    resetElaborators('composition')
    expect(fs.statSync(file()).mtime.getFullYear()).toBe(2000)
  })
  it('drops an untouched kind equal to its shipped templates at the next save of the other kind', () => {
    const shipped = listElaborators()
    fs.writeFileSync(file(), JSON.stringify({ composition: shipped.filter((item) => item.kind === 'composition') }))
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
  it('uses shipped templates for a malformed kind without quarantining the whole map', () => {
    const initial = listElaborators()
    fs.writeFileSync(file(), JSON.stringify({ style: [{ kind: 'wrong' }] }))
    expect(listElaborators()).toEqual(initial)
    expect(stored()).toEqual({ style: [{ kind: 'wrong' }] })
    const created = createElaborator({ kind: 'composition', name: 'Mine', template: 'Mine' })
    expect(stored().style).toEqual([{ kind: 'wrong' }])
    expect(stored().composition).toContainEqual(created)
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
})
