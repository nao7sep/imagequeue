import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readUiState, updateUiState, getUiStatePath } from '../../src/main/state-store'
import { defaultUiState, NOTIFICATION_VOLUME_DEFAULT } from '../../src/shared/ui-state'
import { closeBackupStore } from '../../src/main/backup/backup-store'

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.IMAGEQUEUE_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-state-'))
  process.env.IMAGEQUEUE_HOME = home
})

afterEach(() => {
  closeBackupStore()
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_HOME
  else process.env.IMAGEQUEUE_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('ui state store', () => {
  it('retains native placement across unrelated state writes and reloads', () => {
    const placement = { normalBounds: { x: 89, y: 81, width: 1201, height: 749 }, mode: 'normal' as const,
      windowsNormalBounds: { left: 111, top: 101, right: 1613, bottom: 1038 } }
    updateUiState({ windowPlacements: { main: placement } })
    updateUiState({ columnWidth: 240 })
    expect(readUiState().windowPlacements.main).toEqual(placement)
  })

  it('discards only malformed native geometry and preserves the compatible record', () => {
    const placement = { normalBounds: { x: 89, y: 81, width: 1201, height: 749 }, mode: 'maximized',
      windowsNormalBounds: { left: 100, top: 100, right: 100, bottom: 800 } }
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ columnWidth: 240, windowPlacements: { main: placement } }))
    const state = readUiState()
    expect(state.columnWidth).toBe(240)
    expect(state.windowPlacements.main).toEqual({ ...placement, windowsNormalBounds: null })
  })

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

  it('normalizes window geometry and stable mode independently', () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), JSON.stringify({
      notificationVolume: 0.25,
      windowPlacements: {
        main: {
          normalBounds: { x: 10, y: 20, width: 'wide', height: 800 },
          mode: 'maximized',
        },
      },
    }))
    const state = readUiState()
    expect(state.notificationVolume).toBe(0.25)
    expect(state.windowPlacements.main).toEqual({ normalBounds: null, mode: 'maximized' })
  })
})
