import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { closeRecords, openRecords } from '../../src/main/records'

const createdDirs: string[] = []

/** Opens the records in a disposable storage root and returns it. */
export function freshRecordsRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-records-'))
  createdDirs.push(dir)
  openRecords(dir)
  return dir
}

export function removeRecordsRoots(): void {
  closeRecords()
  for (const dir of createdDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
}

export function readRows(dir: string, table: 'log_records' | 'ai_calls' | 'cli_jobs'): Record<string, unknown>[] {
  const db = new DatabaseSync(path.join(dir, 'records.sqlite3'), { readOnly: true })
  try {
    return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Record<string, unknown>[]
  } finally {
    db.close()
  }
}

/** Each log record as one object: its columns with its fields spread in. */
export function readLog(dir: string): Record<string, unknown>[] {
  return readRows(dir, 'log_records').map(({ fields, ...columns }) => ({ ...columns, ...JSON.parse(fields as string) }))
}
