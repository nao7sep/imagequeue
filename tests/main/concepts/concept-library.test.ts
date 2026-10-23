import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initializeConceptStore, closeConceptStore, ensureFacet, addProbes, addConcepts,
  listProbesWithStats, listConceptRows, recordUses, deleteConcept,
  queryConceptLibrary, readConceptLibraryPage, locateConceptLibraryItem, searchConceptLibraryPrefix,
} from '../../../src/main/concepts/concept-database'
import { CONCEPT_LIBRARY_PAGE_SIZE, type ConceptLibraryQuery } from '../../../src/shared/concept-library'

describe('paged concept library with real SQLite', () => {
  let root: string
  let query: ConceptLibraryQuery
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-library-'))
    initializeConceptStore(root, () => {})
    query = { facetId: ensureFacet('places').id, filter: '', useFilter: 'all' }
  })
  afterEach(() => { closeConceptStore(); fs.rmSync(root, { recursive: true, force: true }) })
  function domain(display: string, labels: string[] = []): number {
    addProbes(query.facetId, [display])
    const id = listProbesWithStats(query.facetId).find((p) => p.display === display)!.id
    addConcepts(query.facetId, id, labels)
    return id
  }

  it('pages every concept in stable use/display/id order while transferring compact domain counts', () => {
    const first = domain('ports', Array.from({ length: 4097 }, (_, i) => `dock ${String(4097 - i).padStart(5, '0')}`))
    const second = domain('mountains', ['summit', 'ridge'])
    const used = listConceptRows(query.facetId).filter((_, i) => i % 7 === 0).map((r) => r.id)
    recordUses('uses', used, 'session')
    const index = queryConceptLibrary(query)
    expect(index.groups).toEqual([{ probeId: first, count: 4097 }, { probeId: second, count: 2 }])
    expect(index.totalConceptCount).toBe(4099)
    for (const group of index.groups) {
      const rows: number[] = []
      for (let offset = 0; offset < group.count; offset += CONCEPT_LIBRARY_PAGE_SIZE) {
        const result = readConceptLibraryPage(query, index.revision, group.probeId, offset)
        expect(result.stale).toBe(false)
        if (result.stale) throw new Error('unexpected stale page')
        expect(result.rows.length).toBeLessThanOrEqual(CONCEPT_LIBRARY_PAGE_SIZE)
        rows.push(...result.rows.map((r) => r.id))
      }
      expect(rows).toEqual(listConceptRows(query.facetId).filter((r) => r.probeId === group.probeId).map((r) => r.id))
      expect(new Set(rows).size).toBe(group.count)
    }
  })

  it('keeps empty domains only under the established text/use-filter rules and treats wildcards literally', () => {
    const empty = domain('Empty ÉTANG')
    const full = domain('ports', ['ÉCOLE', '100% proof', 'under_score', 'ordinary'])
    const usedId = listConceptRows(query.facetId).find((r) => r.display === 'ordinary')!.id
    recordUses('used', [usedId], 's')
    const groups = (filter: string, useFilter: ConceptLibraryQuery['useFilter'] = 'all') => queryConceptLibrary({ ...query, filter, useFilter }).groups
    expect(groups('')).toEqual([{ probeId: empty, count: 0 }, { probeId: full, count: 4 }])
    expect(groups('', 'unused')).toEqual([{ probeId: full, count: 3 }])
    expect(groups('', 'used')).toEqual([{ probeId: full, count: 1 }])
    expect(groups('étang', 'used')).toEqual([{ probeId: empty, count: 0 }])
    expect(groups('ports', 'unused')).toEqual([{ probeId: full, count: 3 }])
    expect(groups('  école  ')).toEqual([{ probeId: full, count: 1 }])
    expect(groups('%')).toEqual([{ probeId: full, count: 1 }])
    expect(groups('_')).toEqual([{ probeId: full, count: 1 }])
    expect(queryConceptLibrary({ ...query, filter: 'missing' })).toMatchObject({ groups: [], totalConceptCount: 4 })
  })

  it('invalidates reads after use/delete/reopen and locates surviving identities in refreshed order', () => {
    const probeId = domain('ports', ['alpha', 'bravo', 'charlie'])
    const [alpha, bravo] = listConceptRows(query.facetId)
    const before = queryConceptLibrary(query)
    recordUses('used', [bravo.id], 's')
    expect(readConceptLibraryPage(query, before.revision, probeId, 0)).toEqual({ stale: true })
    expect(locateConceptLibraryItem(query, before.revision, { kind: 'concept', id: alpha.id })).toEqual({ stale: true })
    expect(searchConceptLibraryPrefix(query, before.revision, 'a', null)).toEqual({ stale: true })
    const used = queryConceptLibrary(query)
    expect(locateConceptLibraryItem(query, used.revision, { kind: 'concept', id: alpha.id })).toEqual({ stale: false, location: { probeId, offset: 1 } })
    expect(locateConceptLibraryItem(query, used.revision, { kind: 'probe', id: probeId })).toEqual({ stale: false, location: { probeId, offset: -1 } })
    deleteConcept(bravo.id)
    expect(readConceptLibraryPage(query, used.revision, probeId, 0)).toEqual({ stale: true })
    const deleted = queryConceptLibrary(query)
    expect(locateConceptLibraryItem(query, deleted.revision, { kind: 'concept', id: bravo.id })).toEqual({ stale: false, location: null })
    expect(locateConceptLibraryItem(query, deleted.revision, { kind: 'concept', id: alpha.id })).toEqual({ stale: false, location: { probeId, offset: 0 } })
    closeConceptStore()
    expect(readConceptLibraryPage(query, deleted.revision, probeId, 0)).toEqual({ stale: true })
  })

  it('finds prefixes beyond a loaded page, across domains, and wraps including the current item last', () => {
    const first = domain('Needle domain', [...Array.from({ length: 70 }, (_, i) => `hay ${i}`), 'needle one'])
    const second = domain('other', ['needle two'])
    const index = queryConceptLibrary(query)
    const search = (after: { probeId: number; offset: number } | null) => searchConceptLibraryPrefix(query, index.revision, 'NEEDLE', after)
    expect(search(null)).toEqual({ stale: false, location: { probeId: first, offset: -1 } })
    expect(search({ probeId: first, offset: -1 })).toEqual({ stale: false, location: { probeId: first, offset: 70 } })
    expect(search({ probeId: first, offset: 70 })).toEqual({ stale: false, location: { probeId: second, offset: 0 } })
    expect(search({ probeId: second, offset: 0 })).toEqual({ stale: false, location: { probeId: first, offset: -1 } })
    expect(searchConceptLibraryPrefix(query, index.revision, 'needle two', { probeId: second, offset: 0 })).toEqual({ stale: false, location: { probeId: second, offset: 0 } })
    const filtered = { ...query, filter: 'two' }
    const filteredIndex = queryConceptLibrary(filtered)
    expect(searchConceptLibraryPrefix(filtered, filteredIndex.revision, 'needle', null)).toEqual({ stale: false, location: { probeId: second, offset: 0 } })
  })

  it('adds a covering page-order index to existing stores and avoids a temporary page sort', () => {
    const probeId = domain('ports', ['dock', 'wharf'])
    closeConceptStore()
    const file = path.join(root, 'concepts.sqlite3')
    const old = new DatabaseSync(file)
    old.exec('DROP INDEX idx_concepts_library_order')
    old.close()
    queryConceptLibrary(query)
    const inspect = new DatabaseSync(file, { readOnly: true })
    try {
      expect(inspect.prepare("PRAGMA index_info('idx_concepts_library_order')").all().map((r) => r.name)).toEqual(['probe_id', 'use_count', 'display', 'id'])
      const capture = vi.spyOn(DatabaseSync.prototype, 'prepare')
      const index = queryConceptLibrary(query)
      readConceptLibraryPage(query, index.revision, probeId, 0)
      const statement = capture.mock.calls.map(([sql]) => sql).find((sql) => sql.includes('LIMIT ?5 OFFSET ?6'))!
      capture.mockRestore()
      inspect.function('js_lower', { deterministic: true }, (value) => String(value).toLowerCase())
      const plan = inspect.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(query.facetId, '', 'all', probeId, CONCEPT_LIBRARY_PAGE_SIZE, 0)
      expect(plan.some((r) => String(r.detail).includes('INDEX idx_concepts_library_order'))).toBe(true)
      expect(plan.some((r) => String(r.detail).includes('TEMP B-TREE'))).toBe(false)
    } finally { inspect.close() }
  })
})
