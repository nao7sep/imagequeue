import { DatabaseSync } from 'node:sqlite'

// Every store's format version, and the one way each store reads and writes
// its marker (store-recovery-conventions).
export const FORMAT_VERSIONS = {
  /** config.json */
  config: 1,
  /** elaborators.json */
  elaborators: 1,
  /** params.json */
  modelParams: 1,
  /** api-keys.json */
  apiKeys: 1,
  /** state.json */
  uiState: 1,
  /** dependencies.json */
  dependencies: 1,
  /** bin/draw-things-cli.json */
  cliSidecar: 1,
  /** recommendations-times.json */
  recommendationsTimes: 1,
  /** sessions/<session>/session.json */
  session: 1,
  /** sessions/<session>/<image>.json, whose keys are snake_case */
  imageSidecar: 1,
  /** records.sqlite3 */
  records: 1,
  /** concepts.sqlite3 */
  concepts: 1,
  /** backups.sqlite3; 2 adds one row per file per launch */
  backups: 2,
} as const

export const FORMAT_VERSION_KEY = 'formatVersion'
export const SNAKE_FORMAT_VERSION_KEY = 'format_version'

/** A store written by a newer build (store-recovery-conventions). */
export class NewerFormatError extends Error {
  constructor(readonly path: string, readonly found: number, readonly supported: number) {
    super(`${path} has format version ${found}, newer than the ${supported} this build reads; it was left unchanged`)
    this.name = 'NewerFormatError'
  }
}

/** A SQLite store holding schema objects but no format version: unreadable (store-recovery-conventions). */
export class MissingFormatError extends Error {
  constructor(readonly path: string) {
    super(`${path} has no format version`)
    this.name = 'MissingFormatError'
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

/**
 * Checks a parsed JSON store's marker and returns the map without it. A missing
 * marker, or one that is not a positive integer, throws a plain Error: the
 * store is unreadable.
 */
export function checkFormat(
  map: Record<string, unknown>,
  supported: number,
  file: string,
  key: string = FORMAT_VERSION_KEY,
): Record<string, unknown> {
  const { [key]: found, ...rest } = map
  if (typeof found !== 'number' || !Number.isSafeInteger(found) || found < 1) {
    throw new Error(`${key} is missing or not a positive integer`)
  }
  if (found > supported) throw new NewerFormatError(file, found, supported)
  return rest
}

/** The map as it is stored: its format version first, then its own keys. */
export function markFormat<T extends object>(map: T, version: number, key: string = FORMAT_VERSION_KEY): { [key: string]: unknown } & T {
  return { [key]: version, ...map }
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

/**
 * Opens a SQLite store and checks its version once, here: the single-instance
 * lock keeps every other writer out, so operations need no recheck. A version
 * of 0 with no schema objects is a fresh file, including one whose first
 * creation was interrupted; a version of 0 holding objects has no marker and is
 * unreadable. Schema and marker commit together.
 */
export function openSqliteStore(file: string, supported: number, schema: string): DatabaseSync {
  const db = new DatabaseSync(file, { timeout: 5_000 })
  try {
    const found = userVersion(db)
    if (found > supported) throw new NewerFormatError(file, found, supported)
    if (found < 1) {
      const { objects } = db.prepare('SELECT count(*) AS objects FROM sqlite_master').get() as { objects: number }
      if (objects > 0) throw new MissingFormatError(file)
    }
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(schema)
      db.exec(`PRAGMA user_version = ${supported}`)
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
