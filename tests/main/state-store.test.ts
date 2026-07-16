import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readUiState, updateUiState, getUiStatePath } from '../../src/main/state-store'

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
    expect(readUiState()).toEqual({ columnWidth: null })
    // Lazy: view state is only written once the user changes something (a drag).
    expect(fs.existsSync(getUiStatePath())).toBe(false)
  })

  it('persists and reads back a column-width update', () => {
    const next = updateUiState({ columnWidth: 240 })
    expect(next).toEqual({ columnWidth: 240 })
    expect(fs.existsSync(getUiStatePath())).toBe(true)
    expect(readUiState()).toEqual({ columnWidth: 240 })
  })

  it('falls back to defaults (not a throw) on a malformed file', () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), '{ not valid json')
    expect(readUiState()).toEqual({ columnWidth: null })
  })

  it('heals a wrong-typed column width to the default on read', () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ columnWidth: 'wide' }))
    expect(readUiState()).toEqual({ columnWidth: null })
  })

  it('preserves a stored numeric column width', () => {
    fs.mkdirSync(path.dirname(getUiStatePath()), { recursive: true })
    fs.writeFileSync(getUiStatePath(), JSON.stringify({ columnWidth: 288 }))
    expect(readUiState()).toEqual({ columnWidth: 288 })
  })
})
