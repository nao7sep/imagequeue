import { handle } from './ipc-boundary'
import {
  deleteConcept,
  deleteFacet,
  listConceptRows,
  listFacetsWithStats,
} from './concepts/concept-store'

// IPC for the Concept Library modal: read the concept ledger's facets and
// rows, and delete a concept or a whole facet. Writes into the ledger itself
// (probes, concepts, uses) happen only inside a brainstorm run.
export function registerConceptsIpc(): void {
  handle('concepts:listFacets', () => listFacetsWithStats())
  handle('concepts:listConcepts', (_event, facetId: number) => listConceptRows(facetId))
  handle('concepts:deleteConcept', (_event, conceptId: number) => {
    deleteConcept(conceptId)
  })
  handle('concepts:deleteFacet', (_event, facetId: number) => {
    deleteFacet(facetId)
  })
}
