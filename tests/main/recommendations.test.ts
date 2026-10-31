import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { header } from './file-header'

const network = vi.hoisted(() => ({ fetchBytesWithHeaders: vi.fn() }))
vi.mock('../../src/main/dependencies/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/dependencies/download')>()),
  fetchBytesWithHeaders: network.fetchBytesWithHeaders,
}))

import {
  downloadLatestRecommendations,
  getRecommendationsStatus,
  recommendationsExist,
  lastModifiedOf,
  resolveRecommendedParams,
} from '../../src/main/recommendations'
import { getRecommendationsTimesPath } from '../../src/main/dependencies/paths'
import { recordServerTime } from '../../src/main/dependencies/recommendations-times'
import * as recommendationTimes from '../../src/main/dependencies/recommendations-times'
import * as logger from '../../src/main/logger'
import * as localCli from '../../src/main/local-cli'
import { FILE_FORMATS } from '../../src/main/store-format'
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

afterEach(async () => {
  vi.restoreAllMocks()
  await closeBackupStore()
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_DATA_DIR
  else process.env.IMAGEQUEUE_DATA_DIR = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('getRecommendationsStatus', () => {
  it('parses and dates one snapshot even when the source is replaced after its read', async () => {
    const first = Buffer.from(JSON.stringify([{ name: 'a', configuration: { model: 'm' } }]))
    const second = Buffer.from(JSON.stringify([
      { name: 'b', configuration: { model: 'm' } },
      { name: 'c', configuration: { model: 'n' } },
    ]))
    fs.mkdirSync(modelsDir, { recursive: true })
    fs.writeFileSync(configsPath(), first)
    await recordServerTime(configsPath(), first, '2026-09-11T20:46:05.000Z')
    const readFile = fs.promises.readFile
    const read = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (...args) => {
      const bytes = await readFile(...args)
      if (args[0] === configsPath()) fs.writeFileSync(configsPath(), second)
      return bytes
    })
    expect(await getRecommendationsStatus()).toEqual({
      exists: true, valid: true, entryCount: 1, updatedAt: '2026-09-11T20:46:05.000Z',
    })
    expect(read.mock.calls.filter(([file]) => file === configsPath())).toHaveLength(1)
    expect(await getRecommendationsStatus()).toEqual({ exists: true, valid: true, entryCount: 2, updatedAt: null })
  })

  it('checks existence without reading or validating file content', async () => {
    fs.mkdirSync(modelsDir, { recursive: true })
    fs.writeFileSync(configsPath(), '{ broken')
    const read = vi.spyOn(fs.promises, 'readFile')
    expect(await recommendationsExist()).toBe(true)
    fs.unlinkSync(configsPath())
    expect(await recommendationsExist()).toBe(false)
    expect(read.mock.calls.filter(([file]) => file === configsPath())).toHaveLength(0)
  })

  it('reports absent when no file exists', async () => {
    expect(await getRecommendationsStatus()).toEqual({
      exists: false,
      valid: false,
      entryCount: 0,
      updatedAt: null,
    })
  })

  it('reports a valid file with its entry count', async () => {
    writeConfigs(configsPath(), [{ name: 'a', configuration: { model: 'm' } }])
    const status = await getRecommendationsStatus()
    expect(status.exists).toBe(true)
    expect(status.valid).toBe(true)
    expect(status.entryCount).toBe(1)
  })

  it('gives a file no install recorded no date, whatever its modification time', async () => {
    writeConfigs(configsPath(), [{ name: 'a', configuration: { model: 'm' } }])
    fs.utimesSync(configsPath(), new Date(), new Date('2026-09-11T20:46:05.000Z'))
    expect(await (await getRecommendationsStatus()).updatedAt).toBeNull()
  })
})

describe('resolveRecommendedParams', () => {
  it('returns null when no configs.json is present', async () => {
    expect(await resolveRecommendedParams('any-model.ckpt')).toBeNull()
  })

  it.each(['{ broken', '{}', '[]', '[{"name":"bad","configuration":{"width":"wide"}}]'])(
    'rejects malformed recommendations and preserves their exact bytes: %s', async (bytes) => {
      fs.mkdirSync(modelsDir, { recursive: true })
      fs.writeFileSync(configsPath(), bytes)
      await expect(resolveRecommendedParams('any-model.ckpt')).rejects.toBeInstanceOf(Error)
      expect(fs.readFileSync(configsPath(), 'utf8')).toBe(bytes)
      expect(fs.readdirSync(modelsDir)).toEqual(['configs.json'])
    },
  )

  it('propagates read failures instead of treating them as absence', async () => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const read = vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(error)
    try {
      await expect(resolveRecommendedParams('any-model.ckpt')).rejects.toBe(error)
    } finally {
      read.mockRestore()
    }
  })

})

describe('lastModifiedOf', () => {
  it('reads an HTTP date as ISO-8601 UTC', async () => {
    expect(lastModifiedOf({ 'last-modified': 'Fri, 11 Sep 2026 20:46:05 GMT' })).toBe('2026-09-11T20:46:05.000Z')
  })

  it('is null when the header is absent or unreadable', async () => {
    expect(lastModifiedOf({})).toBeNull()
    expect(lastModifiedOf({ 'last-modified': 'yesterday-ish' })).toBeNull()
  })
})

