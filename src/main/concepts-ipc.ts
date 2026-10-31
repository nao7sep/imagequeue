import { handle } from './ipc-boundary'
import {
  deleteConcept,
  deleteFacet,
  deleteProbe,
  listConceptRows,
  listFacetsWithStats,
  listProbesWithStats,
} from './concepts/concept-store'

function validId(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error('Invalid concept library id')
}
// IPC for the Concept Library modal: read the concept ledger's facets and
// rows, and delete a concept or a whole facet. Writes into the ledger itself
// (probes, concepts, uses) happen only inside a brainstorm run.
export function registerConceptsIpc(): void {
  handle('concepts:listFacets', () => listFacetsWithStats())
  handle('concepts:listProbes', (_event, facetId: number) => {
    validId(facetId)
    return listProbesWithStats(facetId)
  })
  handle('concepts:listConcepts', (_event, facetId: number) => {
    validId(facetId)
    return listConceptRows(facetId)
  })
  handle('concepts:deleteProbe', (_event, probeId: number) => {
    validId(probeId)
    return deleteProbe(probeId)
  })
  handle('concepts:deleteConcept', (_event, conceptId: number) => {
    validId(conceptId)
    return deleteConcept(conceptId)
  })
  handle('concepts:deleteFacet', (_event, facetId: number) => {
    validId(facetId)
    return deleteFacet(facetId)
  })
}
