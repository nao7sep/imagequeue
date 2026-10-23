import type { Worker } from 'node:worker_threads'
import createReaderWorker from './records-reader-worker?nodeWorker'
import { flushRecords, recordsDatabasePath } from './records'
import type { RecordsRead, RecordsReadResults } from '../shared/records'

// History scans and selected-record reads have separate owners so a slow
// search cannot delay or fail an unrelated detail lookup. Each lane retains
// its worker through physical termination before admitting a replacement.

export const RECORDS_READ_TIMEOUT_MS = 10_000

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

function createReadLane() {
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

  function read<R extends RecordsRead>(read: R): Promise<RecordsReadResults[R['op']]> {
    return new Promise((resolve, reject) => {
      const id = nextId++
      // The bound includes writer startup/flush and any previous reader's exit,
      // so neither unavailable storage nor delayed termination extends the wait.
      const timer = setTimeout(() => {
        if (pending.has(id)) stopWorker(new Error('Reading the records timed out.'))
      }, RECORDS_READ_TIMEOUT_MS)
      pending.set(id, { resolve: resolve as (value: never) => void, reject, timer })
      void flushRecords().then(async () => {
        await stopping
        if (!pending.has(id)) return
        try { ensureWorker().postMessage({ id, read } satisfies RecordsReaderRequest) }
        catch (error) { stopWorker(error instanceof Error ? error : new Error(String(error))) }
      }, (error) => stopWorker(error instanceof Error ? error : new Error(String(error))))
    })
  }

  /** Ends the reader; the quit owner bounds its wait, while termination keeps its owner. */
  async function close(): Promise<void> {
    stopWorker(new Error('The records reader closed.'))
    await stopping
  }

  return { read, close }
}

const history = createReadLane()
const selected = createReadLane()

export function readRecords<R extends RecordsRead>(read: R): Promise<RecordsReadResults[R['op']]> {
  return (read.op === 'detail' || read.op === 'output' ? selected : history).read(read)
}

export async function closeRecordsReader(): Promise<void> {
  await Promise.all([history.close(), selected.close()])
}