describe('downloadLatestRecommendations', () => {
  const body = Buffer.from(JSON.stringify([{ name: 'a', configuration: { model: 'm' } }]))

  const served = { body, headers: { 'last-modified': 'Fri, 11 Sep 2026 20:46:05 GMT' } }

  it('returns installed bytes and a secondary warning when recording the server date fails', async () => {
    const failure = new Error('SECRET_SENTINEL metadata write failed', { cause: new Error('disk unavailable') })
    vi.spyOn(recommendationTimes, 'recordServerTime').mockRejectedValueOnce(failure)
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined)
    network.fetchBytesWithHeaders.mockReset().mockResolvedValueOnce(served)
    const result = await downloadLatestRecommendations()
    expect(fs.readFileSync(configsPath())).toEqual(body)
    expect(result.status).toEqual({ exists: true, valid: true, entryCount: 1, updatedAt: '2026-09-11T20:46:05.000Z' })
    expect(result.warnings).toEqual(['time-not-saved'])
    expect(network.fetchBytesWithHeaders).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledExactlyOnceWith('warn', expect.stringContaining('were installed'), {
      filePath: configsPath(), error: logger.serializeError(failure),
    })
  })

  it('publishes to the captured destination when settings change during acquisition', async () => {
    const nextDirectory = path.join(home, 'next-models')
    const resolve = vi.spyOn(localCli, 'resolveModelsDir').mockReturnValue(modelsDir)
    network.fetchBytesWithHeaders.mockImplementationOnce(async () => {
      resolve.mockReturnValue(nextDirectory)
      return served
    })
    const result = await downloadLatestRecommendations()
    expect(result.filePath).toBe(configsPath())
    expect(fs.readFileSync(configsPath())).toEqual(body)
    expect(fs.existsSync(nextDirectory)).toBe(false)
  })

  it('records the server time it was served with under the storage root, writing nothing else beside the file', async () => {
    network.fetchBytesWithHeaders.mockResolvedValueOnce(served)
    const read = vi.spyOn(fs.promises, 'readFile')
    const { status } = await downloadLatestRecommendations()
    expect(status).toMatchObject({ exists: true, valid: true, entryCount: 1 })
    // The atomic writer checks existing bytes once before publication; status
    // must not reopen the installed file to parse or hash it again afterward.
    expect(read.mock.calls.filter(([file]) => file === configsPath())).toHaveLength(1)
    expect(status.updatedAt).toBe('2026-09-11T20:46:05.000Z')
    expect(path.dirname(getRecommendationsTimesPath())).toBe(home)
    const times = JSON.parse(fs.readFileSync(getRecommendationsTimesPath(), 'utf8'))
    expect(Object.entries(times).slice(0, 2)).toEqual(Object.entries(header(FILE_FORMATS.recommendationsTimes)))
    expect(Object.keys(times.files)).toEqual([path.resolve(configsPath())])
    expect(fs.readdirSync(modelsDir)).toEqual(['configs.json'])
  })

  it('shows no date when the server gives no valid time, and drops an earlier record', async () => {
    network.fetchBytesWithHeaders.mockResolvedValueOnce(served)
    await downloadLatestRecommendations()
    network.fetchBytesWithHeaders.mockResolvedValueOnce({ body, headers: { 'last-modified': 'yesterday-ish' } })
    const { status } = await downloadLatestRecommendations()
    expect(status.updatedAt).toBeNull()
    expect(JSON.parse(fs.readFileSync(getRecommendationsTimesPath(), 'utf8')).files).toEqual({})
  })

  it('shows no date once the file no longer holds the bytes the time was recorded for', async () => {
    network.fetchBytesWithHeaders.mockResolvedValueOnce(served)
    await downloadLatestRecommendations()
    writeConfigs(configsPath(), [{ name: 'other', configuration: { model: 'm' } }])
    expect(await (await getRecommendationsStatus()).updatedAt).toBeNull()
  })

  it('reads an unreadable record as none, and replaces it on the next install', async () => {
    writeConfigs(configsPath(), [{ name: 'a', configuration: { model: 'm' } }])
    fs.writeFileSync(getRecommendationsTimesPath(), '{ not json')
    expect(await (await getRecommendationsStatus()).updatedAt).toBeNull()
    network.fetchBytesWithHeaders.mockResolvedValueOnce(served)
    expect((await downloadLatestRecommendations()).status.updatedAt).toBe('2026-09-11T20:46:05.000Z')
  })

  // A cache: the version is written, never checked, so a newer build's record
  // is replaced like any other.
  it('never writes over a record a newer build wrote', async () => {
    writeConfigs(configsPath(), [{ name: 'a', configuration: { model: 'm' } }])
    const bytes = JSON.stringify({ ...header(FILE_FORMATS.recommendationsTimes, FILE_FORMATS.recommendationsTimes.version + 1), files: {} })
    fs.writeFileSync(getRecommendationsTimesPath(), bytes)
    network.fetchBytesWithHeaders.mockResolvedValueOnce(served)
    await downloadLatestRecommendations()
    expect(fs.readFileSync(getRecommendationsTimesPath(), 'utf8')).toBe(bytes)
  })
})
