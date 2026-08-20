import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readUiState, updateUiState, getUiStatePath } from '../../src/main/state-store'
import { defaultUiState, NOTIFICATION_VOLUME_DEFAULT } from '../../src/shared/ui-state'

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.IMAGEQUEUE_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-state-'))
  process.env.IMAGEQUEUE_HOME = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_HOME
  else process.env.IMAGEQUEUE_HOME = prevHome
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
})
