import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expandUserPath, getDefaultModelsDir, resolveModelsDir } from '../../src/main/local-cli'
import { closeBackupStore } from '../../src/main/backup/backup-store'
import { updateConfig } from '../../src/main/config'

const ENV_VAR = 'IMAGEQUEUE_DATA_DIR'

// The models directory is no longer pinned to ~/.imagequeue/models at import
// time (Phase-2 fix). getDefaultModelsDir() now derives it lazily from
// getDataDir(), so it follows IMAGEQUEUE_DATA_DIR, and resolveModelsDir() falls back
// to it whenever drawthings.models_dir is blank (the default config state).
describe('models directory follows IMAGEQUEUE_DATA_DIR', () => {
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

  it('getDefaultModelsDir() resolves under the IMAGEQUEUE_DATA_DIR override, not ~/.imagequeue', () => {
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

  it('resolveModelsDir() resolves a relative drawthings.models_dir against the storage root', () => {
    updateConfig((draft) => {
      draft.image_backends.drawthings.models_dir = 'models-here'
    })
    expect(resolveModelsDir()).toBe(path.join(tmpRoot, 'models-here'))
  })
})

describe('expandUserPath', () => {
  const base = path.join(os.tmpdir(), 'iq-base')

  // A user-typed path must be absolute by the time it reaches the filesystem:
  // relative resolves against process.cwd(), which is "/" for a double-clicked
  // app — the models dir and configs.json would land somewhere the user never
  // sees, differently between dev and the packaged build.
  it('resolves a relative path against the given base, never cwd', () => {
    expect(expandUserPath('models-here', base)).toBe(path.join(base, 'models-here'))
  })

  it('expands ~ and ~/ to the home directory', () => {
    expect(expandUserPath('~', base)).toBe(os.homedir())
    expect(expandUserPath('~/models', base)).toBe(path.join(os.homedir(), 'models'))
  })

  it('does not corrupt ~user into <home>user', () => {
    const dir = expandUserPath('~someuser/models', base)
    expect(dir).not.toContain(os.homedir() + 'someuser')
  })

  it('expands $VAR and %VAR% from the environment', () => {
    process.env['IQ_TEST_PATH_VAR'] = os.tmpdir()
    try {
      expect(expandUserPath('$IQ_TEST_PATH_VAR/m', base)).toBe(path.join(os.tmpdir(), 'm'))
      expect(expandUserPath('%IQ_TEST_PATH_VAR%/m', base)).toBe(path.join(os.tmpdir(), 'm'))
    } finally {
      delete process.env['IQ_TEST_PATH_VAR']
    }
  })
})
