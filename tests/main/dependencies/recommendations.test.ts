import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  getRecommendationsStatus,
  applyPendingRecommendations,
  resolveRecommendedParams,
} from '../../../src/main/recommendations'
import { readDependenciesCache, updateDependenciesCache } from '../../../src/main/dependencies/store'

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

describe('applyPendingRecommendations', () => {
  it('promotes the staged pending file over configs.json and clears the pending flag', () => {
    writeConfigs(configsPath(), [{ name: 'old', configuration: { model: 'm' } }])
    writeConfigs(pendingPath(), [
      { name: 'new1', configuration: { model: 'm1' } },
      { name: 'new2', configuration: { model: 'm2' } },
    ])
    updateDependenciesCache((c) => { c.recommendations.pending = true })

    const status = applyPendingRecommendations()

    expect(fs.existsSync(pendingPath())).toBe(false)
    expect(JSON.parse(fs.readFileSync(configsPath(), 'utf8'))).toHaveLength(2)
    expect(status.entryCount).toBe(2)
    expect(readDependenciesCache().recommendations.pending).toBe(false)
  })

  it('is a no-op (just clears the flag) when nothing is pending', () => {
    writeConfigs(configsPath(), [{ name: 'only', configuration: { model: 'm' } }])
    const status = applyPendingRecommendations()
    expect(status.entryCount).toBe(1)
    expect(readDependenciesCache().recommendations.pending).toBe(false)
  })
})

describe('resolveRecommendedParams', () => {
  it('returns null when no configs.json is present', () => {
    expect(resolveRecommendedParams('any-model.ckpt')).toBeNull()
  })
})
