import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { FORMAT_VERSIONS, MissingFormatError, NewerFormatError } from '../store-format'

// The backup history itself (data-backup-conventions): `backups.sqlite3` keeps,
// for each protected file, the last version saved in each launch. Only the
// backup worker calls these, one write at a time in the order the saves
// happened.
//
// SQLite binding: Node's built-in `node:sqlite`, which Electron's Node ships, so
// the store needs no native addon rebuilt per Electron release. `content` is a
// BLOB of the exact bytes written, never decoded text, so line endings, a BOM and
// non-UTF-8 bytes are kept as they were.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS backups (
  id             INTEGER PRIMARY KEY,
  session_id     TEXT,
  path           TEXT NOT NULL,
  content        BLOB NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  written_at_utc TEXT NOT NULL
);
`

// Version 1 had no session_id; version 2 keeps one row per file per launch.
// Rows recorded before launches were told apart keep a NULL session_id, which a
// unique index never matches, so they stay as earlier history.
const INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS backups_path_session ON backups (path, session_id);
CREATE INDEX IF NOT EXISTS idx_backups_path_id ON backups (path, id);
`

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined
}

/**
 * Opens the history and brings it to the current version. A fresh file is
 * created; an earlier one, marked or not, is adopted with its rows kept
 * ("Existing history is preserved"). A newer store, or a populated file that is
 * not a backup history, throws and is left as it is.
 */
export function openBackupHistory(file: string): DatabaseSync {
  const db = new DatabaseSync(file, { timeout: 1_000 })
  try {
    const found = userVersion(db)
    if (found > FORMAT_VERSIONS.backups) throw new NewerFormatError(file, found, FORMAT_VERSIONS.backups)
    if (found === 0) {
      const { objects } = db.prepare('SELECT count(*) AS objects FROM sqlite_master').get() as { objects: number }
      if (objects > 0 && !hasTable(db, 'backups')) throw new MissingFormatError(file)
    }
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(SCHEMA)
      const columns = db.prepare('PRAGMA table_info(backups)').all() as { name: string }[]
      if (!columns.some((column) => column.name === 'session_id')) db.exec('ALTER TABLE backups ADD COLUMN session_id TEXT')
      db.exec(INDEXES)
      db.exec(`PRAGMA user_version = ${FORMAT_VERSIONS.backups}`)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* Preserve the open failure. */ }
      throw error
    }
    return db
  } catch (error) {
    try { db.close() } catch { /* Preserve the open failure. */ }
    throw error
  }
}

/**
 * Records the bytes a save just wrote at `filePath`. The launch's first save of
 * a path adds its row, unless the bytes equal the latest version already kept;
 * later saves in the launch replace that row.
 */
export function recordVersion(db: DatabaseSync, sessionId: string, filePath: string, bytes: Uint8Array): void {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const latest = db
    .prepare('SELECT content_sha256 AS hash FROM backups WHERE path = ? ORDER BY id DESC LIMIT 1')
    .get(filePath) as { hash: string } | undefined
  if (latest?.hash === hash) return
  db.prepare(`
    INSERT INTO backups (session_id, path, content, content_sha256, byte_size, written_at_utc)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (path, session_id) DO UPDATE SET
      content = excluded.content,
      content_sha256 = excluded.content_sha256,
      byte_size = excluded.byte_size,
      written_at_utc = excluded.written_at_utc
  `).run(sessionId, filePath, bytes, hash, bytes.byteLength, new Date().toISOString())
}

export interface BackupWorkerData {
  file: string
  /** One id per launch; every row this launch records carries it. */
  sessionId: string
}

export type BackupWorkerMessage =
  | { type: 'record'; path: string; bytes: Uint8Array }
  | { type: 'close' }

export type BackupWorkerReport =
  | { type: 'open-failed'; file: string; error: string }
  | { type: 'record-failed'; path: string; error: string }

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/**
 * The backup thread's handling of each message, in arrival order. The store is
 * opened by the first record; one that cannot be opened disables recording for
 * the launch. Returns true once the store is closed.
 */
export function createBackupWriter(
  { file, sessionId }: BackupWorkerData,
  report: (value: BackupWorkerReport) => void,
): (message: BackupWorkerMessage) => boolean {
  let db: DatabaseSync | null = null
  let disabled = false
  return (message) => {
    if (message.type === 'close') {
      try { db?.close() } catch { /* The thread is ending; nothing is left to protect. */ }
      db = null
      return true
    }
    if (disabled) return false
    try {
      db ??= openBackupHistory(file)
    } catch (error) {
      disabled = true
      report({ type: 'open-failed', file, error: errorText(error) })
      return false
    }
    try {
      recordVersion(db, sessionId, message.path, message.bytes)
    } catch (error) {
      report({ type: 'record-failed', path: message.path, error: errorText(error) })
    }
    return false
  }
}
