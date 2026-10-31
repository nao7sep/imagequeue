import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { multiline, singleLine } from '../../src/shared/textCleanup'
import { header } from './file-header'
import { FILE_FORMATS } from '../../src/main/store-format'

// The store reads its file once per process, so each test starts a fresh module.
let elaborators: typeof import('../../src/main/elaborators')
let createElaborator: typeof elaborators.createElaborator
let updateElaborator: typeof elaborators.updateElaborator
let deleteElaborator: typeof elaborators.deleteElaborator
let resetElaborators: typeof elaborators.resetElaborators
let listElaborators: typeof elaborators.listElaborators

describe('elaborator sets', () => {
  let root: string
  const file = () => path.join(root, 'elaborators.json')
  // The kinds the file holds; its file header has tests of its own.
  const stored = () => {
    const { format: _format, writer: _writer, ...kinds } = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return kinds
  }
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-elaborators-'))
    vi.stubEnv('IMAGEQUEUE_DATA_DIR', root)
    vi.resetModules()
    elaborators = await import('../../src/main/elaborators')
    ;({ createElaborator, updateElaborator, deleteElaborator, resetElaborators, listElaborators } = elaborators)
  })
  afterEach(async () => {
    const { closeBackupStore } = await import('../../src/main/backup/backup-store')
    closeBackupStore()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    fs.rmSync(root, { recursive: true, force: true })
  })
  it('retries a failed creation and its revised draft as one identity, including after quit retry', async () => {
    const input = { id: 'elab-retry-draft', kind: 'style' as const, name: 'First', template: 'First template' }
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('locked'))
    await expect(createElaborator(input)).rejects.toThrow('locked')
    await elaborators.retryElaboratorSaves()
    await createElaborator({ ...input, name: 'Revised', template: 'Revised template' })
    expect(listElaborators().filter((item) => item.id === input.id)).toEqual([
      { ...input, name: 'Revised', template: 'Revised template', description: undefined },
    ])
    expect(listElaborators().filter((item) => item.name === 'First')).toEqual([])
  })
  it('reads shipped templates without creating a file', async () => {
    expect(listElaborators().length).toBeGreaterThan(0)
    expect(fs.existsSync(file())).toBe(false)
  })
  it('writes only the changed kind through atomic publication', async () => {
    const shipped = listElaborators()
    const created = await createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    expect(Object.keys(stored())).toEqual(['style'])
    expect(stored().style).toContainEqual(created)
    expect(listElaborators().filter((item) => item.kind === 'composition')).toEqual(shipped.filter((item) => item.kind === 'composition'))
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
  it('updates and deletes the whole selected kind only', async () => {
    const initial = listElaborators()
    const item = initial.find((row) => row.kind === 'composition')!
    await updateElaborator(item.id, { template: 'changed' })
    expect(Object.keys(stored())).toEqual(['composition'])
    expect(stored().composition.find((row: { id: string }) => row.id === item.id).template).toBe('changed')
    await deleteElaborator(item.id)
    expect(stored().composition.some((row: { id: string }) => row.id === item.id)).toBe(false)
  })
  it('refuses a missing name on create and update without writing or leaving a save to retry', async () => {
    const item = listElaborators().find((row) => row.kind === 'style')!
    await expect(createElaborator({ kind: 'style', name: '', template: 'My template' })).rejects.toThrow('needs a name')
    await expect(createElaborator({ kind: 'style', name: '  ', template: 'My template' })).rejects.toThrow('needs a name')
    await expect(updateElaborator(item.id, { name: '' })).rejects.toThrow('needs a name')
    expect(fs.existsSync(file())).toBe(false)
    await expect(elaborators.retryElaboratorSaves()).resolves.toBeUndefined()
    expect(fs.existsSync(file())).toBe(false)
  })
  it('resets a kind by deleting its copy and preserves the other kind', async () => {
    const initial = listElaborators()
    await createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    await createElaborator({ kind: 'composition', name: 'My composition', template: 'My template' })
    const composition = stored().composition
    await resetElaborators('style')
    expect(stored()).toEqual({ composition })
    expect(listElaborators().filter((item) => item.kind === 'style')).toEqual(initial.filter((item) => item.kind === 'style'))
  })
  it('removes a kind edited back to its shipped templates, leaving an empty file with its last key', async () => {
    const item = listElaborators().find((row) => row.kind === 'composition')!
    await updateElaborator(item.id, { template: 'changed' })
    expect(Object.keys(stored())).toEqual(['composition'])
    await updateElaborator(item.id, { template: `${item.template}  \r\n` })
    expect(stored()).toEqual({})
  })
  it('never rewrites the file on a reset that would not change it', async () => {
    await resetElaborators()
    expect(fs.existsSync(file())).toBe(false)
    await createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    fs.utimesSync(file(), new Date(2000, 0, 1), new Date(2000, 0, 1))
    await resetElaborators('composition')
    expect(fs.statSync(file()).mtime.getFullYear()).toBe(2000)
  })
  it('drops an untouched kind equal to its shipped templates at the next save of the other kind', async () => {
    const shipped = listElaborators()
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.elaborators), composition: shipped.filter((item) => item.kind === 'composition') }))
    vi.resetModules()
    ;({ createElaborator } = await import('../../src/main/elaborators'))
    await createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    expect(Object.keys(stored())).toEqual(['style'])
  })
  it('keeps every shipped template in its cleaned form', async () => {
    for (const item of listElaborators()) {
      expect(item.name).toBe(singleLine(item.name))
      expect(item.description).toBe(singleLine(item.description ?? ''))
      expect(item.template).toBe(multiline(item.template))
    }
  })
  it('accepts an empty kind as an authored empty list', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.elaborators), style: [] }))
    expect(listElaborators().some((item) => item.kind === 'style')).toBe(false)
  })
  it('reads a malformed kind as its shipped templates, warning once, and keeps it through a save of the other kind', async () => {
    const initial = listElaborators()
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.elaborators), style: [{ kind: 'wrong' }] }))
    vi.resetModules()
    const warn = vi.spyOn(await import('../../src/main/logger'), 'log')
    ;({ createElaborator, listElaborators } = await import('../../src/main/elaborators'))
    expect(listElaborators()).toEqual(initial)
    expect(listElaborators()).toEqual(initial)
    expect(warn.mock.calls.filter(([, message]) => message === 'Invalid elaborator set; using shipped templates')).toHaveLength(1)
    expect(stored()).toEqual({ style: [{ kind: 'wrong' }] })
    const created = await createElaborator({ kind: 'composition', name: 'Mine', template: 'Mine' })
    expect(stored()).toEqual({ style: [{ kind: 'wrong' }], composition: expect.arrayContaining([created]) })
  })
  it('keeps duplicate identities out of selection and mutations without rewriting their stored set', async () => {
    const duplicates = [
      { id: 'copied-style', kind: 'style', name: 'First', template: 'First template' },
      { id: 'copied-style', kind: 'style', name: 'Second', template: 'Second template' },
    ]
    const bytes = JSON.stringify({ ...header(FILE_FORMATS.elaborators), style: duplicates })
    fs.writeFileSync(file(), bytes)
    expect(listElaborators().some(item => item.id === 'copied-style')).toBe(false)
    expect(elaborators.getElaborator('copied-style')).toBeNull()
    await expect(updateElaborator('copied-style', { template: 'Replacement' })).resolves.toBeNull()
    await expect(deleteElaborator('copied-style')).resolves.toBe(false)
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    await createElaborator({ kind: 'composition', name: 'Composition', template: 'Scene' })
    expect(stored().style).toEqual(duplicates)
  })
  it('replaces a malformed kind once the user changes that kind', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.elaborators), style: [{ kind: 'wrong' }] }))
    const created = await createElaborator({ kind: 'style', name: 'Mine', template: 'Mine' })
    expect(stored()).toEqual({ style: expect.arrayContaining([created]) })
  })
  it('keeps keys it does not know through a save', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.elaborators), later: { kept: true } }))
    await createElaborator({ kind: 'style', name: 'Mine', template: 'Mine' })
    expect(stored()).toMatchObject({ later: { kept: true } })
  })
  it('reads its file once, where it is loaded', async () => {
    const initial = listElaborators()
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.elaborators), style: [] }))
    expect(listElaborators()).toEqual(initial)
  })
  it.each([
    ['does not parse', '{ invalid'],
    ['has no file header', JSON.stringify({ style: [] })],
    ['is of another kind', JSON.stringify({ ...header(FILE_FORMATS.config), style: [] })],
    ['has format version 0', JSON.stringify({ ...header(FILE_FORMATS.elaborators, 0), style: [] })],
  ])('refuses every request on a file that %s and leaves it byte-identical', async (_state, bytes) => {
    const { UnreadableFileError } = await import('../../src/main/store-format')
    fs.writeFileSync(file(), bytes)
    expect(() => listElaborators()).toThrow(UnreadableFileError)
    await expect(createElaborator({ kind: 'style', name: 'Mine', template: 'Mine' })).rejects.toThrow(UnreadableFileError)
    await expect(resetElaborators()).rejects.toThrow(UnreadableFileError)
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    expect(fs.readdirSync(root)).toEqual(['elaborators.json'])
  })
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('refuses every request on a file it cannot read and leaves it in place', async () => {
    const { UnreadableFileError } = await import('../../src/main/store-format')
    const bytes = JSON.stringify({ ...header(FILE_FORMATS.elaborators), style: [] })
    fs.writeFileSync(file(), bytes)
    fs.chmodSync(file(), 0o000)
    try {
      expect(() => listElaborators()).toThrow(UnreadableFileError)
      await expect(createElaborator({ kind: 'style', name: 'Mine', template: 'Mine' })).rejects.toThrow(UnreadableFileError)
    } finally {
      fs.chmodSync(file(), 0o644)
    }
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    expect(fs.readdirSync(root)).toEqual(['elaborators.json'])
  })
  it('writes its file header first and reads it back', async () => {
    const { FILE_FORMATS } = await import('../../src/main/store-format')
    const created = await createElaborator({ kind: 'style', name: 'My style', template: 'My template' })
    expect(Object.entries(JSON.parse(fs.readFileSync(file(), 'utf8'))).slice(0, 2)).toEqual(Object.entries(header(FILE_FORMATS.elaborators)))
    vi.resetModules()
    const reloaded = await import('../../src/main/elaborators')
    expect(reloaded.listElaborators()).toContainEqual(created)
  })
  it('refuses every request on a file from a newer version and leaves its bytes as they were', async () => {
    const { FILE_FORMATS, NewerFormatError } = await import('../../src/main/store-format')
    const bytes = JSON.stringify({ ...header(FILE_FORMATS.elaborators, FILE_FORMATS.elaborators.version + 1), style: [] })
    fs.writeFileSync(file(), bytes)
    expect(() => listElaborators()).toThrow(NewerFormatError)
    await expect(createElaborator({ kind: 'style', name: 'My style', template: 'My template' })).rejects.toThrow(NewerFormatError)
    await expect(resetElaborators()).rejects.toThrow(NewerFormatError)
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    expect(fs.readdirSync(root)).toEqual(['elaborators.json'])
  })
})
