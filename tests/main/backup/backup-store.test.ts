import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inProcessBackupThread } from '../../setup/backup-thread'

// The main-process side of the backup history: a save hands its bytes over and
// returns, whatever the history does. The backup thread runs in-process here
// (tests/setup/backup-thread.ts) unless a test replaces it.

const ENV_VAR = 'IMAGEQUEUE_DATA_DIR'

describe('backup store', () => {
  let root: string
  let storeFile: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-backupstore-'))
    process.env[ENV_VAR] = root
    storeFile = path.join(root, 'backups.sqlite3')
    vi.resetModules()
  })
  afterEach(async () => {
    const { closeBackupStore } = await import('../../../src/main/backup/backup-store')
    await closeBackupStore()
    vi.doMock('../../../src/main/backup/backup-worker?nodeWorker', inProcessBackupThread)
    vi.restoreAllMocks()
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('records under the resolved root, one row per file for the launch', async () => {
    const { record, closeBackupStore } = await import('../../../src/main/backup/backup-store')
    const { currentRecordsContext } = await import('../../../src/main/records')
    record(path.join(root, 'config.json'), Buffer.from('{"v":1}'))
    record(path.join(root, 'config.json'), Buffer.from('{"v":2}'))
    await closeBackupStore()
    const db = new DatabaseSync(storeFile, { readOnly: true })
    try {
      expect(db.prepare('SELECT session_id, content FROM backups').all()).toEqual([
        { session_id: currentRecordsContext().launch, content: new Uint8Array(Buffer.from('{"v":2}')) },
      ])
    } finally {
      db.close()
    }
  })

  it('never throws and logs once when the history cannot be opened, and the save is unaffected', async () => {
    fs.mkdirSync(storeFile)
    const logger = await import('../../../src/main/logger')
    const log = vi.spyOn(logger, 'log')
    const { record, closeBackupStore } = await import('../../../src/main/backup/backup-store')
    const saved = path.join(root, 'config.json')
    fs.writeFileSync(saved, '{"saved":true}')
    expect(() => record(saved, Buffer.from('{"saved":true}'))).not.toThrow()
    expect(() => record(saved, Buffer.from('{"saved":2}'))).not.toThrow()
    await closeBackupStore()
    expect(fs.readFileSync(saved, 'utf8')).toBe('{"saved":true}')
    expect(log.mock.calls.filter(([level]) => level === 'warn')).toEqual([
      ['warn', 'Backup history could not be opened; recording is off for this launch', expect.objectContaining({ file: storeFile })],
    ])
  })

  // A history that never answers stands for a stalled disk or a locked store.
  it('hands a save over without waiting, and drops what a stuck history still holds at quit within its bound', async () => {
    const posted: unknown[] = []
    const terminate = vi.fn(async () => 1)
    vi.doMock('../../../src/main/backup/backup-worker?nodeWorker', () => ({
      default: () => Object.assign(new EventEmitter(), {
        postMessage: (message: unknown) => { posted.push(message) },
        unref: () => undefined,
        terminate,
      }),
    }))
    const logger = await import('../../../src/main/logger')
    const log = vi.spyOn(logger, 'log')
    const { record, closeBackupStore } = await import('../../../src/main/backup/backup-store')
    record(path.join(root, 'config.json'), Buffer.from('{}'))
    expect(posted).toHaveLength(1)

    const started = Date.now()
    await closeBackupStore(50)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(terminate).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('warn', 'Backup history did not finish in time; its pending versions were dropped', { drainMs: 50 })
  })

  it('stops recording for the launch when the thread fails', async () => {
    let thread: EventEmitter | null = null
    const posted: unknown[] = []
    vi.doMock('../../../src/main/backup/backup-worker?nodeWorker', () => ({
      default: () => {
        thread = Object.assign(new EventEmitter(), {
          postMessage: (message: unknown) => { posted.push(message) },
          unref: () => undefined,
          terminate: async () => 1,
        })
        return thread
      },
    }))
    const { record } = await import('../../../src/main/backup/backup-store')
    record(path.join(root, 'config.json'), Buffer.from('{}'))
    thread!.emit('error', new Error('thread lost'))
    record(path.join(root, 'config.json'), Buffer.from('{"a":1}'))
    expect(posted).toHaveLength(1)
  })
})
