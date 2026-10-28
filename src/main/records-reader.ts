import type { Worker } from 'node:worker_threads'
import createReaderWorker from './records-reader-worker?nodeWorker'
import { log } from './logger'
import { flushRecords, recordsDatabasePath, writeLogRecord } from './records'
import type { RecordsSearchWarning } from './records-query'
import type { RecordsRead, RecordsReadResults } from '../shared/records'

// The one owner of the Records window's reads. Reads are local storage work and
// get no deadline. A reader that errors or exits fails the reads waiting on it,
// and the next read starts a new one.

export interface RecordsReaderRequest {
  id: number
  read: RecordsRead
}

export type RecordsReaderResponse =
  | { id: number; ok: true; value: RecordsReadResults[RecordsRead['op']]; warning?: RecordsSearchWarning }
  | { id: number; ok: false; error: string }

interface PendingRead {
  resolve: (value: never) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, PendingRead>()

function failPending(reason: Error): void {
  for (const read of pending.values()) read.reject(reason)
  pending.clear()
}

function ensureWorker(): Worker {
  if (worker) return worker
  const databasePath = recordsDatabasePath()
  if (databasePath === null) throw new Error('The records database is not open.')
  const created = createReaderWorker({ workerData: { databasePath } })
  // Reads never keep the process alive; quitting ends them.
  created.unref()
  created.on('message', (response: RecordsReaderResponse) => {
    const read = pending.get(response.id)
    if (!read) return
    pending.delete(response.id)
    if (response.ok) {
      if (response.warning) writeLogRecord(new Date().toISOString(), 'warn', 'CLI output search was incomplete', { ...response.warning })
      read.resolve(response.value as never)
    }
    else read.reject(new Error(response.error))
  })
  const stopped = (reason: Error): void => {
    if (worker !== created) return
    worker = null
    failPending(reason)
  }
  created.on('error', (error) => stopped(error instanceof Error ? error : new Error(String(error))))
  created.on('exit', (code) => stopped(new Error(`The records reader exited with code ${code}.`)))
  worker = created
  return created
}

export function readRecords<R extends RecordsRead>(read: R): Promise<RecordsReadResults[R['op']]> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve: resolve as (value: never) => void, reject })
    const fail = (error: unknown): void => {
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    void flushRecords().then(() => {
      // A read the reader's stop or close already failed is not sent.
      if (!pending.has(id)) return
      try { ensureWorker().postMessage({ id, read } satisfies RecordsReaderRequest) }
      catch (error) { fail(error) }
    }, fail)
  })
}

/** Ends the reader and fails any read still waiting; the quit owner bounds this wait. */
export async function closeRecordsReader(): Promise<void> {
  const current = worker
  worker = null
  failPending(new Error('The records reader closed.'))
  await current?.terminate().catch((error) => log('warn', 'Records reader thread could not terminate', { error: String(error) }))
}
