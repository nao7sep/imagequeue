import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { recordedServerTime, recordServerTime } from '../../../src/main/dependencies/recommendations-times'

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.IMAGEQUEUE_DATA_DIR
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-rectimes-'))
  process.env.IMAGEQUEUE_DATA_DIR = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_DATA_DIR
  else process.env.IMAGEQUEUE_DATA_DIR = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

function place(dir: string, bytes: Buffer): string {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'configs.json')
  fs.writeFileSync(file, bytes)
  return file
}

describe('recorded server times', () => {
  const bytes = Buffer.from('[{"name":"a","configuration":{"model":"m"}}]')

  it('dates only the path a time was recorded for, even when another holds the same bytes', () => {
    const first = place(path.join(home, 'models-a'), bytes)
    const second = place(path.join(home, 'models-b'), bytes)
    recordServerTime(first, bytes, '2026-09-11T20:46:05.000Z')
    expect(recordedServerTime(first)).toBe('2026-09-11T20:46:05.000Z')
    expect(recordedServerTime(second)).toBeNull()
  })

  it('keeps each path\'s record when another path is recorded or dropped', () => {
    const first = place(path.join(home, 'models-a'), bytes)
    const second = place(path.join(home, 'models-b'), bytes)
    recordServerTime(first, bytes, '2026-09-11T20:46:05.000Z')
    recordServerTime(second, bytes, '2026-08-22T20:13:13.000Z')
    recordServerTime(second, bytes, null)
    expect(recordedServerTime(first)).toBe('2026-09-11T20:46:05.000Z')
    expect(recordedServerTime(second)).toBeNull()
  })

  it('writes no store when there is nothing to record', () => {
    const file = place(path.join(home, 'models'), bytes)
    recordServerTime(file, bytes, null)
    expect(fs.readdirSync(home)).toEqual(['models'])
  })
})
