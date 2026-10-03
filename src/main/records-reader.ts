import type { Worker } from 'node:worker_threads'
import createReaderWorker from './records-reader-worker?nodeWorker'
import { recordsDatabasePath } from './records'
import { waitForAllSettledWithin } from './utils/bounded-wait'
import type { RecordsRead, RecordsReadResults } from '../shared/records'

// The one owner of the Records window's reads (PLAYBOOK, Own the work in flight;
// Bound every external wait): each read runs on a worker thread, and one that
// does not answer in time ends that worker, so a stalled read is stopped rather
// than left holding the thread. The next read starts a fresh worker.

export const RECORDS_READ_TIMEOUT_MS = 10_000
const CLOSE_TIMEOUT_MS = 2_000

export interface RecordsReaderRequest {
  id: number
  read: RecordsRead
}

export type RecordsReaderResponse =
  | { id: number; ok: true; value: RecordsReadResults[RecordsRead['op']] }
  | { id: number; ok: false; error: string }

interface PendingRead {
  resolve: (value: never) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let stopping: Promise<unknown> = Promise.resolve()
let nextId = 1
const pending = new Map<number, PendingRead>()

function stopWorker(reason: Error): void {
  const current = worker
  worker = null
  for (const read of pending.values()) {
    clearTimeout(read.timer)
    read.reject(reason)
  }
  pending.clear()
  if (current) stopping = current.terminate().catch(() => undefined)
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
    clearTimeout(read.timer)
    if (response.ok) read.resolve(response.value as never)
    else read.reject(new Error(response.error))
  })
  created.on('error', (error) => {
    if (worker === created) stopWorker(error instanceof Error ? error : new Error(String(error)))
  })
  created.on('exit', (code) => {
    if (worker === created) stopWorker(new Error(`The records reader exited with code ${code}.`))
  })
  worker = created
  return created
}

export function readRecords<R extends RecordsRead>(read: R): Promise<RecordsReadResults[R['op']]> {
  return new Promise((resolve, reject) => {
    let current: Worker
    try {
      current = ensureWorker()
    } catch (error) {
      reject(error)
      return
    }
    const id = nextId++
    const timer = setTimeout(() => {
      if (pending.has(id)) stopWorker(new Error('Reading the records timed out.'))
    }, RECORDS_READ_TIMEOUT_MS)
    pending.set(id, { resolve: resolve as (value: never) => void, reject, timer })
    try {
      current.postMessage({ id, read } satisfies RecordsReaderRequest)
    } catch (error) {
      stopWorker(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/** Ends the reader on quit, within a bound; any read still waiting fails. */
export async function closeRecordsReader(): Promise<void> {
  stopWorker(new Error('The records reader closed.'))
  await waitForAllSettledWithin([stopping], CLOSE_TIMEOUT_MS)
}
