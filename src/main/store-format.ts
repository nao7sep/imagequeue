import fs from 'node:fs'
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
  modelParams: { kind: 'model-params', version: 1 },
  /** backend-params.json */
  backendParams: { kind: 'backend-params', version: 1 },
  /** api-keys.json */
  apiKeys: { kind: 'api-keys', version: 1 },
  /** state.json (a cache) */
  uiState: { kind: 'state', version: 1 },
  /** dependencies.json (a cache) */
  dependencies: { kind: 'dependencies', version: 1 },
  /** bin/draw-things-cli.json (a cache) */
  cliSidecar: { kind: 'cli-binary', version: 1 },
  /** recommendations-times.json (a cache) */
  recommendationsTimes: { kind: 'recommendations-times', version: 1 },
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
 * A file that could not be read: the operation that needed it stops and the
 * file stays exactly as it is, never set aside or replaced
 * (store-recovery-conventions, A refused file is never changed).
 */
export class UnreadableFileError extends Error {
  constructor(readonly path: string, options: { cause: unknown }) {
    super(`${path} could not be read; it was left unchanged`, options)
    this.name = 'UnreadableFileError'
  }
}

/** One file a launch refused, and whether a newer version wrote it. */
export interface RefusedFile {
  path: string
  newer: boolean
}

/** Launch stopped on these files; nothing was written before stopping. */
export class LaunchStopError extends Error {
  constructor(readonly refused: RefusedFile[]) {
    super(`Launch stopped on ${refused.map((file) => `${file.path} (${file.newer ? 'newer' : 'unreadable'})`).join(', ')}`)
    this.name = 'LaunchStopError'
  }
}

/** The refusal a launch reports for `error`, or null when it is not a refused file. */
export function refusedFile(error: unknown): RefusedFile | null {
  if (error instanceof NewerFormatError) return { path: error.path, newer: true }
  if (error instanceof UnreadableFileError) return { path: error.path, newer: false }
  return null
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

/**
 * A JSON file's content after its header passes. Anything that does not parse,
 * is not an object or fails the header is an UnreadableFileError; a newer
 * version is a NewerFormatError.
 */
export function parseHeaderedJson(text: string, format: FileFormat, file: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
    if (!isObject(parsed)) throw new Error('the file is not a JSON object')
    return checkHeader(parsed, format, file)
  } catch (error) {
    if (error instanceof NewerFormatError) throw error
    throw new UnreadableFileError(file, { cause: error })
  }
}

/** Reads a JSON file of `format`: null when it is absent, its content when its header passes. */
export function readHeaderedJson(file: string, format: FileFormat): Record<string, unknown> | null {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new UnreadableFileError(file, { cause: error })
  }
  return parseHeaderedJson(text, format, file)
}

/**
 * A cache's header at launch: a newer file stops the launch, while an absent or
 * unreadable one is rebuilt, so it passes here (store-recovery-conventions).
 */
export function checkCacheAtLaunch(file: string, format: FileFormat): void {
  try { readHeaderedJson(file, format) } catch (error) {
    if (error instanceof NewerFormatError) throw error
  }
}

/** A cache's content, or null when it is absent or unreadable, so the caller rebuilds it. */
export async function readCache(file: string, format: FileFormat): Promise<Record<string, unknown> | null> {
  let text: string
  try { text = await fs.promises.readFile(file, 'utf8') } catch { return null }
  try { return parseHeaderedJson(text, format, file) } catch (error) {
    if (error instanceof NewerFormatError) throw error
    return null
  }
}

/**
 * Whether a cache may be written over: false when the file on disk now holds
 * a newer version, which stays as it is (store-recovery-conventions, A refused
 * file is never changed). An absent or unreadable cache may be replaced.
 */
export async function cacheWritable(file: string, format: FileFormat): Promise<boolean> {
  try { await readCache(file, format); return true } catch { return false }
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
