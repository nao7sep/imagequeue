import type { IpcMainInvokeEvent } from 'electron'
import { handle } from './ipc-boundary'
import { conceptLibraryResetPresentation } from './failure-presentation'
import {
  deleteConcept,
  drainSetAsideConceptStorePaths,
  deleteFacet,
  deleteProbe,
  listFacetsWithStats,
  queryConceptLibrary,
  readConceptLibraryPage,
  locateConceptLibraryItem,
  searchConceptLibraryPrefix,
} from './concepts/concept-store'

import type { ConceptLibraryQuery, ConceptLibraryItem, ConceptLibraryLocation } from '../shared/concept-library'

function validId(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error('Invalid concept library id')
}
function validQuery(value: unknown): asserts value is ConceptLibraryQuery {
  if (!value || typeof value !== 'object') throw new Error('Invalid concept library query')
  const query = value as ConceptLibraryQuery
  validId(query.facetId)
  if (typeof query.filter !== 'string' || !['all', 'unused', 'used'].includes(query.useFilter)) throw new Error('Invalid concept library query')
}
function validRevision(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid concept library revision')
}
function validOffset(value: unknown, minimum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error('Invalid concept library offset')
}

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
  handle('concepts:queryConceptLibrary', (event, query: ConceptLibraryQuery) => {
    validQuery(query)
    return withLedgerRecovery(event, () => queryConceptLibrary(query))
  })
  handle('concepts:readConceptLibraryPage', (event, query: ConceptLibraryQuery, revision: string, probeId: number, offset: number) => {
    validQuery(query); validRevision(revision); validId(probeId); validOffset(offset, 0)
    return withLedgerRecovery(event, () => readConceptLibraryPage(query, revision, probeId, offset))
  })
  handle('concepts:locateConceptLibraryItem', (event, query: ConceptLibraryQuery, revision: string, item: ConceptLibraryItem) => {
    validQuery(query); validRevision(revision)
    if (!item || (item.kind !== 'probe' && item.kind !== 'concept')) throw new Error('Invalid concept library item')
    validId(item.id)
    return withLedgerRecovery(event, () => locateConceptLibraryItem(query, revision, item))
  })
  handle('concepts:searchConceptLibraryPrefix', (event, query: ConceptLibraryQuery, revision: string, prefix: string, after: ConceptLibraryLocation | null) => {
    validQuery(query); validRevision(revision)
    if (typeof prefix !== 'string') throw new Error('Invalid concept library prefix')
    if (after !== null) {
      if (!after || typeof after !== 'object') throw new Error('Invalid concept library location')
      validId(after.probeId); validOffset(after.offset, -1)
    }
    return withLedgerRecovery(event, () => searchConceptLibraryPrefix(query, revision, prefix, after))
  })
  handle('concepts:deleteProbe', (event, probeId: number) => {
    validId(probeId)
    return withLedgerRecovery(event, () => deleteProbe(probeId))
  })
  handle('concepts:deleteConcept', (event, conceptId: number) => {
    validId(conceptId)
    return withLedgerRecovery(event, () => deleteConcept(conceptId))
  })
  handle('concepts:deleteFacet', (event, facetId: number) => {
    validId(facetId)
    return withLedgerRecovery(event, () => deleteFacet(facetId))
  })
}
