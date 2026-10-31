import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readConceptRows, readProbeStats } from './read-concept-store'
import {
  initializeConceptStore,
  addConcepts,
  addProbes,
  closeConceptStore,
  deleteConcept,
  deleteFacet,
  deleteProbe,
  drainSetAsideConceptStorePaths,
  drawConcept,
  ensureFacet,
  listFacetsWithStats,
  listProbeDisplays,
  markProbeExpanded,
  recordUses,
  unexpandedProbes,
} from '../../../src/main/concepts/concept-database'
import { FILE_FORMATS, NewerFormatError, StoreLeftInPlaceError } from '../../../src/main/store-format'
import { headerSql } from '../file-header'

// The concept ledger, tested against a real SQLite file under a throwaway
// IMAGEQUEUE_DATA_DIR. The draw rules ARE the dedup mechanism — no similarity
// scoring exists anywhere — so what these tests pin is the entire guarantee:
// never-used first, nothing twice within the window or session, and one draw
// per probe cluster while the window covers it.

const ENV_VAR = 'IMAGEQUEUE_DATA_DIR'

// A window wide enough that every use in a test stays inside it.
const WIDE = 1_000_000

const draw = (facetId: number, over: Partial<Parameters<typeof drawConcept>[1]> = {}) =>
  drawConcept(facetId, {
    sessionId: 's1',
    windowDraws: WIDE,
    allowStale: true,
    excludeConceptIds: [],
    excludeProbeIds: [],
    ...over,
  })

