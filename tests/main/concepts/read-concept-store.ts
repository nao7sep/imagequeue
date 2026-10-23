import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ConceptProbeSummary, ConceptRow } from '../../../src/shared/types'

// Independent SQL inspection keeps paged production reads checked against the
// stored facts without exposing whole-facet readers in the worker API.
export function readConceptRows(root: string, facetId: number): ConceptRow[] {
  const db = new DatabaseSync(path.join(root, 'concepts.sqlite3'), { readOnly: true })
  try {
    return db.prepare(`
      SELECT c.id, c.probe_id AS probeId, c.display, p.display AS probe,
             c.use_count AS useCount, c.last_used_at AS lastUsedAt, c.created_at AS createdAt
      FROM concepts c JOIN probes p ON p.id = c.probe_id
      WHERE c.facet_id = ?
      ORDER BY c.use_count DESC, c.display ASC
    `).all(facetId) as unknown as ConceptRow[]
  } finally {
    db.close()
  }
}

export function readProbeStats(root: string, facetId: number): ConceptProbeSummary[] {
  const db = new DatabaseSync(path.join(root, 'concepts.sqlite3'), { readOnly: true })
  try {
    return db.prepare(`
      SELECT p.id, p.display, p.expanded,
        (SELECT COUNT(*) FROM concepts c WHERE c.probe_id = p.id) AS conceptCount,
        (SELECT COUNT(*) FROM concepts c WHERE c.probe_id = p.id AND c.use_count = 0) AS unusedCount
      FROM probes p WHERE p.facet_id = ? ORDER BY p.id
    `).all(facetId) as unknown as ConceptProbeSummary[]
  } finally {
    db.close()
  }
}
