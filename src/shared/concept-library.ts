import type { ConceptProbeSummary, ConceptRow } from './types'

/** Transfer batch size; the ledger itself has no history limit. */
export const CONCEPT_LIBRARY_PAGE_SIZE = 32
export interface ConceptLibraryQuery {
  facetId: number
  filter: string
  useFilter: 'all' | 'unused' | 'used'
}
export interface ConceptLibraryIndex {
  revision: string
  groups: Array<{ probeId: number; count: number }>
  totalConceptCount: number
}
export interface ConceptLibraryLocation { probeId: number; offset: number }
export type ConceptLibraryItem = { kind: 'probe' | 'concept'; id: number }
export type ConceptLibraryLocationResult = { stale: true } | { stale: false; location: ConceptLibraryLocation | null }
export type ConceptLibraryPage = { stale: true } | { stale: false; probe: ConceptProbeSummary; rows: ConceptRow[] }
