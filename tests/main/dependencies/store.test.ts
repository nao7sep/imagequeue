import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readDependenciesCache,
  updateDependenciesCache,
} from '../../../src/main/dependencies/store'
import { getDependenciesStatePath } from '../../../src/main/dependencies/paths'
import { FORMAT_VERSIONS } from '../../../src/main/store-format'

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.IMAGEQUEUE_DATA_DIR
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-store-'))
  process.env.IMAGEQUEUE_DATA_DIR = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_DATA_DIR
  else process.env.IMAGEQUEUE_DATA_DIR = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('dependencies cache', () => {
  it('returns empty defaults when no file exists', async () => {
    expect((await readDependenciesCache())).toEqual({
      lastAttemptAtUtc: null,
      cli: { lastKnownLatest: null, lastCheckedAtUtc: null },
      recommendations: { lastKnownModifiedUtc: null, lastCheckedAtUtc: null },
    })
  })

  it('persists and reads back a mutation', async () => {
    await updateDependenciesCache((cache) => {
      cache.cli.lastKnownLatest = 'v1.20260430.0'
      cache.cli.lastCheckedAtUtc = '2026-06-30T00:00:00.000Z'
    })
    const reread = (await readDependenciesCache())
    expect(reread.cli.lastKnownLatest).toBe('v1.20260430.0')
    expect(reread.cli.lastCheckedAtUtc).toBe('2026-06-30T00:00:00.000Z')
  })

  // The cache holds NETWORK knowledge only. The CLI's installed tag is in its
  // sidecar, and configs.json's installed identity is its own modification time.
  it('records nothing about the artifacts themselves', async () => {
    const cache = (await readDependenciesCache())
    expect(Object.keys(cache)).toEqual(['lastAttemptAtUtc', 'cli', 'recommendations'])
    expect(Object.keys(cache.cli).sort()).toEqual(['lastCheckedAtUtc', 'lastKnownLatest'])
    expect(Object.keys(cache.recommendations).sort()).toEqual(['lastCheckedAtUtc', 'lastKnownModifiedUtc'])
  })

  it('persists what a configs.json check learned', async () => {
    await updateDependenciesCache((cache) => {
      cache.recommendations.lastKnownModifiedUtc = '2026-09-11T20:46:05.000Z'
      cache.recommendations.lastCheckedAtUtc = '2026-09-19T12:00:00.000Z'
    })
    expect((await readDependenciesCache()).recommendations).toEqual({
      lastKnownModifiedUtc: '2026-09-11T20:46:05.000Z',
      lastCheckedAtUtc: '2026-09-19T12:00:00.000Z',
    })
  })

  it('falls back to defaults (not a throw) on a malformed file', async () => {
    fs.mkdirSync(path.dirname(getDependenciesStatePath()), { recursive: true })
    fs.writeFileSync(getDependenciesStatePath(), '{ not valid json')
    expect((await readDependenciesCache())).toEqual({
      lastAttemptAtUtc: null,
      cli: { lastKnownLatest: null, lastCheckedAtUtc: null },
      recommendations: { lastKnownModifiedUtc: null, lastCheckedAtUtc: null },
    })
  })

  it('backfills missing sections from a partial file', async () => {
    fs.mkdirSync(path.dirname(getDependenciesStatePath()), { recursive: true })
    fs.writeFileSync(getDependenciesStatePath(), JSON.stringify({ formatVersion: 1, cli: { lastKnownLatest: 'v1.0.0' } }))
    const cache = (await readDependenciesCache())
    expect(cache.cli.lastKnownLatest).toBe('v1.0.0')
    expect(cache.cli.lastCheckedAtUtc).toBeNull()
  })

  it('persists the last check attempt and reads a non-string one as missing', async () => {
    await updateDependenciesCache((cache) => {
      cache.lastAttemptAtUtc = '2026-10-02T00:00:00.000Z'
    })
    expect((await readDependenciesCache()).lastAttemptAtUtc).toBe('2026-10-02T00:00:00.000Z')
    fs.writeFileSync(getDependenciesStatePath(), JSON.stringify({ formatVersion: 1, lastAttemptAtUtc: 42 }))
    expect((await readDependenciesCache()).lastAttemptAtUtc).toBeNull()
  })
})

describe('dependencies cache format version', () => {
  // A cache: the version is written, never checked.
  it('reads a file with no format version by its fields', async () => {
    fs.writeFileSync(getDependenciesStatePath(), JSON.stringify({ lastAttemptAtUtc: '2026-06-30T00:00:00.000Z' }))
    expect((await readDependenciesCache()).lastAttemptAtUtc).toBe('2026-06-30T00:00:00.000Z')
  })

  it('writes its format version first and reads it back', async () => {
    await updateDependenciesCache((cache) => { cache.lastAttemptAtUtc = '2026-06-30T00:00:00.000Z' })
    expect(Object.entries(JSON.parse(fs.readFileSync(getDependenciesStatePath(), 'utf8')))[0]).toEqual(['formatVersion', FORMAT_VERSIONS.dependencies])
    expect((await readDependenciesCache()).lastAttemptAtUtc).toBe('2026-06-30T00:00:00.000Z')
  })

  it('reads a file from a newer version by its fields and replaces it on the next update', async () => {
    fs.mkdirSync(path.dirname(getDependenciesStatePath()), { recursive: true })
    fs.writeFileSync(getDependenciesStatePath(), JSON.stringify({ formatVersion: FORMAT_VERSIONS.dependencies + 1, lastAttemptAtUtc: '2026-06-30T00:00:00.000Z' }))
    expect((await readDependenciesCache()).lastAttemptAtUtc).toBe('2026-06-30T00:00:00.000Z')
    await updateDependenciesCache((cache) => { cache.lastAttemptAtUtc = '2026-07-01T00:00:00.000Z' })
    expect(JSON.parse(fs.readFileSync(getDependenciesStatePath(), 'utf8'))).toMatchObject({
      formatVersion: FORMAT_VERSIONS.dependencies, lastAttemptAtUtc: '2026-07-01T00:00:00.000Z',
    })
  })
})
