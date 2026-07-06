import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultModelsDir, resolveModelsDir } from '../../../src/main/local-cli'
import { closeBackupStore } from '../../../src/main/backup/backup-store'

const ENV_VAR = 'IMAGEQUEUE_HOME'

// The models directory is no longer pinned to ~/.imagequeue/models at import
// time (Phase-2 fix). getDefaultModelsDir() now derives it lazily from
// getDataDir(), so it follows IMAGEQUEUE_HOME, and resolveModelsDir() falls back
// to it whenever drawthings.models_dir is blank (the default config state).
describe('models directory follows IMAGEQUEUE_HOME', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-models-'))
    process.env[ENV_VAR] = tmpRoot
  })

  afterEach(() => {
    // resolveModelsDir()'s fallback path calls loadConfig(), which seeds config.json on a fresh root —
    // a recorded managed-text write. Close the store singleton so the next test re-opens it against its
    // own throwaway root rather than the previous, now-deleted one.
    closeBackupStore()
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('getDefaultModelsDir() resolves under the IMAGEQUEUE_HOME override, not ~/.imagequeue', () => {
    const expected = path.join(tmpRoot, 'models')
    expect(getDefaultModelsDir()).toBe(expected)
    // Guard against a regression to the old hardcoded private dir.
    expect(getDefaultModelsDir()).not.toBe(path.join(os.homedir(), '.imagequeue', 'models'))
  })

  it('resolveModelsDir() falls back to the default when drawthings.models_dir is blank', () => {
    // A fresh storage root has no config.json, so loadConfig() seeds defaults
    // (models_dir === ''); resolveModelsDir() must then return the default dir.
    expect(resolveModelsDir()).toBe(getDefaultModelsDir())
    expect(resolveModelsDir()).toBe(path.join(tmpRoot, 'models'))
  })
})
