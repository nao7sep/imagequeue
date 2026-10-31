import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { FORMAT_VERSIONS, openSqliteStore } from '../store-format'

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
  session_id     TEXT NOT NULL,
  path           TEXT NOT NULL,
  content        BLOB NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  written_at_utc TEXT NOT NULL
);
`

const INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS backups_path_session ON backups (path, session_id);
CREATE INDEX IF NOT EXISTS idx_backups_path_id ON backups (path, id);
`

/** Opens the history, or initializes an empty file at the current format. */
export function openBackupHistory(file: string): DatabaseSync {
  return openSqliteStore(file, FORMAT_VERSIONS.backups, SCHEMA + INDEXES)
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
