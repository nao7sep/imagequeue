import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addConcepts,
  addProbes,
  closeConceptStore,
  deleteConcept,
  deleteFacet,
  deleteProbe,
  listProbesWithStats,
  drawConcept,
  ensureFacet,
  listConceptRows,
  listFacetsWithStats,
  listProbeDisplays,
  markProbeExpanded,
  recordUse,
  unexpandedProbes,
} from '../../../src/main/concepts/concept-store'

// The concept ledger, tested against a real SQLite file under a throwaway
// IMAGEQUEUE_HOME. The draw rules ARE the dedup mechanism — no similarity
// scoring exists anywhere — so what these tests pin is the entire guarantee:
// never-used first, nothing twice within the window or session, and one draw
// per probe cluster while the window covers it.

const ENV_VAR = 'IMAGEQUEUE_HOME'

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
    const rows = listConceptRows(f.id)
    expect(rows[0].useCount).toBe(2)
    expect(rows[0].lastUsedAt).toBeTruthy()
    const stats = listFacetsWithStats()[0]
    expect(stats.conceptCount).toBe(1)
    expect(stats.unusedCount).toBe(0)
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
    expect(listProbesWithStats(f.id).map((p) => p.display)).toEqual(['forests'])
    expect(listConceptRows(f.id).map((r) => r.display)).toEqual(['clearing'])
    // The deleted cluster's use is gone too, so the window no longer counts it.
    expect(listFacetsWithStats()[0].conceptCount).toBe(1)
  })

  it('listProbesWithStats reports per-cluster counts', () => {
    const f = ensureFacet('place')
    addProbes(f.id, ['ports'])
    const [ports] = unexpandedProbes(f.id, 1)
    addConcepts(f.id, ports.id, ['dock', 'wharf'])
    const c = draw(f.id)!
    recordUse(c.id, 's1')
    const [stats] = listProbesWithStats(f.id)
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
    expect(listConceptRows(f.id)).toHaveLength(1)
    deleteFacet(f.id)
    expect(listFacetsWithStats()).toHaveLength(0)
    expect(listProbeDisplays(f.id, 50)).toHaveLength(0)
  })
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
