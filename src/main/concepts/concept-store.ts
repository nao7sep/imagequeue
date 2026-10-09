import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getDataDir } from '../config'
import { cleanDisplay, normalizeKey } from './normalize'
import { openSqliteStore, FORMAT_VERSIONS, MissingFormatError, StoreLeftInPlaceError } from '../store-format'
import { log, serializeError } from '../logger'
import { utcStampForFilename } from '../../shared/utc-stamp'

// The concept ledger: every facet, probe (the narrow domain an ask mined), and
// concept value the text AI has ever produced, plus one row per time a value
// was woven into a generated prompt. Its own store per the persisted-store
// separation conventions — this is accumulated fact/cache data, not config and
// not session state — and unlike the best-effort backup store it is FUNCTIONAL:
// a failure here throws and fails the brainstorm run, because generating with
// broken bookkeeping would silently reintroduce the repetition the ledger
// exists to prevent. An unreadable ledger is set aside and replaced, and the
// user is told what was lost.
//
// SQLite binding: Node's built-in `node:sqlite`, same as backup-store.ts and
// for the same packaging reason (no native addon to rebuild per Electron bump).
// not recorded: concepts.sqlite3 is a binary SQLite store written through this
// layer, not a managed text save, so the write-through backup never sees it.

/**
 * How many draws back the reuse window reaches. A value used within the window
 * (or anywhere in the current session) is not drawable, and neither is any
 * value from the same probe cluster; outside it, reuse is deliberately fine —
 * the window models the span a user's memory of recent outputs realistically
 * covers, not a similarity judgement. At three facets a heavy overnight run of
 * ~300 prompts spends ~900 draws, so 1000 keeps one full night out of reach.
 */
export const CONCEPT_REUSE_WINDOW_DRAWS = 1000

const SCHEMA = `
CREATE TABLE IF NOT EXISTS facets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  display    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS probes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  facet_id   INTEGER NOT NULL,
  key        TEXT NOT NULL,
  display    TEXT NOT NULL,
  expanded   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (facet_id, key)
);
CREATE TABLE IF NOT EXISTS concepts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  facet_id       INTEGER NOT NULL,
  probe_id       INTEGER NOT NULL,
  key            TEXT NOT NULL,
  display        TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  use_count      INTEGER NOT NULL DEFAULT 0,
  last_used_draw INTEGER,
  last_used_at   TEXT,
  UNIQUE (facet_id, key)
);
CREATE TABLE IF NOT EXISTS uses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_concepts_facet ON concepts (facet_id, use_count);
CREATE INDEX IF NOT EXISTS idx_uses_session ON uses (session_id);
`

let db: DatabaseSync | null = null

function storeFile(): string {
  return path.join(getDataDir(), 'concepts.sqlite3')
}

// The ledger is app-recorded fact, so a file that is not a database, is
// damaged, or has no format version is set aside and a new, empty ledger
// starts (store-recovery conventions). A newer ledger,
// or a failure that moving the file would not fix, refuses the request and
// leaves the file where it is. Each set-aside path waits here for the window
// that made the request to name it.
const setAsidePaths: string[] = []

export function drainSetAsideConceptStorePaths(): string[] {
  return setAsidePaths.splice(0)
}

const SQLITE_CORRUPT = 11
const SQLITE_NOTADB = 26

function isUnreadableLedger(error: unknown): boolean {
  if (error instanceof MissingFormatError) return true
  const { code, errcode } = error as { code?: unknown; errcode?: unknown }
  return code === 'ERR_SQLITE_ERROR' && (errcode === SQLITE_CORRUPT || errcode === SQLITE_NOTADB)
}

