import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readUiState, updateUiState, getUiStatePath } from '../../src/main/state-store'
import { defaultUiState } from '../../src/shared/ui-state'
import { RECORDS_LIST_WIDTH } from '../../src/shared/records-layout'
import { closeBackupStore } from '../../src/main/backup/backup-store'
import { FILE_FORMATS } from '../../src/main/store-format'
import { header } from './file-header'

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.IMAGEQUEUE_DATA_DIR
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-state-'))
  process.env.IMAGEQUEUE_DATA_DIR = home
})

afterEach(() => {
  closeBackupStore()
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_DATA_DIR
  else process.env.IMAGEQUEUE_DATA_DIR = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('ui state store', async () => {
  it('returns defaults and does NOT materialize state.json until something is written', async () => {
    expect((await readUiState())).toEqual(defaultUiState())
    // Lazy: view state is only written once the user changes something (a drag).
    expect(fs.existsSync(getUiStatePath())).toBe(false)
  })

  it('persists and reads back a column-width update', async () => {
    const next = (await updateUiState({ columnWidth: 240 }))
    expect(next).toEqual({ ...defaultUiState(), columnWidth: 240 })
    expect(fs.existsSync(getUiStatePath())).toBe(true)
    expect((await readUiState())).toEqual({ ...defaultUiState(), columnWidth: 240 })
  })

  it('falls back to defaults (not a throw) on a malformed file', async () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), '{ not valid json')
    expect((await readUiState())).toEqual(defaultUiState())
  })

  it('heals a wrong-typed column width to the default on read', async () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ ...header(FILE_FORMATS.uiState), columnWidth: 'wide' }))
    expect((await readUiState())).toEqual(defaultUiState())
  })

  it('preserves a stored numeric column width', async () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ ...header(FILE_FORMATS.uiState), columnWidth: 288 }))
    expect((await readUiState())).toEqual({ ...defaultUiState(), columnWidth: 288 })
  })

  it('keeps the Records list width beside the other adjustments, healed to its bounds on read', async () => {
    expect((await readUiState()).recordsListWidth).toBe(RECORDS_LIST_WIDTH.default)
    await updateUiState({ columnWidth: 240 })
    expect((await updateUiState({ recordsListWidth: 512 }))).toMatchObject({ columnWidth: 240, recordsListWidth: 512 })
    expect((await readUiState())).toMatchObject({ columnWidth: 240, recordsListWidth: 512 })
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ ...header(FILE_FORMATS.uiState), recordsListWidth: 9999 }))
    expect((await readUiState()).recordsListWidth).toBe(RECORDS_LIST_WIDTH.max)
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ ...header(FILE_FORMATS.uiState), recordsListWidth: 'wide' }))
    expect((await readUiState()).recordsListWidth).toBe(RECORDS_LIST_WIDTH.default)
  })
})

describe('ui state file header', async () => {
  // A cache: the version is written, never checked, so each field is read on
  // its own merits whatever build wrote the file.
  it('reads a file with no file header by its fields', async () => {
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ columnWidth: 288 }))
    expect((await readUiState())).toEqual({ ...defaultUiState(), columnWidth: 288 })
  })

  it('writes its file header first and reads it back', async () => {
    await updateUiState({ columnWidth: 240 })
    expect(Object.entries(JSON.parse(fs.readFileSync(getUiStatePath(), 'utf8'))).slice(0, 2)).toEqual(Object.entries(header(FILE_FORMATS.uiState)))
    expect((await readUiState()).columnWidth).toBe(240)
  })

  it('reads a file from a newer version by its fields and replaces it on the next update', async () => {
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ ...header(FILE_FORMATS.uiState, FILE_FORMATS.uiState.version + 1), columnWidth: 288 }))
    expect((await readUiState()).columnWidth).toBe(288)
    expect((await updateUiState({ columnWidth: 240 })).columnWidth).toBe(240)
    expect(JSON.parse(fs.readFileSync(getUiStatePath(), 'utf8'))).toMatchObject({ ...header(FILE_FORMATS.uiState), columnWidth: 240 })
  })
})

it('serializes independent view adjustments without lost fields', async () => {
  await Promise.all([
    updateUiState({ columnWidth: 270 }),
    updateUiState({ recordsListWidth: 400 }),
  ])
  expect(await readUiState()).toMatchObject({ columnWidth: 270, recordsListWidth: 400 })
})
