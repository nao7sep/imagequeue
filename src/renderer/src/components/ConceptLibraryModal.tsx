import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useConfirm } from '../context/ConfirmContext'
import { useListbox } from '../hooks/useListbox'
import { formatUiDateTime } from '../utils/formatDateTime'
import type { ConceptFacetSummary, ConceptRow } from '../../../shared/types'
import './ConceptLibraryModal.css'

interface Props {
  onClose: () => void
}

// Browses and manages the concept ledger (concepts.sqlite3): the facets the AI
// has resolved seeds into, and every concept value it has ever found, with
// cluster (probe) provenance and use statistics. Management is deletion only —
// a deleted concept may be re-discovered by a future planning ask; deleting is
// "drop this row", not a blocklist. The ledger itself is written only by
// brainstorm runs, so this modal never creates or edits rows.
export function ConceptLibraryModal({ onClose }: Props): React.JSX.Element {
  const confirm = useConfirm()
  const [facets, setFacets] = useState<ConceptFacetSummary[] | null>(null)
  const [selectedFacetId, setSelectedFacetId] = useState<number | null>(null)
  const [rows, setRows] = useState<ConceptRow[]>([])
  const [filter, setFilter] = useState('')
  const [message, setMessage] = useState('')

  const refreshFacets = useCallback(async (): Promise<void> => {
    try {
      const list = await window.electronAPI.listConceptFacets()
      setFacets(list)
      setSelectedFacetId((prev) =>
        prev !== null && list.some((f) => f.id === prev) ? prev : list[0]?.id ?? null
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void refreshFacets()
  }, [refreshFacets])

  useEffect(() => {
    if (selectedFacetId === null) {
      setRows([])
      return
    }
    let cancelled = false
    window.electronAPI
      .listConceptRows(selectedFacetId)
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
    }
  }, [selectedFacetId, facets])

  const { listboxProps, getOptionProps } = useListbox<HTMLDivElement>({
    ids: (facets ?? []).map((f) => String(f.id)),
    selectedId: selectedFacetId !== null ? String(selectedFacetId) : null,
    onSelect: (id) => setSelectedFacetId(Number(id)),
    activation: 'follows-focus',
  })

  const selectedFacet = facets?.find((f) => f.id === selectedFacetId) ?? null
  const needle = filter.trim().toLowerCase()
  const visibleRows = needle
    ? rows.filter((r) => `${r.display} ${r.probe}`.toLowerCase().includes(needle))
    : rows

  const handleDeleteConcept = useCallback(async (row: ConceptRow): Promise<void> => {
    const ok = await confirm({
      title: 'Delete Concept',
      message: `Delete "${row.display}"? A future generation run may re-discover it — this drops the row and its use history, it does not block the concept.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setMessage('')
    try {
      await window.electronAPI.deleteConceptRow(row.id)
      await refreshFacets()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [confirm, refreshFacets])

  const handleDeleteFacet = useCallback(async (): Promise<void> => {
    if (!selectedFacet) return
    const ok = await confirm({
      title: 'Delete Facet',
      message: `Delete the "${selectedFacet.display}" facet and its ${selectedFacet.conceptCount} concept${selectedFacet.conceptCount === 1 ? '' : 's'}? Domains and use history under it are removed too.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setMessage('')
    try {
      await window.electronAPI.deleteConceptFacet(selectedFacet.id)
      await refreshFacets()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [confirm, selectedFacet, refreshFacets])

  return (
    <Modal
      title="Concept Library"
      className="concept-library-modal-box"
      onClose={onClose}
      footer={
        <button className="modal-btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="concept-library-body">
        <p className="concept-library-note">
          Every concept the AI has found while elaborating, with how often and how recently each was
          used. Generation never reuses a concept within the recent-use window or the same session.
        </p>
        {message && <div className="concept-library-message">{message}</div>}
        {facets === null ? (
          <div className="concept-library-empty">Loading…</div>
        ) : facets.length === 0 ? (
          <div className="concept-library-empty">
            No concepts yet. They accumulate as Advanced Prompting elaborates prompts.
          </div>
        ) : (
          <div className="concept-library-columns">
            <div className="concept-library-facets" aria-label="Facets" {...listboxProps}>
              {facets.map((facet) => (
                <div
                  key={facet.id}
                  className={`concept-library-facet${facet.id === selectedFacetId ? ' selected' : ''}`}
                  {...getOptionProps(String(facet.id))}
                >
                  <div className="concept-library-facet-name">{facet.display}</div>
                  <div className="concept-library-facet-meta">
                    {facet.conceptCount} concept{facet.conceptCount === 1 ? '' : 's'} · {facet.unusedCount} unused
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
                      placeholder="Filter concepts…"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      aria-label="Filter concepts"
                    />
                    <button
                      className="modal-btn modal-btn-danger"
                      onClick={() => void handleDeleteFacet()}
                    >
                      Delete Facet
                    </button>
                  </div>
                  {visibleRows.length === 0 ? (
                    <div className="concept-library-empty">
                      {rows.length === 0 ? 'No concepts in this facet yet.' : 'No concepts match the filter.'}
                    </div>
                  ) : (
                    <div className="concept-library-rows">
                      {visibleRows.map((row) => (
                        <div key={row.id} className="concept-library-row">
                          <div className="concept-library-row-main">
                            <div className="concept-library-row-name">{row.display}</div>
                            <div className="concept-library-row-meta" title={`Found under: ${row.probe}`}>
                              {row.probe}
                            </div>
                          </div>
                          <div className="concept-library-row-stats">
                            {row.useCount === 0
                              ? 'never used'
                              : `used ${row.useCount}× · last ${formatUiDateTime(row.lastUsedAt ?? row.createdAt)}`}
                          </div>
                          {/* Pointer-only affordance (tabIndex -1): the facet list is
                              the keyboard surface; rows here are a read/manage table. */}
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
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
