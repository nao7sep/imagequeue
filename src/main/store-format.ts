import type { DatabaseSync } from 'node:sqlite'

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
  /** output/<session>/session.json */
  session: 1,
  /** output/<session>/<image>.json, whose keys are snake_case */
  imageSidecar: 1,
  /** manifest.json inside each backups/<stamp>.zip */
  backupManifest: 1,
  /** records.sqlite3 */
  records: 1,
  /** concepts.sqlite3 */
  concepts: 1,
  /** backups.sqlite3 */
  backups: 1,
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

/**
 * Checks an open SQLite store's version before anything else touches it, so a
 * store this build cannot use throws having had nothing written. A version of
 * 0 is a missing marker, unreadable, except on a database with nothing in it
 * yet, which is new and is stamped with this build's version.
 */
export function claimSqliteFormat(db: DatabaseSync, supported: number, file: string): void {
  const { user_version: found } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (found > supported) throw new NewerFormatError(file, found, supported)
  if (found !== 0) return
  const { objects } = db.prepare('SELECT count(*) AS objects FROM sqlite_master').get() as { objects: number }
  if (objects > 0) throw new Error(`${file} has no format version`)
  db.exec(`PRAGMA user_version = ${supported}`)
}