describe('concept store', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-concepts-'))
    process.env[ENV_VAR] = tmpRoot
    initializeConceptStore(tmpRoot, () => {})
  })

  afterEach(() => {
    closeConceptStore()
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('ensureFacet dedups by normalized key and keeps the first display', () => {
    const a = ensureFacet('Places')
    const b = ensureFacet('places')
    const c = ensureFacet('ＰＬＡＣＥＳ')
    expect(b.id).toBe(a.id)
    expect(c.id).toBe(a.id)
    expect(listFacetsWithStats()).toHaveLength(1)
  })
  it('adds the domain statistics index to existing stores without changing counts', () => {
    const facet = ensureFacet('places')
    addProbes(facet.id, ['ports'])
    const [probe] = unexpandedProbes(facet.id, 1)
    addConcepts(facet.id, probe.id, ['dock', 'wharf'])
    recordUse(draw(facet.id)!.id, 'earlier')
    const expected = readProbeStats(tmpRoot, facet.id)
    closeConceptStore()
    const file = path.join(tmpRoot, 'concepts.sqlite3')
    const previous = new DatabaseSync(file)
    previous.exec('DROP INDEX IF EXISTS idx_concepts_probe')
    previous.close()

    listFacetsWithStats()
    expect(readProbeStats(tmpRoot, facet.id)).toEqual(expected)
    const reopened = new DatabaseSync(file, { readOnly: true })
    try {
      expect(reopened.prepare("PRAGMA index_info('idx_concepts_probe')").all().map((row) => row.name)).toEqual(['probe_id', 'use_count'])
      const plan = reopened.prepare(`EXPLAIN QUERY PLAN
        SELECT p.id,
          (SELECT COUNT(*) FROM concepts c WHERE c.probe_id = p.id),
          (SELECT COUNT(*) FROM concepts c WHERE c.probe_id = p.id AND c.use_count = 0)
        FROM probes p WHERE p.facet_id = ? ORDER BY p.id`).all(facet.id)
      const searches = plan.map((row) => String(row.detail)).filter((detail) => detail.startsWith('SEARCH c'))
      expect(searches).toHaveLength(2)
      expect(searches.every((detail) => detail.includes('idx_concepts_probe'))).toBe(true)
    } finally { reopened.close() }
  })

  it('addConcepts dedups by key within a facet but not across facets', () => {
    const places = ensureFacet('place')
    const jobs = ensureFacet('occupation')
    addProbes(places.id, ['ports'])
    addProbes(jobs.id, ['sea trades'])
    const [portProbe] = unexpandedProbes(places.id, 1)
    const [seaProbe] = unexpandedProbes(jobs.id, 1)
    expect(addConcepts(places.id, portProbe.id, ['Dock', 'dock.', 'cannery'])).toBe(2)
    expect(addConcepts(jobs.id, seaProbe.id, ['dock'])).toBe(1)
  })

  it('rolls back the whole probe batch when one insert fails', () => {
    const facet = ensureFacet('place')
    closeConceptStore()
    const triggerDb = new DatabaseSync(path.join(tmpRoot, 'concepts.sqlite3'))
    triggerDb.exec(`
      CREATE TRIGGER reject_probe BEFORE INSERT ON probes
      WHEN NEW.key = 'rejected'
      BEGIN SELECT RAISE(ABORT, 'rejected probe'); END;
    `)
    triggerDb.close()

    expect(() => addProbes(facet.id, ['harbor', 'rejected'])).toThrow('rejected probe')
    expect(listProbeDisplays(facet.id, 10)).toEqual([])
  })

  it('rolls back the whole concept batch when one insert fails', () => {
    const facet = ensureFacet('place')
    addProbes(facet.id, ['ports'])
    const [probe] = unexpandedProbes(facet.id, 1)
    closeConceptStore()
    const triggerDb = new DatabaseSync(path.join(tmpRoot, 'concepts.sqlite3'))
    triggerDb.exec(`
      CREATE TRIGGER reject_concept BEFORE INSERT ON concepts
      WHEN NEW.key = 'rejected'
      BEGIN SELECT RAISE(ABORT, 'rejected concept'); END;
    `)
    triggerDb.close()

    expect(() => addConcepts(facet.id, probe.id, ['harbor', 'rejected'])).toThrow('rejected concept')
    expect(readConceptRows(tmpRoot, facet.id)).toEqual([])
  })

  it('prefers a never-used value over a stale one', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['a', 'b'])
    const [pa, pb] = unexpandedProbes(f.id, 2)
    addConcepts(f.id, pa.id, ['harbor'])
    addConcepts(f.id, pb.id, ['forest'])
    const first = draw(f.id)
    expect(first).not.toBeNull()
    recordUse(first!.id, 'old-session')
    // Window 0 makes the used value stale-eligible; the never-used one must still win.
    const next = draw(f.id, { sessionId: 's2', windowDraws: 0 })
    expect(next!.id).not.toBe(first!.id)
  })

  it('never yields a value used within the window, in any session', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['a'])
    const [pa] = unexpandedProbes(f.id, 1)
    addConcepts(f.id, pa.id, ['harbor'])
    const c = draw(f.id)!
    recordUse(c.id, 's1')
    expect(draw(f.id, { sessionId: 's2', windowDraws: WIDE })).toBeNull()
  })

  it('never yields a value used in the current session, however old the use', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['a'])
    const [pa] = unexpandedProbes(f.id, 1)
    addConcepts(f.id, pa.id, ['harbor'])
    const c = draw(f.id)!
    recordUse(c.id, 's1')
    // Window 0: the use is outside any window, so only the session rule can block.
    expect(draw(f.id, { sessionId: 's1', windowDraws: 0 })).toBeNull()
    expect(draw(f.id, { sessionId: 's2', windowDraws: 0 })).not.toBeNull()
  })

  it('closes the whole cluster once one sibling is used within the window', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['ports', 'forests'])
    const [ports, forests] = unexpandedProbes(f.id, 2)
    addConcepts(f.id, ports.id, ['dock', 'cannery', 'wharf'])
    addConcepts(f.id, forests.id, ['clearing'])
    const first = draw(f.id, { excludeProbeIds: [forests.id] })!
    expect(first.probeId).toBe(ports.id)
    recordUse(first.id, 's1')
    // dock's siblings (cannery, wharf) are unused but their cluster is closed;
    // only the other cluster may serve.
    const second = draw(f.id, { sessionId: 's2' })
    expect(second!.probeId).toBe(forests.id)
    recordUse(second!.id, 's2')
    expect(draw(f.id, { sessionId: 's3' })).toBeNull()
  })

  it('honors the in-run exclude lists for values drawn but not yet recorded', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['a', 'b'])
    const [pa, pb] = unexpandedProbes(f.id, 2)
    addConcepts(f.id, pa.id, ['harbor', 'jetty'])
    addConcepts(f.id, pb.id, ['forest'])
    const first = draw(f.id)!
    // Excluding the drawn value AND its cluster forces the other cluster.
    const second = draw(f.id, { excludeConceptIds: [first.id], excludeProbeIds: [first.probeId] })
    expect(second!.probeId).not.toBe(first.probeId)
  })

  it('returns null instead of a stale value when allowStale is false', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['a'])
    const [pa] = unexpandedProbes(f.id, 1)
    addConcepts(f.id, pa.id, ['harbor'])
    const c = draw(f.id)!
    recordUse(c.id, 'old-session')
    expect(draw(f.id, { sessionId: 's2', windowDraws: 0, allowStale: false })).toBeNull()
    expect(draw(f.id, { sessionId: 's2', windowDraws: 0, allowStale: true })).not.toBeNull()
  })

  it('serves the longest-unused value first on the stale path', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['a', 'b'])
    const [pa, pb] = unexpandedProbes(f.id, 2)
    addConcepts(f.id, pa.id, ['harbor'])
    addConcepts(f.id, pb.id, ['forest'])
    const first = draw(f.id, { excludeProbeIds: [pb.id] })!
    recordUse(first.id, 'old-1')
    const second = draw(f.id, { sessionId: 'old-2', windowDraws: 0 })!
    recordUse(second.id, 'old-2')
    // Both stale now; the one used first (longest unused) comes back first.
    const revived = draw(f.id, { sessionId: 's-new', windowDraws: 0 })
    expect(revived!.id).toBe(first.id)
  })

  it('recordUse updates the statistics the library shows', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['a'])
    const [pa] = unexpandedProbes(f.id, 1)
    addConcepts(f.id, pa.id, ['harbor'])
    const c = draw(f.id)!
    recordUse(c.id, 's1')
    recordUse(c.id, 's1')
    const rows = readConceptRows(tmpRoot, f.id)
    expect(rows[0].useCount).toBe(2)
    expect(rows[0].lastUsedAt).toBeTruthy()
    const stats = listFacetsWithStats()[0]
    expect(stats.conceptCount).toBe(1)
    expect(stats.unusedCount).toBe(0)
  })

  it('records one ordered batch', () => {
    const facet = ensureFacet('place')
    addProbes(facet.id, ['ports'])
    const [probe] = unexpandedProbes(facet.id, 1)
    addConcepts(facet.id, probe.id, ['dock', 'wharf'])
    const ids = readConceptRows(tmpRoot, facet.id).map((row) => row.id).reverse()
    recordUses(ids, 'session-a')
    expect(readConceptRows(tmpRoot, facet.id).map((row) => row.useCount)).toEqual([1, 1])
    closeConceptStore()
    const database = new DatabaseSync(path.join(tmpRoot, 'concepts.sqlite3'), { readOnly: true })
    try {
      expect(database.prepare('SELECT concept_id, session_id FROM uses ORDER BY id').all()).toEqual(
        ids.map((id) => ({ concept_id: id, session_id: 'session-a' })),
      )
    } finally { database.close() }
  })

  it('rolls back all counters and uses when one insert fails', () => {
    const facet = ensureFacet('place')
    addProbes(facet.id, ['ports'])
    const [probe] = unexpandedProbes(facet.id, 1)
    addConcepts(facet.id, probe.id, ['dock', 'wharf'])
    const before = readConceptRows(tmpRoot, facet.id)
    const ids = before.map((row) => row.id)
    closeConceptStore()
    const file = path.join(tmpRoot, 'concepts.sqlite3')
    const database = new DatabaseSync(file)
    try {
      database.exec(`CREATE TRIGGER reject_use_batch BEFORE INSERT ON uses
        WHEN NEW.concept_id = ${ids[1]}
        BEGIN SELECT RAISE(ABORT, 'injected batch failure'); END;`)
    } finally { database.close() }
    expect(() => recordUses(ids, 'session-a')).toThrow('injected batch failure')
    expect(readConceptRows(tmpRoot, facet.id)).toEqual(before)
    const inspect = new DatabaseSync(file)
    try {
      expect(inspect.prepare('SELECT COUNT(*) AS count FROM uses').get()?.count).toBe(0)
      inspect.exec('DROP TRIGGER reject_use_batch')
    } finally { inspect.close() }
    recordUses(ids, 'session-a')
    expect(readConceptRows(tmpRoot, facet.id).map((row) => row.useCount)).toEqual([1, 1])
  })

  it('marks probes expanded so they are not re-expanded', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['a', 'b'])
    const [pa] = unexpandedProbes(f.id, 1)
    markProbeExpanded(pa.id)
    expect(unexpandedProbes(f.id, 10).map((p) => p.id)).not.toContain(pa.id)
    expect(listProbeDisplays(f.id, 50)).toHaveLength(2)
  })

  it('deleteProbe removes its whole cluster and nothing beside it', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['ports', 'forests'])
    const [ports, forests] = unexpandedProbes(f.id, 2)
    addConcepts(f.id, ports.id, ['dock', 'wharf'])
    addConcepts(f.id, forests.id, ['clearing'])
    const c = draw(f.id, { excludeProbeIds: [forests.id] })!
    recordUse(c.id, 's1')
    deleteProbe(ports.id)
    expect(readProbeStats(tmpRoot, f.id).map((p) => p.display)).toEqual(['forests'])
    expect(readConceptRows(tmpRoot, f.id).map((r) => r.display)).toEqual(['clearing'])
    // The deleted cluster's use is gone too, so the window no longer counts it.
    expect(listFacetsWithStats()[0].conceptCount).toBe(1)
  })

  it('records per-cluster counts', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['ports'])
    const [ports] = unexpandedProbes(f.id, 1)
    addConcepts(f.id, ports.id, ['dock', 'wharf'])
    const c = draw(f.id)!
    recordUse(c.id, 's1')
    const [stats] = readProbeStats(tmpRoot, f.id)
    expect(stats.conceptCount).toBe(2)
    expect(stats.unusedCount).toBe(1)
  })

  it('deleteConcept drops the row and its uses; deleteFacet cascades', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['a'])
    const [pa] = unexpandedProbes(f.id, 1)
    addConcepts(f.id, pa.id, ['harbor', 'forest'])
    const c = draw(f.id)!
    recordUse(c.id, 's1')
    deleteConcept(c.id)
    expect(readConceptRows(tmpRoot, f.id)).toHaveLength(1)
    deleteFacet(f.id)
    expect(listFacetsWithStats()).toHaveLength(0)
    expect(listProbeDisplays(f.id, 50)).toHaveLength(0)
  })
  it.each(['concept', 'probe', 'facet'] as const)('deleting a %s removes its use rows and preserves unrelated uses', (scope) => {
    const facet = ensureFacet('target')
    const other = ensureFacet('unrelated')
    addProbes(facet.id, ['first', 'second'])
    addProbes(other.id, ['other'])
    const probes = unexpandedProbes(facet.id, 2)
    const unrelatedProbe = unexpandedProbes(other.id, 1)[0]
    addConcepts(facet.id, probes[0].id, ['a', 'b'])
    addConcepts(facet.id, probes[1].id, ['c'])
    addConcepts(other.id, unrelatedProbe.id, ['d'])
    const targetRows = readConceptRows(tmpRoot, facet.id)
    const otherRows = readConceptRows(tmpRoot, other.id)
    for (const row of [...targetRows, ...otherRows]) recordUse(row.id, 's1')
    const removed = scope === 'facet' ? targetRows.map(row => row.id)
      : scope === 'probe' ? targetRows.filter(row => row.probeId === probes[0].id).map(row => row.id)
      : [targetRows[0].id]
    if (scope === 'concept') deleteConcept(targetRows[0].id)
    else if (scope === 'probe') deleteProbe(probes[0].id)
    else deleteFacet(facet.id)
    const database = new DatabaseSync(path.join(tmpRoot, 'concepts.sqlite3'), { readOnly: true })
    try {
      const actual = database.prepare('SELECT concept_id FROM uses ORDER BY concept_id').all().map(row => row.concept_id)
      expect(actual).toEqual([...targetRows, ...otherRows].map(row => row.id).filter(id => !removed.includes(id)).sort((a, b) => a - b))
    } finally { database.close() }
  })

  describe('listProbeDisplays bound', () => {
    // The list is every generation ask's avoid-list, and the ledger accumulates
    // for life: unbounded, a months-old facet ships thousands of domains per
    // call and eventually overflows the model's context. Recency is the sample
    // that matters — the model's repeat candidates are its recent favourites.
    it('returns only the most recent `limit` domains, oldest-first', () => {
      const f = ensureFacet('bounded')
      addProbes(f.id, ['one', 'two', 'three', 'four', 'five'])
      expect(listProbeDisplays(f.id, 3)).toEqual(['three', 'four', 'five'])
      expect(listProbeDisplays(f.id, 10)).toEqual(['one', 'two', 'three', 'four', 'five'])
    })
  })
})

