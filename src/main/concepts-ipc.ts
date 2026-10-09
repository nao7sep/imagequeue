import type { IpcMainInvokeEvent } from 'electron'
import { handle } from './ipc-boundary'
import { conceptLibraryResetPresentation } from './failure-presentation'
import {
  deleteConcept,
  drainSetAsideConceptStorePaths,
  deleteFacet,
  deleteProbe,
  listConceptRows,
  listFacetsWithStats,
  listProbesWithStats,
} from './concepts/concept-store'

// IPC for the Concept Library modal: read the concept ledger's facets and
// rows, and delete a concept or a whole facet. Writes into the ledger itself
// (probes, concepts, uses) happen only inside a brainstorm run.
export function registerConceptsIpc(): void {
  // The first request to open the ledger may set aside an unreadable one; the
  // window that made it names the preserved copy.
  const withLedgerRecovery = async <T>(event: IpcMainInvokeEvent, operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation()
    } finally {
      for (const movedTo of drainSetAsideConceptStorePaths()) {
        event.sender.send('app:notice', conceptLibraryResetPresentation(movedTo))
      }
    }
  }

  handle('concepts:listFacets', (event) => withLedgerRecovery(event, listFacetsWithStats))
  handle('concepts:listConcepts', (event, facetId: number) => withLedgerRecovery(event, () => listConceptRows(facetId)))
  handle('concepts:listProbes', (event, facetId: number) => withLedgerRecovery(event, () => listProbesWithStats(facetId)))
  handle('concepts:deleteProbe', (event, probeId: number) => {
    return withLedgerRecovery(event, () => deleteProbe(probeId))
  })
  handle('concepts:deleteConcept', (event, conceptId: number) => {
    return withLedgerRecovery(event, () => deleteConcept(conceptId))
  })
  handle('concepts:deleteFacet', (event, facetId: number) => {
    return withLedgerRecovery(event, () => deleteFacet(facetId))
  })
}
