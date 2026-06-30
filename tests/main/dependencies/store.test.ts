import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readDependenciesCache,
  updateDependenciesCache,
} from '../../../src/main/dependencies/store'
import { getDependenciesStatePath } from '../../../src/main/dependencies/paths'

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.IMAGEQUEUE_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-store-'))
  process.env.IMAGEQUEUE_HOME = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_HOME
  else process.env.IMAGEQUEUE_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('dependencies cache', () => {
  it('returns empty defaults when no file exists', () => {
    expect(readDependenciesCache()).toEqual({
      cli: { lastKnownLatest: null, lastCheckedAtUtc: null },
      recommendations: { lastCheckedAtUtc: null, pending: false },
    })
  })

  it('persists and reads back a mutation', () => {
    updateDependenciesCache((cache) => {
      cache.cli.lastKnownLatest = 'v1.20260430.0'
      cache.cli.lastCheckedAtUtc = '2026-06-30T00:00:00.000Z'
      cache.recommendations.pending = true
    })
    const reread = readDependenciesCache()
    expect(reread.cli.lastKnownLatest).toBe('v1.20260430.0')
    expect(reread.cli.lastCheckedAtUtc).toBe('2026-06-30T00:00:00.000Z')
    expect(reread.recommendations.pending).toBe(true)
  })

  it('falls back to defaults (not a throw) on a malformed file', () => {
    fs.mkdirSync(path.dirname(getDependenciesStatePath()), { recursive: true })
    fs.writeFileSync(getDependenciesStatePath(), '{ not valid json')
    expect(readDependenciesCache().recommendations.pending).toBe(false)
  })

  it('backfills missing sections from a partial file', () => {
    fs.mkdirSync(path.dirname(getDependenciesStatePath()), { recursive: true })
    fs.writeFileSync(getDependenciesStatePath(), JSON.stringify({ cli: { lastKnownLatest: 'v1.0.0' } }))
    const cache = readDependenciesCache()
    expect(cache.cli.lastKnownLatest).toBe('v1.0.0')
    expect(cache.cli.lastCheckedAtUtc).toBeNull()
    expect(cache.recommendations).toEqual({ lastCheckedAtUtc: null, pending: false })
  })
})
