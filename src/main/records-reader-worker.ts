import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { runRecordsRead } from './records-query'
import type { RecordsReaderRequest, RecordsReaderResponse } from './records-reader'

// The Records window's reads, on their own thread and their own read-only
// connection, so a long query never holds up the main process. records.ts keeps
// the database in WAL mode, so these reads see every committed write.

const databasePath = (workerData as { databasePath: string }).databasePath
let db: DatabaseSync | null = null

parentPort?.once('close', () => {
  db?.close()
  db = null
})

parentPort?.on('message', ({ id, read }: RecordsReaderRequest) => {
  let response: RecordsReaderResponse
  try {
    db ??= new DatabaseSync(databasePath, { readOnly: true })
    // One read transaction, so a read's several queries see one snapshot while
    // the main process keeps writing on its own connection.
    db.exec('BEGIN')
    try {
      response = { id, ok: true, value: runRecordsRead(db, read) }
    } finally {
      db.exec('COMMIT')
    }
  } catch (error) {
    // A connection that failed is opened afresh for the next read.
    try {
      db?.close()
    } catch {
      // Already unusable; the next read reopens it.
    }
    db = null
    response = { id, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
  }
  parentPort?.postMessage(response)
})