function setAside(file: string, error: unknown): void {
  const movedTo = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}-${utcStampForFilename()}.invalid`)
  // Closing the only connection has already folded any write-ahead log into
  // the database file and removed it, so the file alone is the whole ledger.
  try {
    fs.renameSync(file, movedTo)
  } catch (renameError) {
    throw new StoreLeftInPlaceError(file, { cause: renameError })
  }
  setAsidePaths.push(movedTo)
  log('warn', 'Set aside an unreadable concept library; starting a new one', {
    from: file,
    to: movedTo,
    error: serializeError(error),
  })
}

function open(): DatabaseSync {
  if (db) return db
  const file = storeFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let opened: DatabaseSync
  try {
    opened = openSqliteStore(file, FORMAT_VERSIONS.concepts, SCHEMA)
  } catch (err) {
    if (!isUnreadableLedger(err)) throw err
    setAside(file, err)
    return open()
  }
  db = opened
  return db
}

/** Close the singleton so tests can re-open against a fresh root. */
export function closeConceptStore(): void {
  db?.close()
  db = null
}

export interface FacetRow {
  id: number
  display: string
}

export function ensureFacet(display: string): FacetRow {
  const d = open()
  const key = normalizeKey(display)
  if (!key) throw new Error('Facet name is empty after normalization.')
  const existing = d.prepare('SELECT id, display FROM facets WHERE key = ?').get(key) as unknown as FacetRow | undefined
  if (existing) return existing
  const cleaned = cleanDisplay(display)
  const res = d.prepare('INSERT INTO facets (key, display, created_at) VALUES (?, ?, ?)')
    .run(key, cleaned, new Date().toISOString())
  return { id: Number(res.lastInsertRowid), display: cleaned }
}

export function listFacetDisplays(): string[] {
  const rows = open().prepare('SELECT display FROM facets ORDER BY display').all() as unknown as { display: string }[]
  return rows.map((r) => r.display)
}

/** Insert probes, skipping any whose normalized key this facet already holds. */
export function addProbes(facetId: number, displays: readonly string[]): number {
  const d = open()
  const now = new Date().toISOString()
  const stmt = d.prepare('INSERT OR IGNORE INTO probes (facet_id, key, display, expanded, created_at) VALUES (?, ?, ?, 0, ?)')
  let added = 0
  d.exec('BEGIN IMMEDIATE')
  try {
    for (const display of displays) {
      const key = normalizeKey(display)
      if (!key) continue
      added += Number(stmt.run(facetId, key, cleanDisplay(display), now).changes)
    }
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
  return added
}

/** The most recent `limit` domain displays, oldest-first for prompt stability.
 *  The bound matters: this list is prepended to every domain-generation ask as
 *  the avoid-list, and the ledger accumulates for its whole life — unbounded,
 *  a months-old facet would ship thousands of domains (tens of KB) per call
 *  and eventually overflow the model's context. Recency is the right sample:
 *  the model's repeat-candidates are its recent favourites, and exact dedupe
 *  is enforced separately by the normalized-key UNIQUE constraint on insert. */
export function listProbeDisplays(facetId: number, limit: number): string[] {
  const rows = open().prepare(
    'SELECT display FROM (SELECT id, display FROM probes WHERE facet_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id'
  ).all(facetId, limit) as unknown as { display: string }[]
  return rows.map((r) => r.display)
}

export interface ProbeRow {
  id: number
  display: string
}

export function unexpandedProbes(facetId: number, limit: number): ProbeRow[] {
  return open()
    .prepare('SELECT id, display FROM probes WHERE facet_id = ? AND expanded = 0 ORDER BY id LIMIT ?')
    .all(facetId, limit) as unknown as ProbeRow[]
}

export function markProbeExpanded(probeId: number): void {
  open().prepare('UPDATE probes SET expanded = 1 WHERE id = ?').run(probeId)
}

/** Insert a probe's concepts, skipping keys this facet already holds. */
export function addConcepts(facetId: number, probeId: number, displays: readonly string[]): number {
  const d = open()
  const now = new Date().toISOString()
  const stmt = d.prepare('INSERT OR IGNORE INTO concepts (facet_id, probe_id, key, display, created_at) VALUES (?, ?, ?, ?, ?)')
  let added = 0
  d.exec('BEGIN IMMEDIATE')
  try {
    for (const display of displays) {
      const key = normalizeKey(display)
      if (!key) continue
      added += Number(stmt.run(facetId, probeId, key, cleanDisplay(display), now).changes)
    }
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
  return added
}

export interface DrawOptions {
  sessionId: string
  windowDraws: number
  /** When false, a draw that finds no never-used value returns null instead of
   *  falling back to a stale (outside-the-window) one — the caller mints new
   *  concepts first and reaches for stale only as the last resort. */
  allowStale: boolean
  /** Values and clusters already drawn by the current run but not yet recorded
   *  as uses (uses land only when a prompt actually comes back). */
  excludeConceptIds: readonly number[]
  excludeProbeIds: readonly number[]
}

export interface DrawnConcept {
  id: number
  probeId: number
  display: string
}

// Blocked clusters: any probe with a use inside the window or this session.
// One draw per cluster per window — siblings from one ask are the likeliest
// lookalikes, so a used value closes its whole sibling group, not just itself.
const BLOCKED_PROBES_SQL =
  'SELECT k.probe_id FROM uses u JOIN concepts k ON k.id = u.concept_id WHERE u.id > ? OR u.session_id = ?'

export function drawConcept(facetId: number, opts: DrawOptions): DrawnConcept | null {
  const d = open()
  const maxRow = d.prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM uses').get() as unknown as { maxId: number }
  const floor = maxRow.maxId - opts.windowDraws
  const exclConcepts = opts.excludeConceptIds.length > 0 ? [...opts.excludeConceptIds] : [-1]
  const exclProbes = opts.excludeProbeIds.length > 0 ? [...opts.excludeProbeIds] : [-1]
  const cIn = exclConcepts.map(() => '?').join(', ')
  const pIn = exclProbes.map(() => '?').join(', ')

  const fresh = d.prepare(`
    SELECT c.id, c.probe_id AS probeId, c.display FROM concepts c
    WHERE c.facet_id = ? AND c.use_count = 0
      AND c.id NOT IN (${cIn})
      AND c.probe_id NOT IN (${pIn})
      AND c.probe_id NOT IN (${BLOCKED_PROBES_SQL})
    ORDER BY RANDOM() LIMIT 1
  `).get(facetId, ...exclConcepts, ...exclProbes, floor, opts.sessionId) as unknown as DrawnConcept | undefined
  if (fresh) return fresh
  if (!opts.allowStale) return null

  // Stale fallback: reuse the value that has gone longest unused, provided it
  // (and its cluster) sit outside the window and outside this session.
  const stale = d.prepare(`
    SELECT c.id, c.probe_id AS probeId, c.display FROM concepts c
    WHERE c.facet_id = ? AND c.use_count > 0
      AND c.id NOT IN (${cIn})
      AND c.probe_id NOT IN (${pIn})
      AND c.id NOT IN (SELECT concept_id FROM uses WHERE id > ? OR session_id = ?)
      AND c.probe_id NOT IN (${BLOCKED_PROBES_SQL})
    ORDER BY c.last_used_draw ASC LIMIT 1
  `).get(
    facetId, ...exclConcepts, ...exclProbes,
    floor, opts.sessionId, floor, opts.sessionId
  ) as unknown as DrawnConcept | undefined
  return stale ?? null
}

/** Record that a value was woven into a prompt that actually came back. */
export function recordUse(conceptId: number, sessionId: string): void {
  const d = open()
  const now = new Date().toISOString()
  d.exec('BEGIN IMMEDIATE')
  try {
    const res = d.prepare('INSERT INTO uses (concept_id, session_id, created_at) VALUES (?, ?, ?)')
      .run(conceptId, sessionId, now)
    d.prepare('UPDATE concepts SET use_count = use_count + 1, last_used_draw = ?, last_used_at = ? WHERE id = ?')
      .run(Number(res.lastInsertRowid), now, conceptId)
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}

// ---- Concept Library (view/manage) -----------------------------------------

export interface ConceptFacetSummary {
  id: number
  display: string
  conceptCount: number
  unusedCount: number
  probeCount: number
  lastUsedAt: string | null
}

export function listFacetsWithStats(): ConceptFacetSummary[] {
  return open().prepare(`
    SELECT f.id, f.display,
      (SELECT COUNT(*) FROM concepts c WHERE c.facet_id = f.id) AS conceptCount,
      (SELECT COUNT(*) FROM concepts c WHERE c.facet_id = f.id AND c.use_count = 0) AS unusedCount,
      (SELECT COUNT(*) FROM probes p WHERE p.facet_id = f.id) AS probeCount,
      (SELECT MAX(c.last_used_at) FROM concepts c WHERE c.facet_id = f.id) AS lastUsedAt
    FROM facets f ORDER BY f.display
  `).all() as unknown as ConceptFacetSummary[]
}

export interface ConceptListRow {
  id: number
  probeId: number
  display: string
  probe: string
  useCount: number
  lastUsedAt: string | null
  createdAt: string
}

export function listConceptRows(facetId: number): ConceptListRow[] {
  return open().prepare(`
    SELECT c.id, c.probe_id AS probeId, c.display, p.display AS probe,
           c.use_count AS useCount, c.last_used_at AS lastUsedAt, c.created_at AS createdAt
    FROM concepts c JOIN probes p ON p.id = c.probe_id
    WHERE c.facet_id = ?
    ORDER BY c.use_count DESC, c.display ASC
  `).all(facetId) as unknown as ConceptListRow[]
}

export interface ConceptProbeSummary {
  id: number
  display: string
  expanded: number
  conceptCount: number
  unusedCount: number
}

/** Domains of a facet with their cluster statistics, creation order. */
export function listProbesWithStats(facetId: number): ConceptProbeSummary[] {
  return open().prepare(`
    SELECT p.id, p.display, p.expanded,
      (SELECT COUNT(*) FROM concepts c WHERE c.probe_id = p.id) AS conceptCount,
      (SELECT COUNT(*) FROM concepts c WHERE c.probe_id = p.id AND c.use_count = 0) AS unusedCount
    FROM probes p WHERE p.facet_id = ? ORDER BY p.id
  `).all(facetId) as unknown as ConceptProbeSummary[]
}

/** Delete one domain with its whole cluster: concepts and their use history.
 *  Like concept deletion this drops rows, it does not blocklist — a future
 *  probe-generation ask may re-propose a similar domain. */
export function deleteProbe(probeId: number): void {
  const d = open()
  d.exec('BEGIN IMMEDIATE')
  try {
    d.prepare('DELETE FROM uses WHERE concept_id IN (SELECT id FROM concepts WHERE probe_id = ?)').run(probeId)
    d.prepare('DELETE FROM concepts WHERE probe_id = ?').run(probeId)
    d.prepare('DELETE FROM probes WHERE id = ?').run(probeId)
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}

/** Delete one concept and its use history. The value may be re-discovered by a
 *  future planning ask — deletion is "drop this row", not a blocklist. */
export function deleteConcept(conceptId: number): void {
  const d = open()
  d.exec('BEGIN IMMEDIATE')
  try {
    d.prepare('DELETE FROM uses WHERE concept_id = ?').run(conceptId)
    d.prepare('DELETE FROM concepts WHERE id = ?').run(conceptId)
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}

/** Delete a facet with everything under it: probes, concepts, uses. */
export function deleteFacet(facetId: number): void {
  const d = open()
  d.exec('BEGIN IMMEDIATE')
  try {
    d.prepare('DELETE FROM uses WHERE concept_id IN (SELECT id FROM concepts WHERE facet_id = ?)').run(facetId)
    d.prepare('DELETE FROM concepts WHERE facet_id = ?').run(facetId)
    d.prepare('DELETE FROM probes WHERE facet_id = ?').run(facetId)
    d.prepare('DELETE FROM facets WHERE id = ?').run(facetId)
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}
