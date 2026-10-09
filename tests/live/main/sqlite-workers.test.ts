import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'

// Needs the built app's real worker entries and a disposable SQLite database.
// No provider, network, credentials, or user data. Run after npm run build.
function start(entry: string, dataDir: string): Worker {
  const built = path.resolve('out/main')
  const file = readdirSync(built).find((name) => name.startsWith(`${entry}-`) && name.endsWith('.js'))
  if (!file) throw new Error(`Build the app before checking ${entry}.`)
  return new Worker(path.join(built, file), { workerData: { dataDir, launch: new Date().toISOString() } })
}
function response(worker: Worker, predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const receive = (message: Record<string, unknown>): void => {
      if (!predicate(message)) return
      worker.off('message', receive)
      worker.off('error', reject)
      resolve(message)
    }
    worker.on('message', receive)
    worker.once('error', reject)
  })
}

describe('built SQLite workers', () => {
  it('keeps the caller responsive during a locked records write and drains that write before exit', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'imagequeue-records-thread-'))
    const worker = start('records-writer-worker', root)
    let other: DatabaseSync | undefined
    try {
      await response(worker, (message) => message.type === 'opened')
      other = new DatabaseSync(path.join(root, 'records.sqlite3'))
      other.exec('BEGIN IMMEDIATE')
      let completed = false
      const stored = response(worker, (message) => message.type === 'written').then(() => { completed = true })
      worker.postMessage({ type: 'write', recordId: 1, table: 'log_records', row: {
        time: new Date().toISOString(), launch: 'launch', session_id: null, task_id: null, request_id: null,
        level: 'info', message: 'after lock', fields: '{}',
      } })
      // This timer could not run while a synchronous main-process insert waited.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(completed).toBe(false)
      other.exec('COMMIT')
      const exited = once(worker, 'exit')
      worker.postMessage({ type: 'close' })
      await stored
      await exited
      expect(other.prepare('SELECT message FROM log_records').get()).toMatchObject({ message: 'after lock' })
    } finally {
      other?.close()
      await worker.terminate()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('serializes concept mutations behind a lock without blocking the caller', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'imagequeue-concepts-thread-'))
    const worker = start('concept-worker', root)
    let other: DatabaseSync | undefined
    try {
      const initial = response(worker, (message) => message.id === 1)
      worker.postMessage({ id: 1, op: 'ensureFacet', args: ['first'] })
      expect(await initial).not.toHaveProperty('error')
      other = new DatabaseSync(path.join(root, 'concepts.sqlite3'))
      other.exec('BEGIN IMMEDIATE')
      let completed = false
      const mutation = response(worker, (message) => message.id === 2).then((value) => { completed = true; return value })
      worker.postMessage({ id: 2, op: 'ensureFacet', args: ['second'] })
      const listing = response(worker, (message) => message.id === 3)
      worker.postMessage({ id: 3, op: 'listFacetDisplays', args: [] })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(completed).toBe(false)
      other.exec('COMMIT')
      expect(await mutation).not.toHaveProperty('error')
      expect((await listing).value).toEqual(['first', 'second'])
      const exited = once(worker, 'exit')
      worker.postMessage({ id: 4, op: 'closeConceptStore', args: [] })
      await exited
    } finally {
      other?.close()
      await worker.terminate()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