describe('concept store file header', () => {
  let tmpRoot: string
  let storeFile: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-concepts-format-'))
    process.env[ENV_VAR] = tmpRoot
    initializeConceptStore(tmpRoot, () => {})
    storeFile = path.join(tmpRoot, 'concepts.sqlite3')
  })

  afterEach(() => {
    closeConceptStore()
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  function userVersion(): number {
    const db = new DatabaseSync(storeFile, { readOnly: true })
    try {
      return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    } finally {
      db.close()
    }
  }

  const setAside = () => fs.readdirSync(tmpRoot).filter((name) => /^concepts-\d{8}-\d{6}-utc\.invalid/.test(name)).sort()

  it('sets aside a populated ledger with no file header, names it once, and starts a new one', () => {
    ensureFacet('place')
    closeConceptStore()
    const unversioned = new DatabaseSync(storeFile)
    unversioned.exec('PRAGMA journal_mode = DELETE; PRAGMA user_version = 0')
    unversioned.close()
    const bytes = fs.readFileSync(storeFile)

    expect(listFacetsWithStats()).toEqual([])
    const [copy] = setAside()
    expect(fs.readFileSync(path.join(tmpRoot, copy)).equals(bytes), 'the old ledger is preserved').toBe(true)
    expect(drainSetAsideConceptStorePaths()).toEqual([path.join(tmpRoot, copy)])
    expect(drainSetAsideConceptStorePaths()).toEqual([])
    ensureFacet('time')
    expect(listFacetsWithStats().map((facet) => facet.display)).toEqual(['time'])
    expect(userVersion()).toBe(FILE_FORMATS.concepts.version)
  })

  it('sets aside a file that is not a database and starts a new ledger', () => {
    const bytes = Buffer.from('not a database'.repeat(100))
    fs.writeFileSync(storeFile, bytes)
    expect(ensureFacet('place').display).toBe('place')
    const [copy] = setAside()
    expect(fs.readFileSync(path.join(tmpRoot, copy)).equals(bytes)).toBe(true)
    expect(drainSetAsideConceptStorePaths()).toEqual([path.join(tmpRoot, copy)])
  })

  it('refuses the request and leaves the ledger in place when it cannot be set aside', () => {
    fs.writeFileSync(storeFile, 'not a database'.repeat(100))
    const bytes = fs.readFileSync(storeFile)
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('simulated permission failure'), { code: 'EACCES' })
    })
    expect(() => listFacetsWithStats()).toThrow(StoreLeftInPlaceError)
    rename.mockRestore()
    expect(fs.readFileSync(storeFile).equals(bytes)).toBe(true)
    expect(setAside()).toEqual([])
    expect(drainSetAsideConceptStorePaths()).toEqual([])
  })

  it('writes its version and reads the ledger back on the next open', () => {
    ensureFacet('place')
    closeConceptStore()
    expect(userVersion()).toBe(FILE_FORMATS.concepts.version)
    expect(listFacetsWithStats().map((facet) => facet.display)).toEqual(['place'])
  })

  it('refuses every request on a ledger from a newer version and leaves its bytes as they were', () => {
    const seeded = new DatabaseSync(storeFile)
    seeded.exec(`CREATE TABLE kept (value TEXT); ${headerSql(FILE_FORMATS.concepts, FILE_FORMATS.concepts.version + 1)}`)
    seeded.close()
    const bytes = fs.readFileSync(storeFile)

    expect(() => listFacetsWithStats()).toThrow(NewerFormatError)
    expect(() => ensureFacet('place')).toThrow(NewerFormatError)
    expect(fs.readFileSync(storeFile).equals(bytes)).toBe(true)
  })
})

function recordUse(conceptId: number, sessionId: string): void {
  recordUses([conceptId], sessionId)
}
