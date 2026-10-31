import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inProcessBackupThread } from '../../setup/backup-thread'
import { createQuitOwner } from '../../../src/main/quit-handler'
import { FILE_FORMATS } from '../../../src/main/store-format'
import { headerSql } from '../file-header'

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

  it('leaves a history of another kind untouched and says once that backups are off', async () => {
    const seeded = new DatabaseSync(storeFile)
    seeded.exec(`CREATE TABLE kept (value TEXT); ${headerSql(FILE_FORMATS.records)}`)
    seeded.close()
    const bytes = fs.readFileSync(storeFile)
    const appNotices = await import('../../../src/main/app-notices')
    const raised = vi.spyOn(appNotices, 'raiseAppNotice').mockImplementation(() => undefined)
    const { record, closeBackupStore } = await import('../../../src/main/backup/backup-store')
    record(path.join(root, 'config.json'), Buffer.from('{"v":1}'))
    record(path.join(root, 'config.json'), Buffer.from('{"v":2}'))
    await closeBackupStore()
    expect(raised.mock.calls).toEqual([[{ title: { key: 'notice.backupsOffTitle' }, message: { key: 'notice.backupsOffMessage', values: { path: storeFile } } }]])
    expect(fs.readFileSync(storeFile).equals(bytes)).toBe(true)
  })

  // A history that never answers stands for a stalled disk or a locked store.
  it('hands a save over without waiting and keeps close pending until physical worker exit', async () => {
    vi.useFakeTimers()
    const posted: unknown[] = []
    const terminate = vi.fn(async () => 1)
    const thread = Object.assign(new EventEmitter(), {
      postMessage: (message: unknown) => { posted.push(message) },
      unref: () => undefined,
      terminate,
    })
    vi.doMock('../../../src/main/backup/backup-worker?nodeWorker', () => ({
      default: () => thread,
    }))
    const { record, closeBackupStore } = await import('../../../src/main/backup/backup-store')
    record(path.join(root, 'config.json'), Buffer.from('{}'))
    expect(posted).toHaveLength(1)
    let settled = false
    const closing = closeBackupStore().then(() => { settled = true })
    try {
      await vi.advanceTimersByTimeAsync(2_000)
      expect(settled).toBe(false)
      expect(terminate).not.toHaveBeenCalled()
      expect(posted).toEqual([expect.objectContaining({ type: 'record' }), { type: 'close' }])
      const exit = vi.fn()
      const quit = createQuitOwner({
        confirm: () => true, declined: vi.fn(), begin: vi.fn(), cancel: vi.fn(), exit, onError: vi.fn(),
        save: async () => undefined, cleanup: closeBackupStore, question: async () => 'cancel',
        timeoutMs: 5_000, systemTimeoutMs: 1_500,
      })
      // The close draws on what remains of the exit deadline.
      quit.beforeQuit({ preventDefault: vi.fn() })
      await vi.advanceTimersByTimeAsync(4_999)
      expect(exit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(exit).toHaveBeenCalledOnce()
      expect(settled).toBe(false)
    } finally {
      thread.emit('exit', 0)
      await closing
      vi.useRealTimers()
    }
    expect(settled).toBe(true)
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
