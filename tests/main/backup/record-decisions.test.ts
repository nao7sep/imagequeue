import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveConfig } from '../../../src/main/config'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { materializeElaborators, createElaborator } from '../../../src/main/elaborators'
import { setModelParams } from '../../../src/main/model-params'
import { updateDependenciesCache } from '../../../src/main/dependencies/store'
import { closeBackupStore } from '../../../src/main/backup/backup-store'

// The record/no-record wiring at REAL managed-text write sites, end to end through the shared
// atomic-write choke point (utils/atomic-write.ts → backup/backup-store.ts). This is the "what is
// backed up and what is not" pin: it proves the per-write-site `records` boolean actually reaches the
// store, rather than only unit-testing record() in isolation.
//
//   RECORDED   config.json, elaborators.json, params.json — durable, user-authored managed text.
//   NO-RECORD  dependencies.json — a re-derivable dependency-check cache.
//
// (output/ session manifests, the api-keys.json secret, the models-dir configs.json dependency, and
// the bin/ CLI sidecar are the other no-record sites; they are exercised by their own stores' tests
// and, for the secret/binary paths, never route through this choke point at all.)

const ENV_VAR = 'IMAGEQUEUE_HOME'

/** Distinct recorded paths in the store, or [] when the store file was never created. */
function recordedPaths(root: string): string[] {
  const storeFile = path.join(root, 'backups.sqlite3')
  if (!fs.existsSync(storeFile)) return []
  const db = new DatabaseSync(storeFile)
  try {
    const rows = db.prepare('SELECT DISTINCT path FROM backups ORDER BY path').all() as Array<{ path: string }>
    return rows.map((r) => r.path)
  } finally {
    db.close()
  }
}

describe('record/no-record decisions at real write sites', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-recorddecisions-'))
    process.env[ENV_VAR] = tmpRoot
  })

  afterEach(() => {
    closeBackupStore()
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('records config.json on save', () => {
    saveConfig(createDefaultConfig())
    closeBackupStore()
    expect(recordedPaths(tmpRoot)).toContain(path.join(tmpRoot, 'config.json'))
  })

  it('records elaborators.json on materialize and on a mutating write', () => {
    materializeElaborators() // first-run write-if-absent
    createElaborator({ kind: 'content', name: 'X', template: 'a template' })
    closeBackupStore()
    expect(recordedPaths(tmpRoot)).toContain(path.join(tmpRoot, 'elaborators.json'))
  })

  it('records params.json when a model param is set (after the debounced write flushes)', async () => {
    setModelParams('some-model.ckpt', {
      width: 512,
      height: 512,
      steps: 20,
      guidance: 7,
      seed: '',
      negativePrompt: '',
    })
    // model-params debounces its write ~200ms; wait past that so the flush lands and records.
    await new Promise((r) => setTimeout(r, 350))
    closeBackupStore()
    expect(recordedPaths(tmpRoot)).toContain(path.join(tmpRoot, 'params.json'))
  })

  it('does NOT record dependencies.json (a re-derivable cache)', () => {
    updateDependenciesCache((cache) => {
      cache.cli.lastKnownLatest = 'v1.0'
      cache.recommendations.pending = true
    })
    // The cache file must be on disk...
    expect(fs.existsSync(path.join(tmpRoot, 'dependencies.json'))).toBe(true)
    closeBackupStore()
    // ...but never recorded into the backup store.
    expect(recordedPaths(tmpRoot)).not.toContain(path.join(tmpRoot, 'dependencies.json'))
  })

  it('a no-record-only session never creates the store file at all', () => {
    updateDependenciesCache((cache) => {
      cache.cli.lastCheckedAtUtc = '2026-07-06T00:00:00.000Z'
    })
    closeBackupStore()
    // No recorded write happened, so backups.sqlite3 was never opened/created.
    expect(fs.existsSync(path.join(tmpRoot, 'backups.sqlite3'))).toBe(false)
  })

  it('store-file filter: backups.sqlite3 and its -wal/-shm sidecars are excludable when asserting root contents', () => {
    saveConfig(createDefaultConfig()) // triggers a recorded write → store file (+ WAL sidecars) appear
    closeBackupStore()

    const isStoreArtifact = (name: string) =>
      name === 'backups.sqlite3' || name === 'backups.sqlite3-wal' || name === 'backups.sqlite3-shm'
    const entries = fs.readdirSync(tmpRoot)
    // The store file exists...
    expect(entries).toContain('backups.sqlite3')
    // ...and once the store artifacts are filtered out, only the app's own files remain — this is the
    // filter a test migrates in wherever it asserts a throwaway root's exact contents (data-backup
    // conventions: the -wal/-shm sidecars are normal SQLite artifacts, not stray files).
    const appFiles = entries.filter((name) => !isStoreArtifact(name))
    expect(appFiles).toContain('config.json')
    expect(appFiles.filter(isStoreArtifact)).toEqual([])
  })
})
