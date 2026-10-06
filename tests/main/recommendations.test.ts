import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const network = vi.hoisted(() => ({ fetchBytesWithHeaders: vi.fn() }))
vi.mock('../../src/main/dependencies/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/dependencies/download')>()),
  fetchBytesWithHeaders: network.fetchBytesWithHeaders,
}))

import {
  downloadLatestRecommendations,
  getRecommendationsStatus,
  lastModifiedOf,
  resolveRecommendedParams,
} from '../../src/main/recommendations'
import { getRecommendationsTimesPath } from '../../src/main/dependencies/paths'
import { FORMAT_VERSIONS, NewerFormatError } from '../../src/main/store-format'
import { closeBackupStore } from '../../src/main/backup/backup-store'

let home: string
let modelsDir: string
let prevHome: string | undefined

// configs.json lives in the effective models dir (empty models_dir → <root>/models).
function configsPath(): string {
  return path.join(modelsDir, 'configs.json')
}
function writeConfigs(file: string, specs: unknown[]): void {
  fs.mkdirSync(modelsDir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(specs))
}

beforeEach(() => {
  prevHome = process.env.IMAGEQUEUE_DATA_DIR
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-rec-'))
  process.env.IMAGEQUEUE_DATA_DIR = home
  modelsDir = path.join(home, 'models')
})

afterEach(() => {
  closeBackupStore()
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_DATA_DIR
  else process.env.IMAGEQUEUE_DATA_DIR = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('getRecommendationsStatus', () => {
  it('reports absent when no file exists', () => {
    expect(getRecommendationsStatus()).toEqual({
      exists: false,
      valid: false,
      entryCount: 0,
      updatedAt: null,
    })
  })

  it('reports a valid file with its entry count', () => {
    writeConfigs(configsPath(), [{ name: 'a', configuration: { model: 'm' } }])
    const status = getRecommendationsStatus()
    expect(status.exists).toBe(true)
    expect(status.valid).toBe(true)
    expect(status.entryCount).toBe(1)
  })

  it('gives a file no install recorded no date, whatever its modification time', () => {
    writeConfigs(configsPath(), [{ name: 'a', configuration: { model: 'm' } }])
    fs.utimesSync(configsPath(), new Date(), new Date('2026-09-11T20:46:05.000Z'))
    expect(getRecommendationsStatus().updatedAt).toBeNull()
  })
})

describe('resolveRecommendedParams', () => {
  it('returns null when no configs.json is present', () => {
    expect(resolveRecommendedParams('any-model.ckpt')).toBeNull()
  })
})

describe('lastModifiedOf', () => {
  it('reads an HTTP date as ISO-8601 UTC', () => {
    expect(lastModifiedOf({ 'last-modified': 'Fri, 11 Sep 2026 20:46:05 GMT' })).toBe('2026-09-11T20:46:05.000Z')
  })

  it('is null when the header is absent or unreadable', () => {
    expect(lastModifiedOf({})).toBeNull()
    expect(lastModifiedOf({ 'last-modified': 'yesterday-ish' })).toBeNull()
  })
})

describe('downloadLatestRecommendations', () => {
  const body = Buffer.from(JSON.stringify([{ name: 'a', configuration: { model: 'm' } }]))

  const served = { body, headers: { 'last-modified': 'Fri, 11 Sep 2026 20:46:05 GMT' } }

  it('records the server time it was served with under the storage root, writing nothing else beside the file', async () => {
    network.fetchBytesWithHeaders.mockResolvedValueOnce(served)
    const status = await downloadLatestRecommendations()
    expect(status.updatedAt).toBe('2026-09-11T20:46:05.000Z')
    expect(path.dirname(getRecommendationsTimesPath())).toBe(home)
    const times = JSON.parse(fs.readFileSync(getRecommendationsTimesPath(), 'utf8'))
    expect(Object.entries(times)[0]).toEqual(['formatVersion', FORMAT_VERSIONS.recommendationsTimes])
    expect(Object.keys(times.files)).toEqual([path.resolve(configsPath())])
    expect(fs.readdirSync(modelsDir)).toEqual(['configs.json'])
  })

  it('shows no date when the server gives no valid time, and drops an earlier record', async () => {
    network.fetchBytesWithHeaders.mockResolvedValueOnce(served)
    await downloadLatestRecommendations()
    network.fetchBytesWithHeaders.mockResolvedValueOnce({ body, headers: { 'last-modified': 'yesterday-ish' } })
    const status = await downloadLatestRecommendations()
    expect(status.updatedAt).toBeNull()
    expect(JSON.parse(fs.readFileSync(getRecommendationsTimesPath(), 'utf8')).files).toEqual({})
  })

  it('shows no date once the file no longer holds the bytes the time was recorded for', async () => {
    network.fetchBytesWithHeaders.mockResolvedValueOnce(served)
    await downloadLatestRecommendations()
    writeConfigs(configsPath(), [{ name: 'other', configuration: { model: 'm' } }])
    expect(getRecommendationsStatus().updatedAt).toBeNull()
  })

  it('reads an unreadable record as none, and replaces it on the next install', async () => {
    writeConfigs(configsPath(), [{ name: 'a', configuration: { model: 'm' } }])
    fs.writeFileSync(getRecommendationsTimesPath(), '{ not json')
    expect(getRecommendationsStatus().updatedAt).toBeNull()
    network.fetchBytesWithHeaders.mockResolvedValueOnce(served)
    expect((await downloadLatestRecommendations()).updatedAt).toBe('2026-09-11T20:46:05.000Z')
  })

  it('refuses before downloading when a newer build wrote the record, leaving both files as they are', async () => {
    writeConfigs(configsPath(), [{ name: 'a', configuration: { model: 'm' } }])
    const newer = JSON.stringify({ formatVersion: FORMAT_VERSIONS.recommendationsTimes + 1, files: {} })
    fs.writeFileSync(getRecommendationsTimesPath(), newer)
    const configs = fs.readFileSync(configsPath())
    network.fetchBytesWithHeaders.mockClear()
    await expect(downloadLatestRecommendations()).rejects.toBeInstanceOf(NewerFormatError)
    expect(network.fetchBytesWithHeaders).not.toHaveBeenCalled()
    expect(fs.readFileSync(getRecommendationsTimesPath(), 'utf8')).toBe(newer)
    expect(fs.readFileSync(configsPath())).toEqual(configs)
    expect(getRecommendationsStatus().updatedAt).toBeNull()
  })
})
