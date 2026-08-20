import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  getRecommendationsStatus,
  applyPendingRecommendations,
  hasPendingRecommendationsUpdate,
  resolveRecommendedParams,
} from '../../../src/main/recommendations'

let home: string
let modelsDir: string
let prevHome: string | undefined

// configs.json lives in the effective models dir (empty models_dir → <root>/models).
function configsPath(): string {
  return path.join(modelsDir, 'configs.json')
}
function pendingPath(): string {
  return path.join(modelsDir, 'configs-pending.json')
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

// "An update is waiting" is the staged file's existence, never a recorded flag —
// so applying it is the rename, and nothing else has to be kept in step.
describe('applyPendingRecommendations', () => {
  it('promotes the staged pending file over configs.json', () => {
    writeConfigs(configsPath(), [{ name: 'old', configuration: { model: 'm' } }])
    writeConfigs(pendingPath(), [
      { name: 'new1', configuration: { model: 'm1' } },
      { name: 'new2', configuration: { model: 'm2' } },
    ])
    expect(hasPendingRecommendationsUpdate()).toBe(true)

    const status = applyPendingRecommendations()

    expect(fs.existsSync(pendingPath())).toBe(false)
    expect(JSON.parse(fs.readFileSync(configsPath(), 'utf8'))).toHaveLength(2)
    expect(status.entryCount).toBe(2)
    expect(hasPendingRecommendationsUpdate()).toBe(false)
  })

  it('is a no-op when nothing is staged', () => {
    writeConfigs(configsPath(), [{ name: 'only', configuration: { model: 'm' } }])
    expect(hasPendingRecommendationsUpdate()).toBe(false)
    const status = applyPendingRecommendations()
    expect(status.entryCount).toBe(1)
  })

  // The defect a persisted flag carries: it outlives the file it describes. A
  // staged file deleted out of band (a cleaned models dir, a models_dir the user
  // repointed) used to leave "update available" showing forever, with Apply a
  // silent no-op. Read from disk, the row simply stops claiming an update.
  it('stops claiming an update the moment the staged file is gone', () => {
    writeConfigs(configsPath(), [{ name: 'old', configuration: { model: 'm' } }])
    writeConfigs(pendingPath(), [{ name: 'new', configuration: { model: 'm1' } }])
    expect(hasPendingRecommendationsUpdate()).toBe(true)

    fs.rmSync(pendingPath())
    expect(hasPendingRecommendationsUpdate()).toBe(false)
  })
})

describe('resolveRecommendedParams', () => {
  it('returns null when no configs.json is present', () => {
    expect(resolveRecommendedParams('any-model.ckpt')).toBeNull()
  })
})
