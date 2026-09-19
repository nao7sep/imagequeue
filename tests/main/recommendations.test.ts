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
  prevHome = process.env.IMAGEQUEUE_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-rec-'))
  process.env.IMAGEQUEUE_HOME = home
  modelsDir = path.join(home, 'models')
})

afterEach(() => {
  closeBackupStore()
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_HOME
  else process.env.IMAGEQUEUE_HOME = prevHome
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
    expect(status.updatedAt).not.toBeNull()
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

  it('stamps the file with the server time it was served with', async () => {
    network.fetchBytesWithHeaders.mockResolvedValueOnce({
      body,
      headers: { 'last-modified': 'Fri, 11 Sep 2026 20:46:05 GMT' },
    })
    const status = await downloadLatestRecommendations()
    expect(status.updatedAt).toBe('2026-09-11T20:46:05.000Z')
    expect(fs.statSync(configsPath()).mtime.toISOString()).toBe('2026-09-11T20:46:05.000Z')
  })

  it('keeps the write time when the server gives no time', async () => {
    network.fetchBytesWithHeaders.mockResolvedValueOnce({ body, headers: {} })
    const before = Date.now()
    const status = await downloadLatestRecommendations()
    expect(Date.parse(status.updatedAt as string)).toBeGreaterThanOrEqual(before - 1000)
  })
})
