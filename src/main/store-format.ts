import { DatabaseSync } from 'node:sqlite'

// Every file ImageQueue writes in a format it owns carries the file identity
// header (file-identity-conventions), and this module is the one place that
// builds and checks it (store-recovery-conventions).

/** The product every one of these formats belongs to. */
export const FILE_OWNER = 'imagequeue'

/** The program that serializes them: this package, at this release. */
export const FILE_WRITER = { name: 'imagequeue', version: __APP_VERSION__ } as const

export interface FileFormat {
  kind: string
  version: number
}

/** Each owned file's kind and the format version this build reads and writes. */
export const FILE_FORMATS = {
  /** config.json */
  config: { kind: 'config', version: 1 },
  /** elaborators.json */
  elaborators: { kind: 'elaborators', version: 1 },
  /** params.json */
  modelParams: { kind: 'modelParams', version: 1 },
  /** backend-params.json */
  backendParams: { kind: 'backendParams', version: 1 },
  /** api-keys.json */
  apiKeys: { kind: 'apiKeys', version: 1 },
  /** state.json (a cache) */
  uiState: { kind: 'state', version: 1 },
  /** dependencies.json (a cache) */
  dependencies: { kind: 'dependencies', version: 1 },
  /** bin/draw-things-cli.json (a cache) */
  cliSidecar: { kind: 'cliBinary', version: 1 },
  /** recommendations-times.json (a cache) */
  recommendationsTimes: { kind: 'recommendationsTimes', version: 1 },
  /** sessions/<session>/session.json */
  session: { kind: 'session', version: 1 },
  /** sessions/<session>/<image>.json, whose own keys are snake_case */
  imageSidecar: { kind: 'sidecar', version: 1 },
  /** records.sqlite3 */
  records: { kind: 'records', version: 1 },
  /** concepts.sqlite3 */
  concepts: { kind: 'concepts', version: 1 },
  /** backups.sqlite3 */
  backups: { kind: 'backups', version: 1 },
} as const satisfies Record<string, FileFormat>

/** A store written by a newer build (store-recovery-conventions). */
export class NewerFormatError extends Error {
  constructor(readonly path: string, readonly found: number, readonly supported: number) {
    super(`${path} has format version ${found}, newer than the ${supported} this build reads; it was left unchanged`)
    this.name = 'NewerFormatError'
  }
}

/** A SQLite store holding schema objects but no header of its own: unreadable (store-recovery-conventions). */
export class MissingHeaderError extends Error {
  constructor(readonly path: string) {
    super(`${path} has no ${FILE_OWNER} file header of its kind`)
    this.name = 'MissingHeaderError'
  }
}

/**
 * A store that could be neither read nor set aside: the operation that needed
 * it stops and the file stays exactly where it is (store-recovery-conventions).
 */
export class StoreLeftInPlaceError extends Error {
  constructor(readonly path: string, options: { cause: unknown }) {
    super(`${path} could not be used or set aside; it was left unchanged`, options)
    this.name = 'StoreLeftInPlaceError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks a parsed JSON file's header and returns its content without the
 * header. A missing or malformed `format`, or one naming another owner or kind,
 * throws a plain Error: the file is unreadable. `writer` is never read.
 */
export function checkHeader(map: Record<string, unknown>, expected: FileFormat, file: string): Record<string, unknown> {
  const { format, writer: _writer, ...content } = map
  if (!isObject(format) || typeof format.owner !== 'string' || typeof format.kind !== 'string'
    || typeof format.version !== 'number' || !Number.isSafeInteger(format.version)) {
    throw new Error('format header is missing or malformed')
  }
  if (format.owner !== FILE_OWNER || format.kind !== expected.kind) {
    throw new Error(`format header names ${format.owner} ${format.kind}, not ${FILE_OWNER} ${expected.kind}`)
  }
  if (format.version > expected.version) throw new NewerFormatError(file, format.version, expected.version)
  if (format.version !== expected.version) throw new Error(`format version ${format.version} is not one this build reads`)
  return content
}

/** The file as it is stored: its header first, then its own keys. */
export function withHeader<T extends object>(content: T, format: FileFormat): { format: object; writer: object } & T {
  return {
    format: { owner: FILE_OWNER, kind: format.kind, version: format.version },
    writer: { name: FILE_WRITER.name, version: FILE_WRITER.version },
    ...content,
  }
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

const FILE_HEADER_TABLE = 'CREATE TABLE IF NOT EXISTS file_header (key TEXT PRIMARY KEY, value TEXT NOT NULL)'

// The header's owner and kind as the database holds them, or null when it has
// no file_header table.
function storedIdentity(db: DatabaseSync): { owner: unknown; kind: unknown } | null {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'file_header'").get()
  if (!table) return null
  const rows = db.prepare("SELECT key, value FROM file_header WHERE key IN ('format.owner', 'format.kind')").all() as { key: string; value: string }[]
  const value = (key: string): unknown => rows.find((row) => row.key === key)?.value
  return { owner: value('format.owner'), kind: value('format.kind') }
}

/**
 * Opens a SQLite store and checks its header once, here: the single-instance
 * lock keeps every other writer out, so operations need no recheck.
 * `user_version` holds the format version and `file_header` the rest of the
 * header (file-identity-conventions). A version of 0 with no schema objects is
 * a fresh file, including one whose first creation was interrupted; one
 * holding objects, or a file whose `file_header` is missing or names another
 * owner or kind, is unreadable. Schema, header and version commit together, and
 * the writer rows are rewritten on every open. The store's own thread holds the
 * one connection to the file, so no lock wait is set.
 */
export function openSqliteStore(file: string, format: FileFormat, schema: string): DatabaseSync {
  const db = new DatabaseSync(file)
  try {
    const found = userVersion(db)
    if (found < 1) {
      const { objects } = db.prepare('SELECT count(*) AS objects FROM sqlite_master').get() as { objects: number }
      if (objects > 0) throw new MissingHeaderError(file)
    } else {
      const identity = storedIdentity(db)
      if (identity?.owner !== FILE_OWNER || identity.kind !== format.kind) throw new MissingHeaderError(file)
      if (found > format.version) throw new NewerFormatError(file, found, format.version)
    }
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(schema)
      db.exec(FILE_HEADER_TABLE)
      const put = db.prepare('INSERT OR REPLACE INTO file_header (key, value) VALUES (?, ?)')
      put.run('format.owner', FILE_OWNER)
      put.run('format.kind', format.kind)
      put.run('writer.name', FILE_WRITER.name)
      put.run('writer.version', FILE_WRITER.version)
      db.exec("DELETE FROM file_header WHERE key LIKE 'writer.caller.%'")
      db.exec(`PRAGMA user_version = ${format.version}`)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* Preserve initialization failure. */ }
      throw error
    }
    return db
  } catch (error) {
    try { db.close() } catch { /* Preserve initialization failure. */ }
    throw error
  }
}
