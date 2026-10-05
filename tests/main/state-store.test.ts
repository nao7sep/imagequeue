import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readUiState, updateUiState, getUiStatePath } from '../../src/main/state-store'
import { defaultUiState, NOTIFICATION_VOLUME_DEFAULT } from '../../src/shared/ui-state'
import { RECORDS_LIST_WIDTH } from '../../src/shared/records-layout'
import { closeBackupStore } from '../../src/main/backup/backup-store'
import { FORMAT_VERSIONS } from '../../src/main/store-format'

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

describe('ui state store', () => {
  it('returns defaults and does NOT materialize state.json until something is written', () => {
    expect(readUiState()).toEqual(defaultUiState())
    // Lazy: view state is only written once the user changes something (a drag).
    expect(fs.existsSync(getUiStatePath())).toBe(false)
  })

  it('persists and reads back a column-width update', () => {
    const next = updateUiState({ columnWidth: 240 })
    expect(next).toEqual({ ...defaultUiState(), columnWidth: 240 })
    expect(fs.existsSync(getUiStatePath())).toBe(true)
    expect(readUiState()).toEqual({ ...defaultUiState(), columnWidth: 240 })
  })

  it('falls back to defaults (not a throw) on a malformed file', () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), '{ not valid json')
    expect(readUiState()).toEqual(defaultUiState())
  })

  it('heals a wrong-typed column width to the default on read', () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ columnWidth: 'wide' }))
    expect(readUiState()).toEqual(defaultUiState())
  })

  it('preserves a stored numeric column width', () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ columnWidth: 288 }))
    expect(readUiState()).toEqual({ ...defaultUiState(), columnWidth: 288 })
  })

  it('persists and reads back the notification volume', () => {
    expect(updateUiState({ notificationVolume: 0.25 }).notificationVolume).toBe(0.25)
    expect(readUiState().notificationVolume).toBe(0.25)
  })

  // The value drives an <audio> element's volume, which THROWS on anything
  // outside 0-1, and state.json is hand-editable — so read clamps rather than
  // merely type-checking.
  it('clamps a stored volume into the playable range', () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ notificationVolume: 4 }))
    expect(readUiState().notificationVolume).toBe(1)
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ notificationVolume: -2 }))
    expect(readUiState().notificationVolume).toBe(0)
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ notificationVolume: 'loud' }))
    expect(readUiState().notificationVolume).toBe(NOTIFICATION_VOLUME_DEFAULT)
  })

  it('keeps the Records list width beside the other adjustments, healed to its bounds on read', () => {
    expect(readUiState().recordsListWidth).toBe(RECORDS_LIST_WIDTH.default)
    updateUiState({ columnWidth: 240 })
    expect(updateUiState({ recordsListWidth: 512 })).toMatchObject({ columnWidth: 240, recordsListWidth: 512 })
    expect(readUiState()).toMatchObject({ columnWidth: 240, recordsListWidth: 512 })
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ recordsListWidth: 9999 }))
    expect(readUiState().recordsListWidth).toBe(RECORDS_LIST_WIDTH.max)
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ recordsListWidth: 'wide' }))
    expect(readUiState().recordsListWidth).toBe(RECORDS_LIST_WIDTH.default)
  })
})

describe('ui state format version', () => {
  it('reads a file with no format version as version 1', () => {
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ columnWidth: 288 }))
    expect(readUiState().columnWidth).toBe(288)
  })

  it('writes its format version first and reads it back', () => {
    updateUiState({ columnWidth: 240 })
    expect(Object.entries(JSON.parse(fs.readFileSync(getUiStatePath(), 'utf8')))[0]).toEqual(['formatVersion', FORMAT_VERSIONS.uiState])
    expect(readUiState().columnWidth).toBe(240)
  })

  it('reads a file from a newer version as defaults and never writes it', () => {
    const bytes = JSON.stringify({ formatVersion: FORMAT_VERSIONS.uiState + 1, columnWidth: 288 })
    fs.writeFileSync(getUiStatePath(), bytes)
    expect(readUiState()).toEqual(defaultUiState())
    expect(updateUiState({ columnWidth: 240 }).columnWidth).toBe(240)
    expect(fs.readFileSync(getUiStatePath(), 'utf8')).toBe(bytes)
  })
})
