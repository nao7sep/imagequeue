import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useConfirm } from '../context/ConfirmContext'
import { useListbox } from '../hooks/useListbox'
import { formatUiDateTime } from '../utils/formatDateTime'
import type { ConceptFacetSummary, ConceptProbeSummary, ConceptRow } from '../../../shared/types'
import './ConceptLibraryModal.css'

interface Props {
  onClose: () => void
}

type UseFilter = 'all' | 'unused' | 'used'

// Browses and manages the concept ledger (concepts.sqlite3) at its real
// hierarchy: facet → domain (the narrow ask a cluster was mined from) →
// concept. Deletion exists at every level and always cascades downward;
// deleting drops rows, it does not blocklist — a future planning ask may
// re-discover anything removed here. The ledger is written only by brainstorm
// runs, so this modal never creates or edits rows.
export function ConceptLibraryModal({ onClose }: Props): React.JSX.Element {
  const confirm = useConfirm()
  const [facets, setFacets] = useState<ConceptFacetSummary[]>([])
  const [facetsLoading, setFacetsLoading] = useState(true)
  const [facetsError, setFacetsError] = useState('')
  const [selectedFacetId, setSelectedFacetId] = useState<number | null>(null)
  const [probes, setProbes] = useState<ConceptProbeSummary[]>([])
  const [rows, setRows] = useState<ConceptRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [filter, setFilter] = useState('')
  const [useFilter, setUseFilter] = useState<UseFilter>('all')
  const [message, setMessage] = useState('')

  const refreshFacets = useCallback(async (): Promise<void> => {
    setFacetsLoading(true)
    setFacetsError('')
    try {
      const list = await window.electronAPI.listConceptFacets()
      setFacets(list)
      setSelectedFacetId((prev) =>
        prev !== null && list.some((f) => f.id === prev) ? prev : list[0]?.id ?? null
      )
    } catch (error) {
      setFacetsError(error instanceof Error ? error.message : String(error))
    } finally {
      setFacetsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshFacets()
  }, [refreshFacets])

  useEffect(() => {
    if (selectedFacetId === null) {
      setProbes([])
      setRows([])
      setDetailLoading(false)
      setDetailError('')
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError('')
    setProbes([])
    setRows([])
    Promise.all([
      window.electronAPI.listConceptProbes(selectedFacetId),
      window.electronAPI.listConceptRows(selectedFacetId),
    ])
      .then(([probeList, conceptList]) => {
        if (cancelled) return
        setProbes(probeList)
        setRows(conceptList)
      })
      .catch((error) => {
        if (!cancelled) setDetailError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedFacetId, facets])

  const { listboxProps, getOptionProps } = useListbox<HTMLDivElement>({
    ids: facets.map((f) => String(f.id)),
    selectedId: selectedFacetId !== null ? String(selectedFacetId) : null,
    onSelect: (id) => setSelectedFacetId(Number(id)),
    activation: 'follows-focus',
  })

  const selectedFacet = facets.find((f) => f.id === selectedFacetId) ?? null

  // Domain sections, filtered: the search needle matches a concept's value or
  // its domain text; the use filter narrows rows; a section with no surviving
  // rows disappears (unless the domain itself matched the search).
  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const byProbe = new Map<number, ConceptRow[]>()
    for (const row of rows) {
      if (useFilter === 'unused' && row.useCount > 0) continue
      if (useFilter === 'used' && row.useCount === 0) continue
      const list = byProbe.get(row.probeId) ?? []
      list.push(row)
      byProbe.set(row.probeId, list)
    }
    return probes
      .map((probe) => {
        const domainMatches = needle.length > 0 && probe.display.toLowerCase().includes(needle)
        let sectionRows = byProbe.get(probe.id) ?? []
        if (needle && !domainMatches) {
          sectionRows = sectionRows.filter((r) => r.display.toLowerCase().includes(needle))
        }
        return { probe, rows: sectionRows, domainMatches }
      })
      .filter((section) =>
        needle
          ? section.domainMatches || section.rows.length > 0
          : useFilter === 'all' || section.rows.length > 0
      )
  }, [probes, rows, filter, useFilter])

  const withRefresh = useCallback(
    async (action: () => Promise<void>): Promise<void> => {
      setMessage('')
      try {
        await action()
        await refreshFacets()
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [refreshFacets]
  )

  const handleDeleteConcept = useCallback(async (row: ConceptRow): Promise<void> => {
    const ok = await confirm({
      title: 'Delete Concept',
      message: `Delete "${row.display}"? A future generation run may re-discover it — this drops the row and its use history, it does not block the concept.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (ok) await withRefresh(() => window.electronAPI.deleteConceptRow(row.id))
  }, [confirm, withRefresh])

  const handleDeleteProbe = useCallback(async (probe: ConceptProbeSummary): Promise<void> => {
    const ok = await confirm({
      title: 'Delete Domain',
      message: `Delete the domain "${probe.display}" and its ${probe.conceptCount} concept${probe.conceptCount === 1 ? '' : 's'}? Use history under it is removed too.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (ok) await withRefresh(() => window.electronAPI.deleteConceptProbe(probe.id))
  }, [confirm, withRefresh])

  const handleDeleteFacet = useCallback(async (): Promise<void> => {
    if (!selectedFacet) return
    const ok = await confirm({
      title: 'Delete Facet',
      message: `Delete the "${selectedFacet.display}" facet entirely — ${selectedFacet.probeCount} domain${selectedFacet.probeCount === 1 ? '' : 's'}, ${selectedFacet.conceptCount} concept${selectedFacet.conceptCount === 1 ? '' : 's'}, and all use history?`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (ok) await withRefresh(() => window.electronAPI.deleteConceptFacet(selectedFacet.id))
  }, [confirm, selectedFacet, withRefresh])

  const totals = useMemo(() => {
    if (facets.length === 0) return null
    return {
      facets: facets.length,
      domains: facets.reduce((n, f) => n + f.probeCount, 0),
      concepts: facets.reduce((n, f) => n + f.conceptCount, 0),
      unused: facets.reduce((n, f) => n + f.unusedCount, 0),
    }
  }, [facets])

  return (
    <Modal
      title="Concept Library"
      className="concept-library-modal-box"
      onClose={onClose}
      footer={
        <>
          {totals && (
            <span className="concept-library-totals modal-footer-lead">
              {totals.facets} facets · {totals.domains} domains · {totals.concepts} concepts ({totals.unused} unused)
            </span>
          )}
          <button className="modal-btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="concept-library-body">
        {message && <div className="concept-library-message">{message}</div>}
        {facetsError && facets.length > 0 && (
          <div className="concept-library-message">Couldn’t refresh concepts: {facetsError}</div>
        )}
        <div className={`concept-library-columns${facets.length === 0 ? ' concept-library-columns-empty' : ''}`}>
            <div className="concept-library-facets" aria-label="Facets" aria-busy={facetsLoading} {...listboxProps}>
              {facets.length === 0 && (
                <div className="concept-library-empty" role="presentation">
                  {facetsLoading
                    ? 'Loading concepts…'
                    : facetsError
                      ? `Couldn’t load concepts: ${facetsError}`
                      : 'No concepts yet. They accumulate as Advanced Prompting elaborates prompts; every value the AI finds is recorded here with how often and how recently it was used.'}
                </div>
              )}
              {facets.map((facet) => (
                <div
                  key={facet.id}
                  className={`concept-library-facet${facet.id === selectedFacetId ? ' selected' : ''}`}
                  {...getOptionProps(String(facet.id))}
                >
                  <div className="concept-library-facet-name">{facet.display}</div>
                  <div className="concept-library-facet-meta">
                    {facet.conceptCount} concepts · {facet.unusedCount} unused
                  </div>
                  <div className="concept-library-facet-meta">
                    {facet.probeCount} domains
                    {facet.lastUsedAt ? ` · last used ${formatUiDateTime(facet.lastUsedAt)}` : ''}
                  </div>
                </div>
              ))}
            </div>

            <div className="concept-library-detail">
              {selectedFacet && (
                <>
                  <div className="concept-library-toolbar">
                    <input
                      type="search"
                      placeholder="Filter concepts and domains…"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      aria-label="Filter concepts and domains"
                    />
                    <select
                      value={useFilter}
                      onChange={(e) => setUseFilter(e.target.value as UseFilter)}
                      aria-label="Show"
                    >
                      <option value="all">All concepts</option>
                      <option value="unused">Unused only</option>
                      <option value="used">Used only</option>
                    </select>
                    <button
                      className="modal-btn modal-btn-danger"
                      onClick={() => void handleDeleteFacet()}
                    >
                      Delete Facet
                    </button>
                  </div>

                  {detailLoading ? (
                    <div className="concept-library-empty">Loading facet…</div>
                  ) : detailError ? (
                    <div className="concept-library-empty">Couldn’t load this facet: {detailError}</div>
                  ) : sections.length === 0 ? (
                    <div className="concept-library-empty">
                      {rows.length === 0
                        ? 'No concepts in this facet yet.'
                        : 'Nothing matches the current filter.'}
                    </div>
                  ) : (
                    <div className="concept-library-sections">
                      {sections.map(({ probe, rows: sectionRows }) => (
                        <section key={probe.id} className="concept-library-section">
                          <div className="concept-library-section-header">
                            <div className="concept-library-section-title" title={probe.display}>
                              {probe.display}
                            </div>
                            <div className="concept-library-section-meta">
                              {probe.expanded
                                ? `${probe.conceptCount} concepts · ${probe.unusedCount} unused`
                                : 'not yet expanded'}
                            </div>
                            <button
                              tabIndex={-1}
                              className="modal-btn modal-btn-danger"
                              onClick={() => void handleDeleteProbe(probe)}
                            >
                              Delete
                            </button>
                          </div>
                          {sectionRows.length > 0 && (
                            <div className="concept-library-rows">
                              {sectionRows.map((row) => (
                                /* The chip shows what gets consulted — the value
                                   and how spent it is; WHEN it was last drawn is
                                   trivia, so it lives in the tooltip with the
                                   added date. */
                                <div
                                  key={row.id}
                                  className="concept-library-row"
                                  title={row.useCount === 0
                                    ? `never used · added ${formatUiDateTime(row.createdAt)}`
                                    : `used ${row.useCount}× · last ${formatUiDateTime(row.lastUsedAt ?? row.createdAt)} · added ${formatUiDateTime(row.createdAt)}`}
                                >
                                  <div className="concept-library-row-name">
                                    {row.display}
                                  </div>
                                  <div className="concept-library-row-stats">
                                    {row.useCount === 0 ? 'unused' : `${row.useCount}×`}
                                  </div>
                                  {/* Pointer-only affordances (tabIndex -1): the facet
                                      rail is the keyboard surface; this pane is a
                                      read/manage table. */}
                                  <button
                                    tabIndex={-1}
                                    className="modal-btn modal-btn-danger"
                                    onClick={() => void handleDeleteConcept(row)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
      </div>
    </Modal>
  )
}
